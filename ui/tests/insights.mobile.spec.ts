import { expect, test } from "./fixtures"
import { createTransaction, getCsrfToken } from "./helpers"

test.describe("Insights Page (mobile)", () => {
  test("applies filters from the mobile filter sheet", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const tagName = `Mobile insight filter ${Date.now()}`
    const tagResponse = await request.post("/api/tags", {
      headers: { "X-CSRF-Token": token },
      data: { name: tagName, is_hidden_from_budget: false },
    })
    expect(tagResponse.ok()).toBeTruthy()
    await page.goto("/insights")
    await page.getByRole("button", { name: /Filters/ }).click()
    const dialog = page.getByRole("dialog", { name: "Insights filters" })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("group", { name: "Transaction type" })).toHaveCount(0)
    await dialog.getByRole("button", { name: "Exclude", exact: true }).click()
    await dialog.getByRole("checkbox", { name: tagName }).check()
    await dialog.getByRole("button", { name: "Apply" }).click()
    await expect(page).toHaveURL(/exclude_tags=/)
  })

  test("uses page tabs and renders single-month chart points", async ({
    page,
  }) => {
    await page.goto("/insights?period=this_month")

    const viewTabs = page.getByRole("tablist", { name: "Insights views" })
    await expect(viewTabs).toBeVisible()
    await expect(viewTabs.getByRole("tab")).toHaveCount(2)
    await expect(page.getByText(/^Date:/)).toHaveCount(0)
    await expect(page.getByText(/months? view$/)).toHaveCount(0)

    const chartPanel = page
      .locator('[data-financial-surface="chart"]')
      .filter({ hasText: "Monthly income vs expenses" })
      .first()
    const chart = chartPanel.getByRole("img", {
      name: "Monthly income compared with expenses",
    })
    await expect(chart.locator("svg")).toBeVisible()
    await expect(
      chart.locator('circle[fill="rgb(var(--semantic-green))"]'),
    ).toHaveCount(1)
    await expect(
      chart.locator('circle[fill="rgb(var(--semantic-red))"]'),
    ).toHaveCount(1)
  })

  test("renders an interactive net chart without horizontal page scrolling", async ({
    page,
    request,
  }) => {
    const csrfToken = await getCsrfToken(request)
    const suffix = Date.now()
    const incomeName = `Mobile Net Income ${suffix}`
    const expenseName = `Mobile Net Expense ${suffix}`
    const createCategory = async (name: string, type: "income" | "expense") => {
      const response = await request.post("/api/categories", {
        headers: { "X-CSRF-Token": csrfToken },
        data: { name, type, order: 0 },
      })
      expect(response.ok()).toBeTruthy()
      return ((await response.json()) as { id: number }).id
    }
    const incomeCategoryID = await createCategory(incomeName, "income")
    const expenseCategoryID = await createCategory(expenseName, "expense")
    const now = new Date()

    await createTransaction(request, csrfToken, {
      date: now.toISOString().slice(0, 10),
      occurred_at: now.toISOString(),
      type: "income",
      amount_cents: 99_000_000,
      category_id: incomeCategoryID,
      title: incomeName,
      tags: [],
    })
    await createTransaction(request, csrfToken, {
      date: now.toISOString().slice(0, 10),
      occurred_at: now.toISOString(),
      type: "expense",
      amount_cents: 44_000_000,
      category_id: expenseCategoryID,
      title: expenseName,
      tags: [],
    })

    await page.goto("/insights?view=net&period=this_month")
    const chart = page.getByRole("group", { name: "Income and spending chart" })
    await expect(chart).toBeVisible()
    const expenseStep = chart.locator(
      `[data-waterfall-step][aria-label^="${expenseName}:"]`
    )
    await expect(expenseStep).toBeVisible()
    expect(await expenseStep.getAttribute("data-selected")).toBeNull()

    await expenseStep.click()
    await expect(expenseStep).toHaveAttribute("data-selected", "")
    await expect(page.getByTestId("waterfall-details")).toContainText(expenseName)

    await page.getByRole("heading", { name: "Income & spending" }).click()
    expect(await expenseStep.getAttribute("data-selected")).toBeNull()
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        )
      )
      .toBeLessThanOrEqual(0)
  })
})
