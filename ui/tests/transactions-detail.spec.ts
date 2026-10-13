import type { APIRequestContext } from "@playwright/test"
import { expect, test } from "./fixtures"
import { createTransaction, ensureCategory, getCsrfToken } from "./helpers"

type StoredTransaction = {
  title: string
  amount_cents: number
  type: string
  category_id: number | null
  category: { name: string } | null
  date: string
  occurred_at: string
  description: string | null
}

async function fetchTransaction(request: APIRequestContext, id: number) {
  const response = await request.get(`/api/transactions/${id}`)
  expect(response.ok()).toBeTruthy()
  return (await response.json()) as StoredTransaction
}

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

async function seedExpense(
  request: APIRequestContext,
  label: string,
  extra: { description?: string; amount_cents?: number; tags?: string[]; date?: string } = {},
) {
  const token = await getCsrfToken(request)
  const categoryId = await ensureCategory(request, token, "expense", `E2E ${label}`)
  const title = `E2E ${label} ${Date.now()}`
  const date = extra.date ?? "2026-04-18"
  const id = await createTransaction(request, token, {
    date,
    occurred_at: `${date}T09:30:00`,
    type: "expense",
    amount_cents: extra.amount_cents ?? 1234,
    category_id: categoryId,
    title,
    description: extra.description,
    tags: extra.tags ?? [],
  })
  return { token, categoryId, title, id }
}

const peekUrl = (title: string, id: number) =>
  `/transactions?q=${encodeURIComponent(title)}&peek=${id}`

