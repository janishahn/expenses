import { expect, test } from "./fixtures"
import type { APIRequestContext, Page } from "@playwright/test"
import { createTransaction, getCsrfToken } from "./helpers"

test.describe.configure({ mode: "parallel" })

async function createCategory(
  request: APIRequestContext,
  token: string,
  name: string
): Promise<number> {
  const response = await request.post("/api/categories", {
    headers: { "X-CSRF-Token": token },
    data: { name, type: "expense", order: 0 },
  })
  expect(response.ok()).toBeTruthy()
  return ((await response.json()) as { id: number }).id
}

async function createTag(
  request: APIRequestContext,
  token: string,
  name: string
): Promise<number> {
  const response = await request.post("/api/tags", {
    headers: { "X-CSRF-Token": token },
    data: { name, is_hidden_from_budget: false },
  })
  expect(response.ok()).toBeTruthy()
  return ((await response.json()) as { id: number }).id
}

async function seed(
  request: APIRequestContext,
  token: string,
  title: string,
  overrides: Partial<Parameters<typeof createTransaction>[2]> = {}
): Promise<number> {
  const categoryId =
    overrides.category_id ??
    (await createCategory(request, token, `Mobile spec ${Date.now()}-${Math.random()}`))
  const today = new Date().toISOString().slice(0, 10)
  return createTransaction(request, token, {
    date: today,
    occurred_at: `${today}T12:00:00`,
    type: "expense",
    amount_cents: 1234,
    category_id: categoryId,
    title,
    tags: [],
    ...overrides,
  })
}

async function fetchTransaction(request: APIRequestContext, id: number) {
  const response = await request.get(`/api/transactions/${id}`)
  expect(response.ok()).toBeTruthy()
  return (await response.json()) as {
    title: string
    amount_cents: number
    category_id: number | null
    description: string | null
  }
}

async function expectNoHorizontalOverflow(page: Page) {
  const width = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(width.scroll).toBeLessThanOrEqual(width.client)
}

