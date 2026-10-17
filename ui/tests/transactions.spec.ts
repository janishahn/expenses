import type { APIRequestContext, Page } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { expect, test } from "./fixtures"
import {
  createTransaction,
  createUncategorizedExpense,
  ensureCategory,
  getCsrfToken,
  loginWithTrainedSuggestions,
} from "./helpers"

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

async function createTag(request: APIRequestContext, token: string, name: string): Promise<number> {
  const response = await request.post("/api/tags", {
    headers: { "X-CSRF-Token": token },
    data: { name, is_hidden_from_budget: false },
  })
  expect(response.ok()).toBeTruthy()
  return ((await response.json()) as { id: number }).id
}

async function createExpense(
  request: APIRequestContext,
  token: string,
  categoryId: number,
  title: string,
  extra: { amount_cents?: number; date?: string; tags?: string[]; description?: string } = {},
): Promise<number> {
  const date = extra.date ?? today()
  return createTransaction(request, token, {
    date,
    occurred_at: `${date}T12:00:00`,
    type: "expense",
    amount_cents: extra.amount_cents ?? 2500,
    category_id: categoryId,
    title,
    description: extra.description,
    tags: extra.tags ?? [],
  })
}

async function fetchTransaction(request: APIRequestContext, id: number) {
  const response = await request.get(`/api/transactions/${id}`)
  expect(response.ok()).toBeTruthy()
  return (await response.json()) as {
    category_id: number | null
    tags: string[]
    title: string
    durable_purchase: { expected_lifespan_days: number } | null
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
    expect(await readFile((await download.path())!, "utf8")).toContain(title)
  })

  test("opens Trash from the more actions menu", async ({ page }) => {
    await page.goto("/transactions")
    await page.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Trash" }).click()
    await expect(page).toHaveURL(/\/transactions\/deleted$/)
    await expect(page.locator("main h1")).toContainText("Trash")
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
    await expect(page.getByText("3 transactions")).toBeVisible()

    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")))
    await expect(ledger).toHaveCount(0)
    await expect(page).toHaveTitle(screenTitle)
    await page.emulateMedia({ media: "screen" })
    await page.keyboard.press("ControlOrMeta+p")
    await expect(page.locator("body")).toHaveAttribute("data-printed", "2")
  })

  test("groups rows into day bands with the signed day net", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const expenseId = await ensureCategory(request, token, "expense", "E2E Bands")
    const incomeId = await ensureCategory(request, token, "income", "E2E Bands Income")
    // One search token so parallel fixtures cannot join these bands.
    const marker = `bandsx${Date.now()}x`
    await createExpense(request, token, expenseId, `${marker} lunch`, { date: "2026-03-11", amount_cents: 2000 })
    await createTransaction(request, token, {
      date: "2026-03-11",
      occurred_at: "2026-03-11T15:00:00",
      type: "income",
      amount_cents: 5000,
      category_id: incomeId,
      title: `${marker} refund`,
      tags: [],
    })
    await createExpense(request, token, expenseId, `${marker} train`, { date: "2026-03-10", amount_cents: 1500 })

    await page.goto(`/transactions?q=${marker}`)
    const list = page.getByRole("list", { name: "Transactions" })
    await expect(list.getByRole("listitem")).toHaveCount(3)
    // The newer day first; its net is income minus expenses.
    await expect(list.getByText(/^Wed 11 Mar/).locator("..")).toContainText("+ 30,00 €")
    await expect(list.getByText(/^Tue 10 Mar/).locator("..")).toContainText("− 15,00 €")
  })

  test("fuzzy-searches transaction descriptions and closes the search with Esc", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Fuzzy Search")
    const title = `E2E description result ${Date.now()}`
    await createExpense(request, token, categoryId, title, {
      description: "Warranty paperwork stored here",
    })

    await page.goto("/transactions")
    await page.getByRole("button", { name: "Search", exact: true }).click()
    const field = page.getByRole("searchbox", { name: "Search transactions" })
    await expect(field).toBeFocused()
    await field.fill("waranty paperwork")
    await expect(page).toHaveURL(/[?&]q=waranty/)
    await expect(page.getByRole("listitem", { name: title })).toBeVisible()

    // The first Esc clears the query and keeps the field; the second closes it.
    await page.keyboard.press("Escape")
    await expect(field).toHaveValue("")
    await expect(page).not.toHaveURL(/[?&]q=/)
    await page.keyboard.press("Escape")
    await expect(field).toBeHidden()
  })

  test("filters by type, category and tag, then clears the filters", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const stamp = Date.now()
    const marker = `filterx${stamp}x`
    const expenseCategory = `E2E Filter Expense ${stamp}`
    const incomeCategory = `E2E Filter Income ${stamp}`
    const otherCategory = `E2E Filter Other ${stamp}`
    const tag = `filtertag${stamp}`
    const expenseId = await createCategory(request, token, "expense", expenseCategory)
    const otherId = await createCategory(request, token, "expense", otherCategory)
    const incomeId = await createCategory(request, token, "income", incomeCategory)
    await createTag(request, token, tag)
    await createExpense(request, token, expenseId, `${marker} tagged`, { tags: [tag] })
    await createExpense(request, token, otherId, `${marker} other`)
    await createTransaction(request, token, {
      date: today(),
      occurred_at: `${today()}T13:00:00`,
      type: "income",
      amount_cents: 9000,
      category_id: incomeId,
      title: `${marker} salary`,
      tags: [],
    })

    await page.goto(`/transactions?q=${marker}`)
    const tagged = page.getByRole("listitem", { name: `${marker} tagged` })
    const other = page.getByRole("listitem", { name: `${marker} other` })
    const salary = page.getByRole("listitem", { name: `${marker} salary` })
    await expect(page.getByRole("list", { name: "Transactions" }).getByRole("listitem")).toHaveCount(3)

    await page.getByRole("button", { name: "Type", exact: true }).click()
    await page.getByRole("menuitemcheckbox", { name: "Income" }).click()
    await expect(page).toHaveURL(/type=income/)
    await expect(salary).toBeVisible()
    await expect(tagged).toHaveCount(0)
    await page.getByRole("button", { name: "Clear type filter" }).click()
    await expect(page).not.toHaveURL(/type=/)
    await expect(tagged).toBeVisible()

    await page.getByRole("button", { name: "Category", exact: true }).click()
    await page.getByRole("option", { name: expenseCategory }).click()
    await expect(page).toHaveURL(/category=\d+/)
    await expect(tagged).toBeVisible()
    await expect(other).toHaveCount(0)
    await page.getByRole("button", { name: "Clear category filter" }).click()
    await expect(other).toBeVisible()

    await page.getByRole("button", { name: "Tag", exact: true }).click()
    await page.getByRole("checkbox", { name: tag }).click()
    await expect(page.getByRole("checkbox", { name: tag })).toBeChecked()
    await expect(page).toHaveURL(/tags=\d+/)
    await expect(tagged).toBeVisible()
    await expect(other).toHaveCount(0)
    await page.keyboard.press("Escape")

    await page.getByRole("button", { name: "Type", exact: true }).click()
    await page.getByRole("menuitemcheckbox", { name: "Expense" }).click()
    await page.getByRole("button", { name: "Clear", exact: true }).click()
    await expect(page).not.toHaveURL(/type=|category=|tags=|q=/)
    await expect(page.getByRole("button", { name: "Clear", exact: true })).toHaveCount(0)
  })

  test("opens a peek from a row and closes it with Esc or Close", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Peek")
    const title = `E2E Peek ${Date.now()}`
    const transactionId = await createExpense(request, token, categoryId, title)

    const listUrl = `/transactions?q=${encodeURIComponent(title)}`
    await page.goto(listUrl)
    await page.getByRole("listitem", { name: title }).click()
    await expect(page).toHaveURL(new RegExp(`[?&]peek=${transactionId}`))
    const peek = page.getByRole("complementary", { name: title })
    await expect(peek).toBeVisible()
    await expect(peek.getByRole("button", { name: "Edit Title" })).toContainText(title)

    await page.keyboard.press("Escape")
    await expect(peek).toBeHidden()
    await expect(page).not.toHaveURL(/peek=/)
    await expect(page).toHaveURL(/[?&]q=/)

    await page.getByRole("listitem", { name: title }).click()
    await expect(peek).toBeVisible()
    await peek.getByRole("button", { name: "Close" }).click()
    await expect(peek).toBeHidden()
  })

  test("checking a row selects it without opening the peek", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Row Guard")
    const title = `E2E Row Guard ${Date.now()}`
    await createExpense(request, token, categoryId, title)

    const listUrl = `/transactions?q=${encodeURIComponent(title)}`
    await page.goto(listUrl)
    const row = page.getByRole("listitem", { name: title })
    await row.hover()
    const checkbox = page.getByRole("checkbox", { name: `Select ${title}` })
    await checkbox.check()
    await expect(page).toHaveURL(listUrl)
    await expect(checkbox).toBeChecked()
    const bar = page.getByRole("toolbar", { name: "Selected rows" })
    await expect(bar).toContainText("1 selected")

    // The checkbox sits on the row's vertical center.
    const [rowBox, boxBox] = await Promise.all([row.boundingBox(), checkbox.boundingBox()])
    expect(rowBox).not.toBeNull()
    expect(boxBox).not.toBeNull()
    expect(
      Math.abs(rowBox!.y + rowBox!.height / 2 - (boxBox!.y + boxBox!.height / 2)),
    ).toBeLessThanOrEqual(3)

    await bar.getByRole("button", { name: "Clear selection" }).click()
    await expect(bar).toBeHidden()
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

  test("adds a tag to selected rows", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const stamp = Date.now()
    const categoryId = await ensureCategory(request, token, "expense", "E2E Bulk Tag")
    const tag = `bulktag${stamp}`
    await createTag(request, token, tag)
    const marker = `taggingmany${stamp}q`
    const ids = [
      await createExpense(request, token, categoryId, `${marker} one`),
      await createExpense(request, token, categoryId, `${marker} two`),
    ]

    await page.goto(`/transactions?q=${marker}`)
    await selectRow(page, `${marker} one`)
    await selectRow(page, `${marker} two`)
    const bar = page.getByRole("toolbar", { name: "Selected rows" })
    await bar.getByRole("button", { name: "Tags" }).click()
    await page.getByRole("menuitem", { name: "Add tags" }).click()

    const picker = page.getByRole("dialog", { name: "Add tags" })
    await expect(picker.getByRole("button", { name: "Apply" })).toBeDisabled()
    await picker.getByRole("button", { name: "Choose tags" }).click()
    await page.getByRole("option", { name: tag }).click()
    await page.keyboard.press("Escape")
    await picker.getByRole("button", { name: "Apply" }).click()

    await page.getByRole("dialog", { name: "Add tags to 2 transactions?" }).getByRole("button", { name: "Apply" }).click()
    await expect(page.getByRole("status")).toContainText("Updated 2 transactions")
    for (const id of ids) {
      expect((await fetchTransaction(request, id)).tags).toContain(tag)
    }
  })

  test("moves selected rows to Trash after confirming", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Bulk Delete")
    const marker = `trashingpair${Date.now()}q`
    const ids = [
      await createExpense(request, token, categoryId, `${marker} one`),
      await createExpense(request, token, categoryId, `${marker} two`),
    ]

    await page.goto(`/transactions?q=${marker}`)
    await selectRow(page, `${marker} one`)
    await selectRow(page, `${marker} two`)
    const bar = page.getByRole("toolbar", { name: "Selected rows" })
    await bar.getByRole("button", { name: "Delete" }).click()
    const confirm = page.getByRole("dialog", { name: "Delete 2 transactions?" })
    await confirm.getByRole("button", { name: "Cancel" }).click()
    await expect(confirm).toBeHidden()
    await expect(bar).toContainText("2 selected")

    await bar.getByRole("button", { name: "Delete" }).click()
    await page.getByRole("dialog", { name: "Delete 2 transactions?" }).getByRole("button", { name: "Delete" }).click()
    await expect(page.getByRole("status")).toContainText("Moved 2 transactions to Trash")
    await expect(page.getByRole("listitem", { name: marker })).toHaveCount(0)
    for (const id of ids) {
      expect((await request.get(`/api/transactions/${id}`)).status()).toBe(404)
    }
  })

  test("disables Select all matching until the refreshed list settles", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Bulk Gate")
    // One search token so parallel fixtures cannot inflate the matching count.
    const marker = `gateselection${Date.now()}q`
    for (const index of [1, 2, 3]) {
      await createExpense(request, token, categoryId, `${marker} ${index}`)
    }

    await page.goto(`/transactions?q=${marker}`)
    await selectRow(page, `${marker} 1`)
    const bar = page.getByRole("toolbar", { name: "Selected rows" })
    const selectAll = page.getByRole("menuitem", { name: /^Select all \d+ matching$/ })
    const openSelectionMenu = async () => {
      await bar.getByRole("button", { name: "1 selected" }).click()
      await expect(selectAll).toBeVisible()
    }
    await openSelectionMenu()
    await expect(selectAll).toBeEnabled()
    // Esc reaches the menu once it has focus.
    await expect(page.getByRole("menu")).toBeFocused()
    await page.keyboard.press("Escape")
    await expect(selectAll).toBeHidden()

    // Renaming a row refetches the list; hold that request so no count has settled.
    let releaseList = () => {}
    const listGate = new Promise<void>((resolve) => {
      releaseList = resolve
    })
    await page.route("**/api/transactions?*", async (route) => {
      await listGate
      await route.continue()
    })
    await page.getByRole("listitem", { name: `${marker} 2` }).click()
    const peek = page.getByRole("complementary", { name: `${marker} 2` })
    await peek.getByRole("button", { name: "Edit Title" }).click()
    await peek.getByRole("textbox", { name: "Title" }).fill(`${marker} 2 renamed`)
    await peek.getByRole("textbox", { name: "Title" }).press("Enter")

    await openSelectionMenu()
    await expect(selectAll).toBeDisabled()

    releaseList()
    await expect(selectAll).toBeEnabled()
    const total = Number((await selectAll.textContent())!.match(/\d+/)![0])
    expect(total).toBeGreaterThanOrEqual(3)
    await selectAll.click()
    await expect(bar).toContainText(`${total} selected`)
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

  test("preserves an archived tag on a record without offering it for new transactions", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Archived Tag Assignment")
    const archivedTag = `Archived assignment ${Date.now()}`
    const tagId = await createTag(request, token, archivedTag)
    const title = `E2E archived assignment ${Date.now()}`
    const transactionId = await createExpense(request, token, categoryId, title, { tags: [archivedTag] })
    const archived = await request.post(`/api/tags/${tagId}/archive`, {
      headers: { "X-CSRF-Token": token },
    })
    expect(archived.ok()).toBeTruthy()

    await page.goto(`/transactions?q=${encodeURIComponent(title)}&peek=${transactionId}`)
    const peek = page.getByRole("complementary", { name: title })
    await expect(peek.getByText(archivedTag)).toBeVisible()

    await page.getByRole("button", { name: "Add transaction", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Add transaction" })
    // A scheduled tag from another test may be preselected, which names the chip after it.
    await dialog.getByRole("button", { name: /^Tags/ }).click()
    const picker = page.getByRole("combobox", { name: "Tags" })
    await picker.fill(archivedTag)
    await expect(page.getByRole("option", { name: archivedTag })).toHaveCount(0)
    await expect(page.getByText("No matches")).toBeVisible()
  })

  test.describe("Add transaction dialog", () => {
    test("validates the amount and title before saving", async ({ page }) => {
      await page.goto("/transactions")
      await page.getByRole("button", { name: "Add transaction", exact: true }).click()
      const dialog = page.getByRole("dialog", { name: "Add transaction" })
      await dialog.getByRole("button", { name: "Add transaction" }).click()
      await expect(dialog.getByText("Enter an amount.")).toBeVisible()
      await expect(dialog.getByText("Enter a title.")).toBeVisible()

      await dialog.getByLabel("Amount").fill("abc")
      await dialog.getByLabel("Title").fill("Valid title")
      await dialog.getByRole("button", { name: "Add transaction" }).click()
      await expect(dialog.getByText("Enter a valid amount.")).toBeVisible()
      await expect(dialog).toBeVisible()
    })

    test("creates a categorized transaction that appears in the ledger", async ({ page, request }) => {
      const token = await getCsrfToken(request)
      const stamp = Date.now()
      const categoryName = `E2E Add ${stamp}`
      const categoryId = await createCategory(request, token, "expense", categoryName)
      const title = `E2E Added ${stamp}`

      await page.goto(`/transactions?q=${encodeURIComponent(title)}`)
      await expect(page.getByText("No matching transactions")).toBeVisible()
      await page.getByRole("button", { name: "Add transaction", exact: true }).click()
      const dialog = page.getByRole("dialog", { name: "Add transaction" })
      await dialog.getByLabel("Amount").fill("12,34")
      await dialog.getByLabel("Title").fill(title)
      await dialog.getByRole("button", { name: "Category", exact: true }).click()
      await page.getByRole("option", { name: categoryName }).click()
      await dialog.getByRole("button", { name: "Add transaction" }).click()

      await expect(dialog).toBeHidden()
      await expect(page.getByRole("status")).toContainText("Transaction added")
      const row = page.getByRole("listitem", { name: title })
      await expect(row).toBeVisible()
      await expect(row).toContainText(categoryName)
      await expect(row).toContainText("12,34 €")

      await page.getByRole("status").getByRole("button", { name: "Open" }).click()
      await expect(page).toHaveURL(/[?&]peek=\d+/)
      const created = await request.get(`/api/transactions?q=${encodeURIComponent(title)}&period=all`)
      const items = ((await created.json()) as { items: Array<{ category: { id: number } | null }> }).items
      expect(items).toHaveLength(1)
      expect(items[0].category?.id).toBe(categoryId)
    })

    test("applies a template to the entry", async ({ page, request }) => {
      const token = await getCsrfToken(request)
      const stamp = Date.now()
      const categoryName = `E2E Template ${stamp}`
      const categoryId = await createCategory(request, token, "expense", categoryName)
      const templateName = `E2E Coffee ${stamp}`
      const response = await request.post("/api/templates", {
        headers: { "X-CSRF-Token": token },
        data: {
          name: templateName,
          type: "expense",
          category_id: categoryId,
          default_amount_cents: 450,
          title: `Template title ${stamp}`,
          tags: [],
        },
      })
      expect(response.ok()).toBeTruthy()

      await page.goto("/transactions")
      await page.getByRole("button", { name: "Add transaction", exact: true }).click()
      const dialog = page.getByRole("dialog", { name: "Add transaction" })
      await dialog.getByRole("button", { name: templateName }).click()
      await expect(dialog.getByLabel("Amount")).toHaveValue("4,50")
      await expect(dialog.getByLabel("Title")).toHaveValue(`Template title ${stamp}`)
      await expect(dialog.getByRole("button", { name: categoryName })).toBeVisible()
    })

    test("dismisses on an outside click", async ({ page }) => {
      await page.goto("/transactions")
      await page.getByRole("button", { name: "Add transaction", exact: true }).click()
      const dialog = page.getByRole("dialog", { name: "Add transaction" })
      await expect(dialog).toBeVisible()
      await page.mouse.click(10, 10)
      await expect(dialog).toBeHidden()
    })

    test("filters the tag picker by search", async ({ page, request }) => {
      const token = await getCsrfToken(request)
      const marker = Date.now()
      const alphaTag = `alpha-${marker}`
      const betaTag = `beta-${marker}`
      for (const name of [alphaTag, betaTag]) {
        await createTag(request, token, name)
      }

      await page.goto("/transactions")
      await page.getByRole("button", { name: "Add transaction", exact: true }).click()
      const dialog = page.getByRole("dialog", { name: "Add transaction" })
      // A scheduled tag from another test may be preselected, which names the chip after it.
      await dialog.getByRole("button", { name: /^Tags/ }).click()
      const picker = page.getByRole("listbox", { name: "Tags" })
      await expect(picker.getByRole("option", { name: alphaTag })).toBeVisible()
      await expect(picker.getByRole("option", { name: betaTag })).toBeVisible()

      await page.getByRole("combobox", { name: "Tags" }).fill(alphaTag)
      await expect(picker.getByRole("option", { name: alphaTag })).toBeVisible()
      await expect(picker.getByRole("option", { name: betaTag })).toHaveCount(0)
    })

    test("shows scheduled tags and saves a manual removal", async ({ page, request }) => {
      const token = await getCsrfToken(request)
      const now = new Date()
      const localToday = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
      ].join("-")
      const tagName = `scheduled-${Date.now()}`
      const tagResponse = await request.post("/api/tags", {
        headers: { "X-CSRF-Token": token },
        data: {
          name: tagName,
          is_hidden_from_budget: false,
          auto_attach_period: { start: localToday, end: localToday },
        },
      })
      expect(tagResponse.ok()).toBeTruthy()

      await page.goto("/transactions")
      await page.getByRole("button", { name: "Add transaction", exact: true }).click()
      const dialog = page.getByRole("dialog", { name: "Add transaction" })
      const tagsChip = dialog.getByRole("button", { name: tagName })
      await expect(tagsChip).toBeVisible()
      await tagsChip.click()
      const scheduledOption = page.getByRole("option", { name: tagName })
      await expect(scheduledOption).toHaveAttribute("aria-selected", "true")
      await scheduledOption.click()
      await expect(scheduledOption).toHaveAttribute("aria-selected", "false")
      await page.keyboard.press("Escape")
      await expect(dialog.getByRole("button", { name: tagName })).toHaveCount(0)

      await dialog.getByLabel("Amount").fill("9.00")
      await dialog.getByLabel("Title").fill(`Scheduled removal ${Date.now()}`)
      const createResponsePromise = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/transactions") && response.request().method() === "POST",
      )
      await dialog.getByRole("button", { name: "Add transaction" }).click()
      const createResponse = await createResponsePromise
      expect(createResponse.ok()).toBeTruthy()
      const created = (await createResponse.json()) as { id: number }
      const detail = await fetchTransaction(request, created.id)
      expect(detail.tags).not.toContain(tagName)
    })

    test("offers active categories and hides archived ones", async ({ page, request }) => {
      const token = await getCsrfToken(request)
      const stamp = Date.now()
      const activeName = `E2E Active Add ${stamp}`
      const archivedName = `E2E Archived Add ${stamp}`
      await createCategory(request, token, "expense", activeName)
      const archivedId = await createCategory(request, token, "expense", archivedName)
      const archiveResponse = await request.post(`/api/categories/${archivedId}/archive`, {
        headers: { "X-CSRF-Token": token },
      })
      expect(archiveResponse.ok()).toBeTruthy()

      await page.goto("/transactions")
      await page.getByRole("button", { name: "Add transaction", exact: true }).click()
      const dialog = page.getByRole("dialog", { name: "Add transaction" })
      await dialog.getByRole("button", { name: "Category", exact: true }).click()
      const options = page.getByRole("listbox", { name: "Category" }).getByRole("option")
      await expect(options.filter({ hasText: activeName })).toHaveCount(1)
      await expect(options.filter({ hasText: archivedName })).toHaveCount(0)
    })

    test("shows reimbursement only for income and hands off to Templates", async ({ page, request }) => {
      const token = await getCsrfToken(request)
      const categoryId = await createCategory(request, token, "expense", `E2E Add Sheet ${Date.now()}`)
      const templateName = `Handoff Template ${Date.now()}`
      const response = await request.post("/api/templates", {
        headers: { "X-CSRF-Token": token },
        data: {
          name: templateName,
          type: "expense",
          category_id: categoryId,
          default_amount_cents: null,
          title: "Handoff title",
          tags: [],
        },
      })
      expect(response.ok()).toBeTruthy()

      await page.goto("/transactions")
      await page.getByRole("button", { name: "Add transaction", exact: true }).click()
      const dialog = page.getByRole("dialog", { name: "Add transaction" })
      await expect(dialog.getByRole("button", { name: templateName })).toBeVisible()
      await expect(dialog.getByRole("button", { name: "Reimbursement" })).toHaveCount(0)
      await dialog.getByRole("radio", { name: "Income" }).click()
      await expect(dialog.getByRole("button", { name: "Reimbursement" })).toBeVisible()
      await dialog.getByRole("radio", { name: "Expense" }).click()
      await expect(dialog.getByRole("button", { name: "Reimbursement" })).toHaveCount(0)

      await dialog.getByRole("button", { name: "Manage", exact: true }).click()
      await expect(page).toHaveURL("/templates")
      await expect(page.getByRole("dialog", { name: "Add transaction" })).toHaveCount(0)
      await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("")
    })
  })

  test("files an uncategorized transaction from its Category pill and undoes it", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const stamp = Date.now()
    const targetName = `E2E Pill Target ${stamp}`
    const targetId = await createCategory(request, token, "expense", targetName)
    const title = `E2E Pill ${stamp}`
    const id = await createUncategorizedExpense(request, token, title)

    await page.goto(`/transactions/inbox?q=${encodeURIComponent(title)}`)
    const row = page.getByRole("listitem", { name: title })
    await row.getByRole("button", { name: "Category" }).click()
    await page.getByRole("combobox").fill(targetName)
    await page.getByRole("option", { name: targetName }).click()

    const toast = page.getByRole("status")
    await expect(toast).toContainText(`Moved to ${targetName}`)
    await expect(row).toHaveCount(0)
    await expect(page.getByText("No matching transactions")).toBeVisible()
    expect((await fetchTransaction(request, id)).category_id).toBe(targetId)

    await toast.getByRole("button", { name: "Undo" }).click()
    await expect(row).toBeVisible()
    expect((await fetchTransaction(request, id)).category_id).not.toBe(targetId)
  })

  test("leaves a transaction recategorized elsewhere when its inbox Undo runs", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const stamp = Date.now()
    const targetName = `E2E Undo Target ${stamp}`
    await createCategory(request, token, "expense", targetName)
    const newerId = await createCategory(request, token, "expense", `E2E Undo Newer ${stamp}`)
    const title = `E2E Undo Changed ${stamp}`
    const id = await createUncategorizedExpense(request, token, title)

    await page.goto(`/transactions/inbox?q=${encodeURIComponent(title)}`)
    const row = page.getByRole("listitem", { name: title })
    await row.getByRole("button", { name: "Category" }).click()
    await page.getByRole("combobox").fill(targetName)
    await page.getByRole("option", { name: targetName }).click()
    const toast = page.getByRole("status")
    await expect(toast).toContainText(`Moved to ${targetName}`)

    // Another tab files it elsewhere while the Undo toast is still visible.
    const elsewhere = await request.post("/api/transactions/bulk/apply", {
      headers: { "X-CSRF-Token": token },
      data: { selection: { mode: "ids", transaction_ids: [id] }, operation: { set_category_id: newerId } },
    })
    expect(elsewhere.ok()).toBeTruthy()

    await toast.getByRole("button", { name: "Undo" }).click()
    await expect(page.getByRole("status")).toContainText("The transaction changed since, so it was left as it is.")
    expect((await fetchTransaction(request, id)).category_id).toBe(newerId)
    await expect(row).toHaveCount(0)
  })

  test("recategorizes selected uncategorized transactions after confirming", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const stamp = Date.now()
    const targetName = `E2E Inbox Target ${stamp}`
    const targetId = await createCategory(request, token, "expense", targetName)
    const marker = `inboxbulk${stamp}q`
    const ids = [
      await createUncategorizedExpense(request, token, `${marker} one`),
      await createUncategorizedExpense(request, token, `${marker} two`),
    ]
    const untouchedId = await createUncategorizedExpense(request, token, `${marker} three`)

    let forecastRequests = 0
    await page.route("**/api/forecast?*", async (route) => {
      forecastRequests += 1
      await route.continue()
    })
    await page.goto("/")
    await expect.poll(() => forecastRequests).toBeGreaterThanOrEqual(1)
    const sidebar = page.getByRole("complementary", { name: "Application navigation" })
    await sidebar.getByRole("link", { name: "Transactions", exact: true }).click()
    await sidebar.getByRole("link", { name: /^Uncategorized/ }).click()
    await expect(page.getByRole("heading", { name: "Uncategorized", level: 1 })).toBeVisible()
    // A selection belongs to the search it was made on, so it waits for the search to apply.
    const searched = page.waitForResponse((response) => response.url().includes(`q=${marker}`))
    await page.getByRole("searchbox", { name: "Search uncategorized transactions" }).fill(marker)
    await searched

    for (const name of ["one", "two"]) {
      await page.getByRole("listitem", { name: `${marker} ${name}` }).hover()
      await page.getByRole("checkbox", { name: `Select ${marker} ${name}` }).check()
    }
    const bar = page.getByRole("toolbar", { name: "Selected rows" })
    await expect(bar).toContainText("2 selected")
    await bar.getByRole("button", { name: "Category" }).click()
    await page.getByRole("combobox").fill(targetName)
    await page.getByRole("option", { name: targetName }).click()
    const confirm = page.getByRole("dialog", { name: "Change the category of 2 transactions?" })
    await confirm.getByRole("button", { name: "Apply" }).click()

    await expect(page.getByRole("status")).toContainText("Updated 2 transactions")
    await expect(bar).toBeHidden()
    await expect(page.getByRole("listitem", { name: `${marker} one` })).toHaveCount(0)
    await expect(page.getByRole("listitem", { name: `${marker} three` })).toBeVisible()
    for (const id of ids) {
      expect((await fetchTransaction(request, id)).category_id).toBe(targetId)
    }
    expect((await fetchTransaction(request, untouchedId)).category_id).not.toBe(targetId)

    await sidebar.getByRole("link", { name: "Dashboard", exact: true }).click()
    await expect.poll(() => forecastRequests).toBeGreaterThanOrEqual(2)
  })

  test("accepts and rejects local category suggestions", async ({ page }) => {
    const stamp = Date.now()
    const accepted = `Corner bakery accept ${stamp}`
    const rejected = `Corner bakery reject ${stamp}`
    const { request, bakeryId, uncategorizedIds } = await loginWithTrainedSuggestions(page, [
      accepted,
      rejected,
    ])
    try {
      await page.goto("/transactions/inbox")
      const acceptRow = page.getByRole("listitem", { name: accepted })
      const rejectRow = page.getByRole("listitem", { name: rejected })
      await expect(
        acceptRow.getByRole("button", { name: "Suggested category Bakery, change" }),
      ).toBeVisible()
      await expect(acceptRow).toContainText(/\d+\s%\sconfidence/)

      await rejectRow.getByRole("button", { name: "Reject" }).click()
      await expect(rejectRow.getByRole("button", { name: "Accept" })).toHaveCount(0)
      await expect(rejectRow.getByRole("button", { name: "Category", exact: true })).toBeVisible()
      await expect(rejectRow).toBeVisible()
      expect((await fetchTransaction(request, uncategorizedIds[1])).category_id).not.toBe(bakeryId)

      await acceptRow.getByRole("button", { name: "Accept" }).click()
      await expect(page.getByRole("status")).toContainText("Moved to Bakery")
      await expect(acceptRow).toHaveCount(0)
      expect((await fetchTransaction(request, uncategorizedIds[0])).category_id).toBe(bakeryId)
    } finally {
      await request.dispose()
    }
  })

  test("accepts a suggestion from the peek", async ({ page }) => {
    const title = `Corner bakery peek ${Date.now()}`
    const { request, bakeryId, uncategorizedIds } = await loginWithTrainedSuggestions(page, [title])
    try {
      await page.goto("/transactions/inbox")
      await page.getByRole("listitem", { name: title }).click()
      await expect(page).toHaveURL(/peek=\d+/)
      await page
        .getByRole("complementary", { name: title })
        .getByRole("button", { name: "Accept" })
        .click()
      await expect(page.getByRole("status")).toContainText("Moved to Bakery")
      await expect(page).not.toHaveURL(/peek=/)
      await expect(page.getByRole("listitem", { name: title })).toHaveCount(0)
      expect((await fetchTransaction(request, uncategorizedIds[0])).category_id).toBe(bakeryId)
    } finally {
      await request.dispose()
    }
  })
})