test.describe("Transaction peek and full view", () => {
  test("saves the title and amount inline with Enter and discards them with Esc", async ({
    page,
    request,
  }) => {
    const { title, id } = await seedExpense(request, "Inline Edit")
    await page.goto(peekUrl(title, id))
    const peek = page.getByRole("complementary", { name: title })

    const newTitle = `${title} renamed`
    await peek.getByRole("button", { name: "Edit Title" }).click()
    await peek.getByRole("textbox", { name: "Title" }).fill(newTitle)
    const titleSaved = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/transactions/${id}`) &&
        response.request().method() === "PUT" &&
        response.ok(),
    )
    await peek.getByRole("textbox", { name: "Title" }).press("Enter")
    await titleSaved
    await expect(peek.getByRole("button", { name: "Edit Title" })).toContainText(newTitle)
    expect((await fetchTransaction(request, id)).title).toBe(newTitle)

    await peek.getByRole("button", { name: "Edit Amount" }).click()
    await peek.getByRole("textbox", { name: "Amount" }).fill("45,67")
    await peek.getByRole("textbox", { name: "Amount" }).press("Enter")
    await expect(peek.getByRole("button", { name: "Edit Amount" })).toContainText("45,67")
    await expect.poll(async () => (await fetchTransaction(request, id)).amount_cents).toBe(4567)

    await peek.getByRole("button", { name: "Edit Title" }).click()
    await peek.getByRole("textbox", { name: "Title" }).fill("Discarded title")
    await peek.getByRole("textbox", { name: "Title" }).press("Escape")
    await expect(peek.getByRole("button", { name: "Edit Title" })).toContainText(newTitle)
    // Esc leaves the editor first; the peek stays open.
    await expect(peek).toBeVisible()
    expect((await fetchTransaction(request, id)).title).toBe(newTitle)
  })

  test("keeps the entered text and explains an invalid amount or empty title", async ({
    page,
    request,
  }) => {
    const { title, id } = await seedExpense(request, "Inline Invalid")
    await page.goto(peekUrl(title, id))
    const peek = page.getByRole("complementary", { name: title })

    await peek.getByRole("button", { name: "Edit Amount" }).click()
    const amount = peek.getByRole("textbox", { name: "Amount" })
    await amount.fill("abc")
    await amount.press("Enter")
    await expect(peek.getByRole("alert")).toHaveText("Enter a valid amount.")
    await expect(amount).toHaveValue("abc")
    await amount.press("Escape")
    await expect(peek.getByRole("alert")).toHaveCount(0)

    await peek.getByRole("button", { name: "Edit Title" }).click()
    const titleField = peek.getByRole("textbox", { name: "Title" })
    await titleField.fill("   ")
    await titleField.press("Enter")
    await expect(peek.getByRole("alert")).toHaveText("Enter a title.")
    await titleField.press("Escape")

    const stored = await fetchTransaction(request, id)
    expect(stored.title).toBe(title)
    expect(stored.amount_cents).toBe(1234)
  })

  test("changes the category, date and type from the property buttons", async ({
    page,
    request,
  }) => {
    const { token, title, id } = await seedExpense(request, "Property Edit")
    const targetName = `E2E Property Target ${Date.now()}`
    const targetId = await createCategory(request, token, "expense", targetName)
    await page.goto(peekUrl(title, id))
    const peek = page.getByRole("complementary", { name: title })

    await peek.getByRole("button", { name: /^Category / }).click()
    await page.getByRole("option", { name: targetName }).click()
    await expect(peek.getByRole("button", { name: `Category ${targetName}` })).toBeVisible()
    await expect.poll(async () => (await fetchTransaction(request, id)).category_id).toBe(targetId)

    await peek.getByRole("button", { name: /^Date / }).click()
    const popover = page.getByRole("dialog", { name: "Date" })
    await popover.getByLabel("Date").fill("2026-02-03T08:15")
    await popover.getByRole("button", { name: "Save" }).click()
    await expect(peek.getByRole("button", { name: /^Date Tue 3 Feb 2026, 08:15$/ })).toBeVisible()
    await expect.poll(async () => (await fetchTransaction(request, id)).occurred_at).toContain("2026-02-03T08:15")
    expect((await fetchTransaction(request, id)).date).toBe("2026-02-03")

    await peek.getByRole("button", { name: "Type Expense" }).click()
    await page.getByRole("menuitemcheckbox", { name: "Income" }).click()
    await expect(peek.getByRole("button", { name: "Type Income" })).toBeVisible()
    await expect(peek.getByRole("button", { name: "Category Uncategorized" })).toBeVisible()
    await expect.poll(async () => (await fetchTransaction(request, id)).type).toBe("income")
    // The server stores an unset category as Uncategorized.
    const typed = await fetchTransaction(request, id)
    expect(typed.category_id).not.toBe(targetId)
    expect(typed.category?.name).toBe("Uncategorized")
  })

  test("shows the server error and keeps the entered value when a save fails", async ({
    page,
    request,
  }) => {
    const { token, title, id } = await seedExpense(request, "Save Failure")
    const targetName = `E2E Failure Target ${Date.now()}`
    await createCategory(request, token, "expense", targetName)
    const failure = "Save failed from test"
    await page.route(`**/api/transactions/${id}`, async (route, routed) => {
      if (routed.method() !== "PUT") {
        await route.continue()
        return
      }
      await route.fulfill({ status: 500, json: { detail: failure } })
    })

    await page.goto(peekUrl(title, id))
    const peek = page.getByRole("complementary", { name: title })

    await peek.getByRole("button", { name: "Edit Title" }).click()
    const titleField = peek.getByRole("textbox", { name: "Title" })
    await titleField.fill(`${title} edited`)
    await titleField.press("Enter")
    await expect(peek.getByRole("alert")).toHaveText(failure)
    await expect(titleField).toHaveValue(`${title} edited`)
    await titleField.press("Escape")

    await peek.getByRole("button", { name: /^Category / }).click()
    await page.getByRole("option", { name: targetName }).click()
    await expect(peek.getByRole("alert")).toHaveText(failure)
    await expect(peek.getByRole("button", { name: `Category ${targetName}` })).toBeVisible()
    expect((await fetchTransaction(request, id)).title).toBe(title)
  })

  test("preserves Markdown formatting when editing and reopening notes", async ({
    page,
    request,
  }) => {
    const { title, id } = await seedExpense(request, "Notes Editing", {
      description: "**Original note**",
    })
    await page.goto(peekUrl(title, id))
    const peek = page.getByRole("complementary", { name: title })
    await expect(peek.locator("strong")).toHaveText("Original note")

    await peek.getByRole("button", { name: "Edit notes" }).click()
    const editor = peek.getByRole("textbox", { name: "Notes" })
    await expect(editor.locator("strong")).toHaveText("Original note")
    await editor.press("ControlOrMeta+ArrowRight")
    await editor.pressSequentially(" updated")
    await editor.press("ControlOrMeta+Enter")
    await expect(editor).toHaveCount(0)
    await expect(peek.locator("strong")).toHaveText("Original note updated")
    await expect
      .poll(async () => (await fetchTransaction(request, id)).description)
      .toBe("**Original note updated**")

    await page.reload()
    await expect(page.getByRole("complementary", { name: title }).locator("strong")).toHaveText(
      "Original note updated",
    )
  })

  test("discards note edits with Esc", async ({ page, request }) => {
    const { title, id } = await seedExpense(request, "Notes Escape", {
      description: "**Original note**",
    })
    await page.goto(peekUrl(title, id))
    const peek = page.getByRole("complementary", { name: title })

    await peek.getByRole("button", { name: "Edit notes" }).click()
    const editor = peek.getByRole("textbox", { name: "Notes" })
    await editor.press("ControlOrMeta+ArrowRight")
    await editor.pressSequentially(" updated")
    await editor.press("Escape")
    await expect(editor).toHaveCount(0)
    await expect(peek.locator("strong")).toHaveText("Original note")
    await expect(peek).toBeVisible()
    // A late blur must not save the discarded text.
    await page.waitForTimeout(500)
    expect((await fetchTransaction(request, id)).description).toBe("**Original note**")
  })

  test("adds notes to a transaction that has none", async ({ page, request }) => {
    const { title, id } = await seedExpense(request, "Notes Empty")
    await page.goto(peekUrl(title, id))
    const peek = page.getByRole("complementary", { name: title })

    await peek.getByRole("button", { name: "Add notes" }).click()
    await peek.getByRole("textbox", { name: "Notes" }).pressSequentially("Plain note")
    // Leaving the editor saves.
    await peek.getByRole("heading", { name: "Notes" }).click()
    await expect(peek.getByText("Plain note")).toBeVisible()
    await expect
      .poll(async () => (await fetchTransaction(request, id)).description)
      .toBe("Plain note")
  })

  test("opens the full view from the peek and returns to the filtered list", async ({
    page,
    request,
  }) => {
    const { categoryId, title, id } = await seedExpense(request, "Full View", {
      tags: ["detailflow"],
      date: "2026-04-12",
    })
    const listParams = new URLSearchParams({
      period: "custom",
      start: "2026-04-01",
      end: "2026-04-30",
      type: "expense",
      category: String(categoryId),
      q: title,
    })
    const listUrl = `/transactions?${listParams.toString()}`
    await page.goto(listUrl)

    await page.getByRole("listitem", { name: title }).click()
    await page.getByRole("complementary", { name: title }).getByRole("button", { name: "Open full view" }).click()
    await expect(page).toHaveURL(new RegExp(`/transactions/${id}$`))
    const main = page.getByRole("main")
    await expect(main.getByRole("heading", { name: title })).toBeVisible()
    await expect(main.getByRole("button", { name: "Edit Title" })).toContainText(title)

    await main.getByRole("link", { name: "Transactions", exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`^[^?]*/transactions\\?${listParams.toString().replace(/[+]/g, "\\+")}$`))
    await expect(page.getByRole("list", { name: "Transactions" }).getByRole("listitem")).toHaveCount(1)
  })

  test("loads the full view directly with a breadcrumb back to the ledger", async ({
    page,
    request,
  }) => {
    const { title, id } = await seedExpense(request, "Direct Full View")
    await page.goto("about:blank")
    await page.goto(`/transactions/${id}`)
    const main = page.getByRole("main")
    await expect(main.getByRole("button", { name: "Edit Title" })).toContainText(title)

    await main.getByRole("link", { name: "Transactions", exact: true }).click()
    await expect(page).toHaveURL("/transactions")
  })

  test("redirects the retired edit route to the full view", async ({ page, request }) => {
    const { title, id } = await seedExpense(request, "Edit Redirect")
    await page.goto(`/transactions/${id}/edit`)
    await expect(page).toHaveURL(new RegExp(`/transactions/${id}$`))
    await expect(page.getByRole("main").getByRole("button", { name: "Edit Title" })).toContainText(title)
  })

  test("renders income metadata, tags and notes in the full view", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "income", "E2E Detail Summary")
    const title = `E2E Detail Summary ${Date.now()}`
    const id = await createTransaction(request, token, {
      date: "2026-04-18",
      occurred_at: "2026-04-18T14:05:00",
      type: "income",
      amount_cents: 98765,
      category_id: categoryId,
      title,
      description: "**Reimbursement note** for lunch",
      tags: ["team", "lunch"],
      is_reimbursement: true,
    })

    await page.goto(`/transactions/${id}`)
    const main = page.getByRole("main")
    await expect(main.getByRole("button", { name: "Edit Amount" })).toContainText("+ 987,65 €")
    await expect(main.getByRole("button", { name: "Type Income" })).toBeVisible()
    await expect(main.getByRole("button", { name: /^Date Sat 18 Apr 2026, 14:05$/ })).toBeVisible()
    await expect(main.getByText("team", { exact: true })).toBeVisible()
    await expect(main.getByText("lunch", { exact: true })).toBeVisible()
    await expect(main.getByRole("switch", { name: "Reimbursement" })).toBeChecked()
    await expect(main.locator("strong")).toHaveText("Reimbursement note")
  })

  test("shows durable purchase metadata and an empty notes prompt", async ({ page, request }) => {
    const { token, title, id } = await seedExpense(request, "Durable Detail", {
      amount_cents: 45210,
    })
    const durable = await request.post(`/api/transactions/${id}/durable`, {
      headers: { "X-CSRF-Token": token },
      data: { expected_lifespan_days: 730, acquired_on: "2026-04-01" },
    })
    expect(durable.ok()).toBeTruthy()

    await page.goto(`/transactions/${id}`)
    const main = page.getByRole("main")
    await expect(main.getByRole("heading", { name: title })).toBeVisible()
    await expect(main.getByRole("button", { name: /^Durable 2 years from 1 Apr/ })).toContainText("per day")
    await expect(main.getByRole("button", { name: "Add notes" })).toBeVisible()
  })
})
