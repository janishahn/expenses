import type { APIRequestContext, Page } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { expect, test } from "./fixtures"
import { createTransaction, ensureCategory, getCsrfToken } from "./helpers"

const today = () => new Date().toISOString().slice(0, 10)

async function createCategory(
  request: APIRequestContext,
  token: string,
  type: "income" | "expense",
  name: string,
): Promise<number> {
  const response = await request.post("/api/categories", {
    headers: { "X-CSRF-Token": token },
    data: { name, type, order: 0 },
  })
  expect(response.ok()).toBeTruthy()
  return ((await response.json()) as { id: number }).id
}

async function createExpense(
  request: APIRequestContext,
  token: string,
  categoryId: number,
  title: string,
  extra: { amount_cents?: number; date?: string } = {},
): Promise<number> {
  const date = extra.date ?? today()
  return createTransaction(request, token, {
    date,
    occurred_at: `${date}T12:00:00`,
    type: "expense",
    amount_cents: extra.amount_cents ?? 2500,
    category_id: categoryId,
    title,
    tags: [],
  })
}

async function fetchTransaction(request: APIRequestContext, id: number) {
  const response = await request.get(`/api/transactions/${id}`)
  expect(response.ok()).toBeTruthy()
  return (await response.json()) as {
    category_id: number | null
    durable_purchase: { expected_lifespan_days: number; ended_on: string | null } | null
  }
}

// Row checkboxes appear on hover, so hover the row before checking its box.
async function selectRow(page: Page, title: string) {
  await page.getByRole("listitem", { name: title }).hover()
  await page.getByRole("checkbox", { name: `Select ${title}` }).check()
}

