import { request as playwrightRequest, type APIRequestContext } from "@playwright/test"
import { ADMIN_USER } from "./auth-helpers"
import { expect, test } from "./fixtures"
import { createCategory, createTransaction, getCsrfToken } from "./helpers"

async function post(request: APIRequestContext, token: string, url: string, data: object) {
  const response = await request.post(url, { headers: { "X-CSRF-Token": token }, data })
  expect(response.ok()).toBeTruthy()
  return (await response.json()) as { id: number }
}

// Auto-post rules are posted by the scheduler; an elevated admin session runs the same catch-up now.
async function runCatchUp(baseURL: string): Promise<void> {
  const admin = await playwrightRequest.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  })
  try {
    expect((await admin.post("/api/auth/login", { data: ADMIN_USER })).ok()).toBeTruthy()
    const headers = { "X-CSRF-Token": await getCsrfToken(admin) }
    const elevated = await admin.post("/api/auth/admin-elevation", {
      headers,
      data: { password: ADMIN_USER.password },
    })
    expect(elevated.ok()).toBeTruthy()
    expect((await admin.post("/api/admin/recurring-catch-up", { headers })).ok()).toBeTruthy()
  } finally {
    await admin.dispose()
  }
}

const daysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)

async function expense(
  request: APIRequestContext,
  token: string,
  categoryId: number,
  date: string,
  amountCents: number,
  title: string,
) {
  await createTransaction(request, token, {
    date,
    occurred_at: `${date}T12:00:00`,
    type: "expense",
    amount_cents: amountCents,
    category_id: categoryId,
    title,
    tags: [],
  })
}

