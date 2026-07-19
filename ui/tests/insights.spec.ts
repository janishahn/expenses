import { test, expect, type APIRequestContext } from "./fixtures"
import { createTransaction, ensureCategory, getCsrfToken } from "./helpers"

const THEME_STORAGE_KEY = "ew.theme.preference"

async function createCategory(
  request: APIRequestContext,
  csrfToken: string,
  name: string,
  type: "income" | "expense"
): Promise<number> {
  const response = await request.post("/api/categories", {
    headers: { "X-CSRF-Token": csrfToken },
    data: { name, type, order: 0 },
  })
  expect(response.ok()).toBeTruthy()
  const payload = (await response.json()) as { id: number }
  return payload.id
}

async function createTag(
  request: APIRequestContext,
  csrfToken: string,
  name: string
): Promise<number> {
  const response = await request.post("/api/tags", {
    headers: { "X-CSRF-Token": csrfToken },
    data: { name, is_hidden_from_budget: false },
  })
  expect(response.ok()).toBeTruthy()
  const payload = (await response.json()) as { id: number }
  return payload.id
}

test.describe("Insights Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/insights")
  })

  test("should display insights heading", async ({ page }) => {
    await expect(page.locator("main h1")).toContainText("Insights")
  })

  test("labels the analysis range from the selected period", async ({ page }) => {
    await page.goto("/insights?period=this_month")
    await expect(page.getByText("1 month view", { exact: true })).toBeVisible()
  })

  test("should show analytics content", async ({ page }) => {
    await page.waitForLoadState("networkidle")
    await expect(
      page.getByRole("heading", { name: "Monthly income vs expenses" })
    ).toBeVisible()
    await expect(page.getByRole("heading", { name: "Top categories" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Budget vs actual" })).toBeVisible()
  })

  test("should load without errors", async ({ page }) => {
    await expect(page.locator("text=Unable to load")).not.toBeVisible()
    await expect(page.getByTestId("app-loading-fallback")).toHaveCount(0, { timeout: 10000 })
  })

  test("should apply filters", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole("button", { name: /Filters/ }).click()
    const dialog = page.getByRole("dialog", { name: "Insights filters" })
    await expect(dialog).toBeVisible()
    await dialog.getByRole("button", { name: "Expense", exact: true }).click()
    await dialog.getByRole("button", { name: "Apply" }).click()
    await expect(page).toHaveURL(/type=expense/)
  })

  test("should show filter controls at tablet viewport (768-1024px)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 900, height: 700 })
    await page.goto("/insights")
    await page.waitForLoadState("networkidle")
    const mobileFilters = page.getByRole("button", { name: /Filters/ })
    const desktopFilters = page.locator("label", { hasText: "Tag filter" })
    const hasMobile = await mobileFilters.isVisible().catch(() => false)
    const hasDesktop = await desktopFilters.isVisible().catch(() => false)
    expect(hasMobile || hasDesktop).toBeTruthy()
  })

  test("should render flow tab", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const incomeCategory = await ensureCategory(request, token, "income", "E2E Flow Income")
    const expenseCategory = await ensureCategory(request, token, "expense", "E2E Flow Expense")

    await createTransaction(request, token, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "income",
      amount_cents: 150_000,
      category_id: incomeCategory,
      title: `E2E Flow Income ${Date.now()}`,
      tags: [],
    })
    await createTransaction(request, token, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 90_000,
      category_id: expenseCategory,
      title: `E2E Flow Expense ${Date.now()}`,
      tags: [],
    })

    await page.goto("/insights")
    await page.getByRole("button", { name: "Flow" }).click()
    await expect(page).toHaveURL(/view=flow/)
    await expect(page.getByText("Cash flow")).toBeVisible()
    await expect(page.getByText(/Date:/).first()).toBeVisible()
    const expenseNodesPanel = page
      .locator('[data-financial-surface="ledger"]')
      .filter({ hasText: "Expense nodes" })
      .first()
    const expenseNodeButton = expenseNodesPanel.locator("button").first()
    await expect(expenseNodeButton).toBeVisible()
    await expenseNodeButton.click()
    await expect(page).toHaveURL(/\/transactions\?/)
    await expect(page).toHaveURL(/type=expense/)
  })

  test("keeps insights drill-down detail/edit return context coherent", async ({
    page,
    request,
  }) => {
    const csrfToken = await getCsrfToken(request)
    const suffix = Date.now()
    const incomeCategoryId = await createCategory(
      request,
      csrfToken,
      `E2E Cross Income ${suffix}`,
      "income"
    )
    const tagName = `E2E Cross Tag ${suffix}`
    const tagId = await createTag(request, csrfToken, tagName)
    const expenseCategoryName = `E2E Cross Expense ${suffix}`
    const expenseCategoryId = await createCategory(
      request,
      csrfToken,
      expenseCategoryName,
      "expense"
    )
    const expenseTitle = `E2E Cross Drilldown ${suffix}`

    await createTransaction(request, csrfToken, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "income",
      amount_cents: 250_000,
      category_id: incomeCategoryId,
      title: `E2E Cross Income Txn ${suffix}`,
      tags: [],
    })
    const expenseTxnId = await createTransaction(request, csrfToken, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 88_000,
      category_id: expenseCategoryId,
      title: expenseTitle,
      tags: [tagName],
    })

    await page.addInitScript(([storageKey, value]) => {
      window.localStorage.setItem(storageKey, value)
    }, [THEME_STORAGE_KEY, "light"] as const)

    await page.goto(`/insights?view=flow&period=this_month&tag=${tagId}`)
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("light")

    const expenseNodesPanel = page
      .locator('[data-financial-surface="ledger"]')
      .filter({ hasText: "Expense nodes" })
      .first()
    const expenseNodeButton = expenseNodesPanel.getByRole("button", {
      name: new RegExp(`^${expenseCategoryName}$`),
    })
    await expect(expenseNodeButton).toBeVisible()
    await expenseNodeButton.click()

    await expect(page).toHaveURL(
      new RegExp(
        `/transactions\\?(?=.*period=this_month)(?=.*type=expense)(?=.*category=${expenseCategoryId})(?=.*tag=${tagId})`
      )
    )
    const drilldownUrl = page.url()

    const row = page.locator("div.surface-card").filter({ hasText: expenseTitle }).first()
    await expect(row).toBeVisible()
    await row.click()
    await expect(page).toHaveURL(new RegExp(`/transactions/${expenseTxnId}$`))

    await page.locator(`a[href="/transactions/${expenseTxnId}/edit"]`).first().click()
    await expect(page).toHaveURL(new RegExp(`/transactions/${expenseTxnId}/edit$`))

    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`/transactions/${expenseTxnId}$`))

    await page.locator(`a[href="/transactions/${expenseTxnId}/edit"]`).first().click()
    await expect(page).toHaveURL(new RegExp(`/transactions/${expenseTxnId}/edit$`))

    await page.locator(`a[href="/transactions/${expenseTxnId}"]`).first().click()
    await expect(page).toHaveURL(new RegExp(`/transactions/${expenseTxnId}$`))

    await page.getByRole("link", { name: "← Back" }).click()
    await expect(page).toHaveURL(drilldownUrl)
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("light")
  })

  test("shows merged categories in insights flow drill-downs", async ({
    page,
    request,
  }) => {
    const csrfToken = await getCsrfToken(request)
    const suffix = Date.now()
    const incomeCategoryId = await createCategory(
      request,
      csrfToken,
      `E2E Merge Income ${suffix}`,
      "income"
    )
    const sourceName = `E2E Merge Source ${suffix}`
    const targetName = `E2E Merge Target ${suffix}`
    const sourceCategoryId = await createCategory(request, csrfToken, sourceName, "expense")
    const targetCategoryId = await createCategory(request, csrfToken, targetName, "expense")

    await createTransaction(request, csrfToken, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "income",
      amount_cents: 210_000,
      category_id: incomeCategoryId,
      title: `E2E Merge Income Txn ${suffix}`,
      tags: [],
    })
    const mergedExpenseTitle = `E2E Merge Expense Txn ${suffix}`
    await createTransaction(request, csrfToken, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 96_000,
      category_id: sourceCategoryId,
      title: mergedExpenseTitle,
      tags: [],
    })

    const mergeResponse = await request.post("/api/categories/merge", {
      headers: { "X-CSRF-Token": csrfToken },
      data: {
        source_category_id: sourceCategoryId,
        target_category_id: targetCategoryId,
      },
    })
    expect(mergeResponse.ok()).toBeTruthy()

    await page.goto("/insights?view=flow&period=this_month")
    const expenseNodesPanel = page
      .locator('[data-financial-surface="ledger"]')
      .filter({ hasText: "Expense nodes" })
      .first()

    const targetNodeButton = expenseNodesPanel.getByRole("button", {
      name: new RegExp(`^${targetName}$`),
    })
    await expect(targetNodeButton).toBeVisible()
    await expect(
      expenseNodesPanel.getByRole("button", { name: new RegExp(`^${sourceName}$`) })
    ).toHaveCount(0)

    await targetNodeButton.click()
    await expect(page).toHaveURL(
      new RegExp(
        `/transactions\\?(?=.*period=this_month)(?=.*type=expense)(?=.*category=${targetCategoryId})`
      )
    )
    await expect(page.locator("body")).toContainText(mergedExpenseTitle)
  })

})
