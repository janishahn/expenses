import { test, expect, type APIRequestContext } from "./fixtures"
import { createTransaction, getCsrfToken } from "./helpers"

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

  test("uses page tabs without repeating the selected period", async ({ page }) => {
    await page.goto("/insights?period=this_month")
    await expect(page.getByText(/^Date:/)).toHaveCount(0)
    await expect(page.getByText(/months? view$/)).toHaveCount(0)
    await expect(page.getByRole("tablist", { name: "Insights views" })).toBeVisible()
    await expect(page.getByRole("tab", { name: "Analysis" })).toHaveAttribute(
      "aria-selected",
      "true",
    )
  })

  test("keeps the page canvas stable when tab content changes document height", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1000 })
    await page.goto("/insights")
    await expect(
      page.getByRole("heading", { name: "Monthly income vs expenses" }),
    ).toBeVisible()

    const pageCanvas = page.locator(".page-enter")
    const analysisBox = await pageCanvas.boundingBox()
    const analysisLayout = await page.evaluate(() => ({
      clientHeight: document.documentElement.clientHeight,
      scrollHeight: document.documentElement.scrollHeight,
    }))
    expect(analysisBox).not.toBeNull()
    expect(analysisLayout.scrollHeight).toBeGreaterThan(analysisLayout.clientHeight)

    await page.getByRole("tab", { name: "Net" }).click()
    await expect(page).toHaveURL(/view=net/)
    await expect(page.getByRole("tab", { name: "Net" })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    const netBox = await pageCanvas.boundingBox()
    const netLayout = await page.evaluate(() => ({
      clientHeight: document.documentElement.clientHeight,
      scrollHeight: document.documentElement.scrollHeight,
      scrollbarGutter: getComputedStyle(document.documentElement).scrollbarGutter,
      overflowY: getComputedStyle(document.documentElement).overflowY,
    }))
    expect(netBox).not.toBeNull()
    expect(netLayout.scrollHeight).toBeLessThanOrEqual(netLayout.clientHeight)
    expect(netLayout.scrollbarGutter).toBe("auto")
    expect(netLayout.overflowY).toBe("scroll")
    expect(Math.abs(netBox!.x - analysisBox!.x)).toBeLessThanOrEqual(0.5)
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

  test("should show filter controls at tablet viewport (768-1024px)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 900, height: 700 })
    await page.goto("/insights")
    await page.waitForLoadState("networkidle")
    await expect(page.getByRole("button", { name: "Filters", exact: true })).toBeVisible()
  })

  test("should render net view", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const suffix = Date.now()
    const incomeCategoryName = `E2E Net Income ${suffix}`
    const expenseCategoryName = `E2E Net Expense ${suffix}`
    const incomeCategory = await createCategory(request, token, incomeCategoryName, "income")
    const expenseCategory = await createCategory(request, token, expenseCategoryName, "expense")

    await createTransaction(request, token, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "income",
      amount_cents: 150_000,
      category_id: incomeCategory,
      title: `E2E Net Income ${Date.now()}`,
      tags: [],
    })
    await createTransaction(request, token, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 90_000,
      category_id: expenseCategory,
      title: `E2E Net Expense ${Date.now()}`,
      tags: [],
    })

    await page.goto("/insights")
    await page.getByRole("tab", { name: "Net" }).click()
    await expect(page).toHaveURL(/view=net/)
    await expect(page.getByRole("heading", { name: "Income & spending" })).toBeVisible()
    await expect(page.getByRole("button", { name: "View chart data" })).toBeVisible()
    await expect(
      page.getByRole("group", { name: "Income and spending chart" }),
    ).toBeVisible()

    const expenseStep = page.locator(
      `.net-chart-section svg [data-waterfall-step][aria-label^="${expenseCategoryName}:"]`
    )
    await expect(expenseStep).toBeVisible()
    expect(await expenseStep.getAttribute("data-selected")).toBeNull()

    const incomeStep = page.locator(
      `.net-chart-section svg [data-waterfall-step][aria-label^="${incomeCategoryName}:"]`
    )
    await expenseStep.hover()
    await incomeStep.hover()
    await expenseStep.hover()
    await expect(page.getByRole("tooltip")).toContainText(expenseCategoryName)
    await expect(page.getByRole("tooltip")).not.toBeEmpty()

    await expenseStep.click()
    await expect(expenseStep).toHaveAttribute("data-selected", "")
    await expect(page.getByTestId("waterfall-details")).toContainText(expenseCategoryName)

    await page.getByRole("heading", { name: "Income & spending" }).click()
    expect(await expenseStep.getAttribute("data-selected")).toBeNull()

    await expenseStep.click()
    await page.getByTestId("waterfall-details").getByRole("button", { name: "Open transactions" }).click()
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

    await page.goto(`/insights?view=net&period=this_month&tag=${tagId}`)
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("light")

    const expenseStep = page.locator(
      `.net-chart-section svg [data-waterfall-step][aria-label^="${expenseCategoryName}:"]`
    )
    await expect(expenseStep).toBeVisible()
    await expenseStep.click()
    await page.getByTestId("waterfall-details").getByRole("button", { name: "Open transactions" }).click()

    await expect(page).toHaveURL(
      new RegExp(
        `/transactions\\?(?=.*period=this_month)(?=.*type=expense)(?=.*category=${expenseCategoryId})(?=.*tags=${tagId})`
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

  test("shows merged categories in insights net drill-downs", async ({
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

    await page.goto("/insights?view=net&period=this_month")
    await page.getByRole("button", { name: "View chart data" }).click()
    const dataDialog = page.getByRole("dialog", { name: "Chart data" })
    const targetNodeButton = dataDialog.getByRole("button", {
      name: `Open ${targetName} transactions`,
    })
    await expect(targetNodeButton).toBeVisible()
    await expect(dataDialog.getByText(sourceName, { exact: true })).toHaveCount(0)

    await targetNodeButton.click()
    await expect(page).toHaveURL(
      new RegExp(
        `/transactions\\?(?=.*period=this_month)(?=.*type=expense)(?=.*category=${targetCategoryId})`
      )
    )
    await expect(page.locator("body")).toContainText(mergedExpenseTitle)
  })

})