test.describe("Digest Page", () => {
  test("steps through weeks and keeps the week in the link", async ({ page }) => {
    await page.goto("/digest?week_of=2019-03-04")
    await expect(page.getByRole("heading", { name: "Digest", level: 1 })).toBeVisible()
    const week = page.getByRole("group", { name: "Week" })
    await expect(week).toContainText("4")
    await week.getByRole("button", { name: "Previous week" }).click()
    await expect(page).toHaveURL(/week_of=2019-02-25/)
    await expect(week).toContainText("25")
    await week.getByRole("button", { name: "Next week" }).click()
    await week.getByRole("button", { name: "Next week" }).click()
    await expect(page).toHaveURL(/week_of=2019-03-11/)
  })

  test("summarizes spending, budgets and unusual transactions of a week", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const stamp = Date.now()
    const groceries = `E2E Digest Groceries ${stamp}`
    const dining = `E2E Digest Dining ${stamp}`
    const groceriesId = await createCategory(request, token, "expense", groceries)
    const diningId = await createCategory(request, token, "expense", dining)
    const unusualTitle = `Digest big shop ${stamp}`
    // The week is 4-10 March 2019; one earlier groceries purchase sets its usual size.
    await expense(request, token, groceriesId, "2019-02-20", 1_000, `Digest usual ${stamp}`)
    await expense(request, token, groceriesId, "2019-03-05", 5_000, unusualTitle)
    await expense(request, token, diningId, "2019-03-06", 1_200, `Digest dinner ${stamp}`)
    await post(request, token, "/api/budgets/templates", {
      frequency: "monthly",
      category_id: groceriesId,
      amount_cents: 20_000,
      starts_on: "2019-03-01",
      ends_on: null,
    })

    await page.goto("/digest?week_of=2019-03-04")
    const metric = (label: string) => page.getByText(label, { exact: true }).locator("..")
    await expect(metric("Spent")).toContainText(/62,00\s?€/)
    await expect(metric("Spent")).toContainText("2 transactions")
    await expect(metric("vs last week")).toContainText(/\+\s?62,00\s?€/)
    await expect(metric("vs 4-week average")).toContainText(/\+\s?59,50\s?€/)
    await expect(metric("Budgets on pace")).toContainText("1 of 1")

    const week = page.getByRole("region", { name: "Week" })
    await week.getByRole("button", { name: "Chart options" }).click()
    await page.getByRole("menuitemcheckbox", { name: "Show as table" }).click()
    const table = week.getByRole("table", { name: "Spending this week by category" })
    await expect(table.getByRole("row", { name: new RegExp(groceries) })).toContainText(/50,00\s?€/)
    await expect(table.getByRole("row", { name: new RegExp(groceries) })).toContainText("81 %")
    await expect(table.getByRole("row", { name: new RegExp(dining) })).toContainText(/12,00\s?€/)

    const top = page.getByRole("list", { name: "Top categories" })
    await expect(top.getByRole("listitem", { name: groceries })).toContainText("avg")
    const budgets = page.getByRole("list", { name: "Budgets" })
    await expect(budgets.getByRole("listitem", { name: groceries })).toContainText(/150\s?€\s*left/)
    const unusual = page.getByRole("list", { name: "Unusual transactions" })
    await expect(unusual.getByRole("listitem", { name: unusualTitle })).toContainText(/50,00\s?€/)
    await expect(page.getByText("Nothing auto-posted this week.")).toBeVisible()
  })

  test("opens the ledger for a category of the week and returns to the digest", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const stamp = Date.now()
    const category = `E2E Digest Drill ${stamp}`
    const categoryId = await createCategory(request, token, "expense", category)
    const title = `Digest drill ${stamp}`
    await expense(request, token, categoryId, "2019-05-08", 3_300, title)

    await page.goto("/digest?week_of=2019-05-06")
    await page.getByRole("list", { name: "Top categories" }).getByRole("listitem", { name: category }).click()
    await expect(page).toHaveURL(new RegExp(`/transactions\\?.*category=${categoryId}`))
    await expect(page.getByRole("list", { name: "Transactions" }).getByRole("listitem", { name: title })).toBeVisible()
    await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Digest" }).click()
    await expect(page).toHaveURL(/\/digest/)
  })

  test("opens a budget, an unusual transaction and an auto-posted rule from the digest", async ({
    page,
    request,
    baseURL,
  }) => {
    const token = await getCsrfToken(request)
    const stamp = Date.now()
    const categoryId = await createCategory(request, token, "expense", `E2E Digest Links ${stamp}`)
    const title = `Digest link big ${stamp}`
    // A weekly rule posts exactly once in any week; the week of eight days ago is complete.
    const weekOf = daysAgo(8)
    const ruleName = `Digest rule ${stamp}`
    const rule = await post(request, token, "/api/recurring", {
      name: ruleName,
      type: "expense",
      amount_cents: 700,
      currency_code: "EUR",
      category_id: categoryId,
      anchor_date: daysAgo(36),
      interval_unit: "week",
      interval_count: 1,
      next_occurrence: daysAgo(36),
      end_date: null,
      auto_post: true,
      skip_weekends: false,
      month_day_policy: "snap_to_end",
    })
    await runCatchUp(baseURL!)
    await expense(request, token, categoryId, daysAgo(8), 90_000, title)
    await post(request, token, "/api/budgets/templates", {
      frequency: "monthly",
      category_id: categoryId,
      amount_cents: 100_000,
      starts_on: daysAgo(60),
      ends_on: null,
    })

    await page.goto(`/digest?week_of=${weekOf}`)
    await page.getByRole("button", { name: "Open budgets" }).click()
    await expect(page).toHaveURL(/\/budgets/)

    await page.goto(`/digest?week_of=${weekOf}`)
    await page
      .getByRole("list", { name: "Unusual transactions" })
      .getByRole("listitem", { name: title })
      .click()
    await expect(page).toHaveURL(/\/transactions\/\d+/)

    await page.goto(`/digest?week_of=${weekOf}`)
    const posted = page.getByRole("list", { name: "Auto-posted transactions" })
    await expect(posted.getByRole("listitem", { name: ruleName })).toContainText(/7,00\s?€/)
    await posted.getByRole("listitem", { name: ruleName }).click()
    await expect(page).toHaveURL(new RegExp(`/recurring\\?peek=${rule.id}`))
  })

  test("shows empty states for a week without activity", async ({ page }) => {
    await page.goto("/digest?week_of=2015-02-02")
    await expect(page.getByRole("heading", { name: "Digest", level: 1 })).toBeVisible()
    await expect(page.getByText("No spending this week.").first()).toBeVisible()
    await expect(page.getByText("No budgets this month.")).toBeVisible()
    await expect(page.getByText("Nothing unusual this week.")).toBeVisible()
    await expect(page.getByText("Nothing auto-posted this week.")).toBeVisible()
  })
})