test.describe("Transactions Page (mobile)", () => {
  test("sets type, category and tags in the Filter sheet and removes them again", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const stamp = Date.now()
    const marker = `Mobile filter ${stamp}`
    const categoryName = `Filter category ${stamp}`
    const tagName = `filter-tag-${stamp}`
    const categoryId = await createCategory(request, token, categoryName)
    const tagId = await createTag(request, token, tagName)
    const match = await seed(request, token, `${marker} match`, {
      category_id: categoryId,
      tags: [tagName],
    })
    const other = await seed(request, token, `${marker} other`)

    await page.goto(`/transactions?q=${encodeURIComponent(marker)}`)
    const list = page.getByRole("list", { name: "Transactions" })
    await expect(list.getByRole("listitem", { name: `${marker} match` })).toBeVisible()
    await expect(list.getByRole("listitem", { name: `${marker} other` })).toBeVisible()
    await expect(page.getByRole("button", { name: "Clear type filter" })).toHaveCount(0)

    await page.getByRole("button", { name: "Filter", exact: true }).tap()
    const sheet = page.getByRole("dialog", { name: "Filter" })
    await sheet.getByRole("radio", { name: "Expense" }).tap()
    await expect(page).toHaveURL(/type=expense/)
    await sheet.getByLabel("Category").selectOption(String(categoryId))
    await expect(page).toHaveURL(new RegExp(`category=${categoryId}`))
    await sheet.getByRole("checkbox", { name: tagName }).tap()
    await expect(page).toHaveURL(new RegExp(`tags=${tagId}`))
    await page.keyboard.press("Escape")
    await expect(sheet).toBeHidden()

    await expect(list.getByRole("listitem", { name: `${marker} match` })).toBeVisible()
    await expect(list.getByRole("listitem", { name: `${marker} other` })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Filter · 3" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Clear type filter" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Clear category filter" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Clear tag filter" })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await page.getByRole("button", { name: "Clear tag filter" }).tap()
    await expect(page).not.toHaveURL(/tags=/)
    await page.getByRole("button", { name: "Clear category filter" }).tap()
    await expect(page).not.toHaveURL(/category=/)
    await expect(list.getByRole("listitem", { name: `${marker} other` })).toBeVisible()
    await page.getByRole("button", { name: "Clear type filter" }).tap()
    await expect(page).not.toHaveURL(/type=/)
    await expect(page.getByRole("button", { name: "Filter", exact: true })).toBeVisible()
    expect(match).not.toBe(other)
  })

  test("selects rows from More actions and changes their category from the bulk bar", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const stamp = Date.now()
    const marker = `Mobile select ${stamp}`
    const targetName = `Select target ${stamp}`
    const targetId = await createCategory(request, token, targetName)
    const ids = [
      await seed(request, token, `${marker} one`),
      await seed(request, token, `${marker} two`),
      await seed(request, token, `${marker} three`),
    ]

    await page.goto(`/transactions?q=${encodeURIComponent(marker)}`)
    const tabs = page.getByRole("navigation", { name: "Tabs" })
    await expect(tabs).toBeVisible()
    await page.getByRole("button", { name: "More actions" }).tap()
    await page.getByRole("menuitem", { name: "Select" }).tap()

    const bulk = page.getByRole("toolbar", { name: "Selected rows" })
    await expect(bulk).toBeVisible()
    await expect(tabs).toBeHidden()
    const list = page.getByRole("list", { name: "Transactions" })
    await list.getByRole("listitem", { name: `${marker} one` }).tap()
    await list.getByRole("listitem", { name: `${marker} two` }).tap()
    await expect(page).not.toHaveURL(/peek=/)
    await expect(bulk).toContainText("2 selected")
    await expect(list.getByRole("checkbox", { name: `Select ${marker} three` })).not.toBeChecked()

    await list.getByRole("listitem", { name: `${marker} two` }).tap()
    await expect(bulk).toContainText("1 selected")
    await list.getByRole("listitem", { name: `${marker} two` }).tap()
    await expect(bulk).toContainText("2 selected")

    await bulk.getByRole("button", { name: "Category" }).tap()
    await page.getByRole("combobox", { name: "Set category" }).fill(targetName)
    await page.getByRole("option", { name: targetName }).tap()
    const confirm = page.getByRole("dialog", { name: "Change the category of 2 transactions?" })
    await confirm.getByRole("button", { name: "Apply" }).tap()
    await expect(page.getByRole("status")).toContainText("Updated 2 transactions")
    await expect(bulk).toBeHidden()
    await expect(tabs).toBeVisible()

    expect((await fetchTransaction(request, ids[0])).category_id).toBe(targetId)
    expect((await fetchTransaction(request, ids[1])).category_id).toBe(targetId)
    expect((await fetchTransaction(request, ids[2])).category_id).not.toBe(targetId)
  })

  test("edits title, amount and category inline in the peek", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const stamp = Date.now()
    const title = `Mobile inline ${stamp}`
    const targetName = `Inline target ${stamp}`
    const targetId = await createCategory(request, token, targetName)
    const id = await seed(request, token, title, { amount_cents: 1234 })

    await page.goto(`/transactions?q=${encodeURIComponent(title)}`)
    await page.getByRole("listitem", { name: title }).tap()
    const peek = page.getByRole("complementary", { name: title })

    await peek.getByRole("button", { name: "Edit Title" }).tap()
    await peek.getByRole("textbox", { name: "Title" }).fill("")
    await peek.getByRole("textbox", { name: "Title" }).press("Enter")
    await expect(peek.getByText("Enter a title.")).toBeVisible()
    await peek.getByRole("textbox", { name: "Title" }).fill(`${title} renamed`)
    await peek.getByRole("textbox", { name: "Title" }).press("Enter")
    await expect(peek.getByRole("button", { name: "Edit Title" })).toHaveText(`${title} renamed`)

    await peek.getByRole("button", { name: "Edit Amount" }).tap()
    for (const invalid of ["abc", "", "12,345", "0"]) {
      await peek.getByRole("textbox", { name: "Amount" }).fill(invalid)
      await peek.getByRole("textbox", { name: "Amount" }).press("Enter")
      await expect(peek.getByText("Enter a valid amount.")).toBeVisible()
    }
    await peek.getByRole("textbox", { name: "Amount" }).fill("45,60")
    await peek.getByRole("textbox", { name: "Amount" }).press("Enter")
    await expect(peek.getByRole("button", { name: "Edit Amount" })).toContainText("45,60")

    await peek.getByRole("button", { name: /^Category / }).tap()
    await page.getByRole("combobox", { name: "Category" }).fill(targetName)
    await page.getByRole("option", { name: targetName }).tap()
    await expect(peek.getByRole("button", { name: `Category ${targetName}` })).toBeVisible()

    await expect
      .poll(async () => {
        const saved = await fetchTransaction(request, id)
        return [saved.title, saved.amount_cents, saved.category_id]
      })
      .toEqual([`${title} renamed`, 4560, targetId])
  })

  test("allocates a reimbursement from the expense peek and tracks it as durable from More actions", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const stamp = Date.now()
    const title = `Mobile reimbursed ${stamp}`
    const id = await seed(request, token, title, { amount_cents: 6000 })
    const incomeCategory = await request.post("/api/categories", {
      headers: { "X-CSRF-Token": token },
      data: { name: `Mobile reimbursement source ${stamp}`, type: "income", order: 0 },
    })
    expect(incomeCategory.ok()).toBeTruthy()
    const today = new Date().toISOString().slice(0, 10)
    const reimbursementId = await createTransaction(request, token, {
      date: today,
      occurred_at: `${today}T13:00:00`,
      type: "income",
      amount_cents: 9000,
      category_id: ((await incomeCategory.json()) as { id: number }).id,
      title: `Mobile share ${stamp}`,
      tags: [],
      is_reimbursement: true,
    })

    await page.goto(`/transactions?q=${encodeURIComponent(title)}`)
    await page.getByRole("listitem", { name: title }).tap()
    const peek = page.getByRole("complementary", { name: title })
    await expect(peek.getByRole("button", { name: /^Durable/ })).toHaveCount(0)
    await peek.getByRole("button", { name: "Add reimbursement" }).tap()
    const sheet = page.getByRole("dialog", { name: "Add reimbursement" })
    await sheet.getByLabel("From").selectOption(String(reimbursementId))
    await sheet.getByRole("button", { name: "⅓" }).tap()
    await expect(sheet.getByRole("textbox", { name: "Amount" })).toHaveValue("20,00")
    await sheet.getByRole("button", { name: "Allocate" }).tap()
    await expect(sheet).toBeHidden()
    await expect(peek.getByText("Net", { exact: true })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await peek.getByRole("button", { name: "More actions" }).tap()
    await page.getByRole("menuitem", { name: "Track as durable…" }).tap()
    await page.getByRole("dialog", { name: "Durable purchase" }).getByRole("button", { name: "Track" }).tap()
    // A year at the 40 € left after the reimbursement.
    await expect(peek.getByRole("button", { name: /^Durable / })).toContainText("0,11 € per day")
    await peek.getByRole("button", { name: /^Durable / }).tap()
    const editor = page.getByRole("dialog", { name: "Durable purchase" })
    await editor.getByLabel("Ended").fill(today)
    await editor.getByRole("button", { name: "Save" }).tap()
    await expect(peek.getByRole("button", { name: /^Durable .*, ended / })).toBeVisible()

    await expect
      .poll(async () => {
        const saved = (await (await request.get(`/api/transactions/${id}`)).json()) as {
          reimbursed_total_cents: number
          durable_purchase: { ended_on: string | null } | null
        }
        return [saved.reimbursed_total_cents, saved.durable_purchase?.ended_on]
      })
      .toEqual([2000, today])

    // The row shows the net with the reimbursed mark, without the charged amount.
    await page.goto(`/transactions?q=${encodeURIComponent(title)}`)
    const row = page.getByRole("listitem", { name: title })
    await expect(row.getByRole("img", { name: "Reimbursed" })).toBeVisible()
    await expect(row).toContainText("40,00")
    await expect(row.locator("s")).toBeHidden()
  })

  test("deletes a transaction from its peek and permanently deletes it from Trash", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const title = `Mobile delete ${Date.now()}`
    await seed(request, token, title)

    await page.goto(`/transactions?q=${encodeURIComponent(title)}`)
    await page.getByRole("listitem", { name: title }).tap()
    await page
      .getByRole("complementary", { name: title })
      .getByRole("button", { name: "More actions" })
      .tap()
    await page.getByRole("menuitem", { name: "Delete" }).tap()
    await page
      .getByRole("dialog", { name: "Delete this transaction?" })
      .getByRole("button", { name: "Delete", exact: true })
      .tap()
    await expect(page.getByRole("listitem", { name: title })).toHaveCount(0)

    await page.getByRole("button", { name: "More actions" }).tap()
    await page.getByRole("link", { name: "Trash" }).tap()
    await expect(page).toHaveURL(/\/transactions\/deleted$/)
    const list = page.getByRole("list", { name: "Deleted transactions" })
    const deletedRow = list.getByRole("listitem", { name: title })
    await expect(deletedRow).toBeVisible()

    await deletedRow.tap()
    const bulk = page.getByRole("toolbar", { name: "Selected rows" })
    await expect(bulk).toContainText("1 selected")
    await bulk.getByRole("button", { name: "Delete forever" }).tap()
    await page
      .getByRole("dialog", { name: "Delete 1 transaction forever?" })
      .getByRole("button", { name: "Delete forever" })
      .tap()
    await expect(page.getByRole("status")).toContainText("Deleted 1 transaction forever")
    await expect(deletedRow).toHaveCount(0)
  })
})