test.describe("Transactions Page", () => {
  test("exports the filtered transactions as CSV from the more actions menu", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Export")
    const title = `E2E Export ${Date.now()}`
    await createExpense(request, token, categoryId, title)

    await page.goto(`/transactions?q=${encodeURIComponent(title)}`)
    await expect(page.getByRole("listitem", { name: title })).toBeVisible()

    await page.getByRole("button", { name: "More actions" }).click()
    const downloadPromise = page.waitForEvent("download")
    await page.getByRole("menuitem", { name: "Export CSV" }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.csv$/)
    expect(await readFile((await download.path()), "utf8")).toContain(title)
  })

  test("prints every row for the filters with the server's totals", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const expenseId = await ensureCategory(request, token, "expense", "E2E Print")
    const incomeId = await ensureCategory(request, token, "income", "E2E Print Income")
    const marker = `printx${Date.now()}x`
    await createExpense(request, token, expenseId, `${marker} lunch`, { date: "2026-03-11", amount_cents: 2000 })
    await createExpense(request, token, expenseId, `${marker} train`, { date: "2026-03-10", amount_cents: 1500 })
    await createTransaction(request, token, {
      date: "2026-03-10",
      occurred_at: "2026-03-10T09:00:00",
      type: "income",
      amount_cents: 5000,
      category_id: incomeId,
      title: `${marker} salary`,
      tags: [],
    })
    // Pages of two rows, so the printout has to gather a second page.
    let printPages = 0
    await page.route(/\/api\/transactions\?/, (route) => {
      const url = route.request().url()
      if (!url.includes("limit=1000")) return route.continue()
      printPages += 1
      return route.continue({ url: url.replace("limit=1000", "limit=2") })
    })
    await page.addInitScript(() => {
      window.print = () => {
        document.body.dataset.printed = String(Number(document.body.dataset.printed ?? 0) + 1)
      }
    })

    await page.goto(`/transactions?q=${marker}`)
    const screenTitle = await page.title()
    await page.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Print…" }).click()
    await expect(page.locator("body")).toHaveAttribute("data-printed", "1")
    expect(printPages).toBe(2)
    await expect(page).toHaveTitle("Transactions · All time")
    await expect(page.getByRole("table", { includeHidden: true })).toBeHidden()

    await page.emulateMedia({ media: "print" })
    await expect(page.getByTestId("app-shell-root")).toBeHidden()
    const ledger = page.getByRole("table")
    for (const name of ["lunch", "train", "salary"]) await expect(ledger).toContainText(`${marker} ${name}`)
    await expect(page.getByText(`Matching “${marker}”`)).toBeVisible()
    for (const [term, amount] of [
      ["Spent", "35,00 €"],
      ["Cash in", "50,00 €"],
      ["Net", "+ 15,00 €"],
    ]) {
      await expect(page.getByRole("term").filter({ hasText: term }).locator("..")).toContainText(amount)
    }
    // The ledger footer, hidden while printing, shows the same count.
    await expect(page.getByRole("paragraph").filter({ hasText: /^3 transactions$/ })).toBeVisible()

    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")))
    await expect(ledger).toHaveCount(0)
    await expect(page).toHaveTitle(screenTitle)
    await page.emulateMedia({ media: "screen" })
    await page.keyboard.press("ControlOrMeta+p")
    await expect(page.locator("body")).toHaveAttribute("data-printed", "2")
  })

  test("changes the category of selected rows after confirming", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const stamp = Date.now()
    const sourceId = await createCategory(request, token, "expense", `E2E Bulk Source ${stamp}`)
    const targetName = `E2E Bulk Target ${stamp}`
    const targetId = await createCategory(request, token, "expense", targetName)
    const marker = `recategorizing${stamp}q`
    const ids = [
      await createExpense(request, token, sourceId, `${marker} one`),
      await createExpense(request, token, sourceId, `${marker} two`),
    ]
    const untouchedId = await createExpense(request, token, sourceId, `${marker} three`)

    await page.goto(`/transactions?q=${marker}`)
    await selectRow(page, `${marker} one`)
    await selectRow(page, `${marker} two`)
    const bar = page.getByRole("toolbar", { name: "Selected rows" })
    await expect(bar).toContainText("2 selected")

    await bar.getByRole("button", { name: "Category" }).click()
    await page.getByRole("option", { name: targetName }).click()
    const confirm = page.getByRole("dialog", { name: "Change the category of 2 transactions?" })
    await expect(confirm).toBeVisible()
    await confirm.getByRole("button", { name: "Apply" }).click()

    await expect(page.getByRole("status")).toContainText("Updated 2 transactions")
    await expect(bar).toBeHidden()
    for (const id of ids) {
      expect((await fetchTransaction(request, id)).category_id).toBe(targetId)
    }
    expect((await fetchTransaction(request, untouchedId)).category_id).toBe(sourceId)
  })

  test("saves and stops durable purchase tracking in the peek", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Durable Edit")
    const title = `E2E Durable Edit ${Date.now()}`
    const transactionId = await createExpense(request, token, categoryId, title, {
      amount_cents: 120_000,
    })

    await page.goto(`/transactions?q=${encodeURIComponent(title)}&peek=${transactionId}`)
    const peek = page.getByRole("complementary", { name: title })
    await expect(peek.getByText("Reimbursed", { exact: true })).toBeVisible()
    await expect(peek.getByRole("button", { name: /^Durable/ })).toHaveCount(0)
    await peek.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Track as durable…" }).click()
    const popover = page.getByRole("dialog", { name: "Durable purchase" })
    await popover.getByLabel("Lifespan").selectOption("730")
    await expect(popover).toContainText("per day")

    const saved = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/transactions/${transactionId}/durable`) &&
        response.request().method() === "POST" &&
        response.ok(),
    )
    await popover.getByRole("button", { name: "Track" }).click()
    await saved
    await expect(peek.getByRole("button", { name: /^Durable 2 years/ })).toBeVisible()
    expect((await fetchTransaction(request, transactionId)).durable_purchase?.expected_lifespan_days).toBe(730)

    // Once it ends, the property shows what it cost per day it was owned.
    await peek.getByRole("button", { name: /^Durable/ }).click()
    const editor = page.getByRole("dialog", { name: "Durable purchase" })
    await editor.getByLabel("Acquired").fill("2026-01-01")
    // An end date still to come keeps the planned cost per day.
    await editor.getByLabel("Ended").fill("2099-01-01")
    await expect(editor).toContainText("1,64 € per day")
    await editor.getByLabel("Ended").fill("2026-04-11")
    const ended = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/transactions/${transactionId}/durable`) &&
        response.request().method() === "POST" &&
        response.ok(),
    )
    await editor.getByRole("button", { name: "Save" }).click()
    await ended
    await expect(peek.getByRole("button", { name: /^Durable 2 years from 1 Jan.*, ended 11 Apr/ })).toContainText(
      "12,00 € per day",
    )
    expect((await fetchTransaction(request, transactionId)).durable_purchase?.ended_on).toBe("2026-04-11")

    await peek.getByRole("button", { name: /^Durable/ }).click()
    const removed = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/transactions/${transactionId}/durable`) &&
        response.request().method() === "DELETE" &&
        response.ok(),
    )
    await page.getByRole("dialog", { name: "Durable purchase" }).getByRole("button", { name: "Stop tracking" }).click()
    await removed
    await expect(peek.getByRole("button", { name: /^Durable/ })).toHaveCount(0)
    expect((await fetchTransaction(request, transactionId)).durable_purchase).toBeNull()
    await peek.getByRole("button", { name: "More actions" }).click()
    await expect(page.getByRole("menuitem", { name: "Track as durable…" })).toBeVisible()
  })

  test("allocates part of a reimbursement from the expense peek", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const stamp = Date.now()
    const expenseCategoryId = await ensureCategory(request, token, "expense", "E2E Expense Reimbursed")
    const incomeCategoryId = await ensureCategory(request, token, "income", "E2E Reimbursement Source")
    const title = `E2E reimbursed hotel ${stamp}`
    const expenseId = await createExpense(request, token, expenseCategoryId, title, { amount_cents: 8000 })
    const reimbursementTitle = `E2E trip share ${stamp}`
    const reimbursementId = await createTransaction(request, token, {
      date: today(),
      occurred_at: `${today()}T13:00:00`,
      type: "income",
      amount_cents: 12_000,
      category_id: incomeCategoryId,
      title: reimbursementTitle,
      tags: [],
      is_reimbursement: true,
    })
    const smallId = await createTransaction(request, token, {
      date: today(),
      occurred_at: `${today()}T14:00:00`,
      type: "income",
      amount_cents: 3000,
      category_id: incomeCategoryId,
      title: `E2E small share ${stamp}`,
      tags: [],
      is_reimbursement: true,
    })

    await page.goto(`/transactions?q=${encodeURIComponent(title)}&peek=${expenseId}`)
    const peek = page.getByRole("complementary", { name: title })
    await peek.getByRole("button", { name: "Add reimbursement" }).click()
    const popover = page.getByRole("dialog", { name: "Add reimbursement" })
    // 30,00 € left holds a third of the expense but not half.
    await popover.getByLabel("From").selectOption(String(smallId))
    await expect(popover.getByRole("textbox", { name: "Amount" })).toHaveValue("30,00")
    await expect(popover.getByRole("button", { name: "½" })).toBeDisabled()
    await expect(popover.getByRole("button", { name: "⅓" })).toBeEnabled()
    await popover.getByLabel("From").selectOption(String(reimbursementId))
    await expect(popover.getByRole("textbox", { name: "Amount" })).toHaveValue("80,00")
    await popover.getByRole("button", { name: "½" }).click()
    await expect(popover.getByRole("textbox", { name: "Amount" })).toHaveValue("40,00")
    await popover.getByRole("button", { name: "Allocate" }).click()

    await expect(popover).toBeHidden()
    await expect(peek.getByRole("link", { name: new RegExp(reimbursementTitle) })).toContainText("40,00")
    await expect(peek.getByText("Net", { exact: true })).toBeVisible()
    // The row shows what the expense cost after the reimbursement, after its struck charge.
    const row = page.getByRole("listitem", { name: title })
    await expect(row.locator("s")).toHaveText(/80,00/)
    await expect(row).toContainText("40,00")
    const saved = await request.get(`/api/transactions/${expenseId}`)
    expect(((await saved.json()) as { reimbursed_total_cents: number }).reimbursed_total_cents).toBe(4000)
  })

})
