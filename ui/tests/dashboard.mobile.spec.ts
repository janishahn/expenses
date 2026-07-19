import { expect, test } from "./fixtures"
import {
  createTransaction,
  ensureCategory,
  getCsrfToken,
  loginAsIsolatedUser,
} from "./helpers"
import type { APIRequestContext } from "@playwright/test"

test.describe.configure({ mode: "parallel" })

function localToday(): string {
  const now = new Date()
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-")
}

async function createOverallMonthlyBudget(
  request: APIRequestContext,
  csrfToken: string,
  amountCents: number
): Promise<void> {
  const response = await request.post("/api/budgets/templates", {
    headers: { "X-CSRF-Token": csrfToken },
    data: {
      frequency: "monthly",
      category_id: null,
      amount_cents: amountCents,
      starts_on: `${localToday().slice(0, 7)}-01`,
      ends_on: null,
    },
  })
  expect(response.ok()).toBeTruthy()
}

test.describe("Dashboard Page (mobile)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
  })

  test("does not request the desktop-only forecast", async ({ page }) => {
    let forecastRequests = 0
    await page.route("**/api/forecast?*", (route) => {
      forecastRequests += 1
      return route.continue()
    })

    await page.reload()
    await expect(page.getByTestId("dashboard-balance-card")).toBeVisible()
    expect(forecastRequests).toBe(0)
  })

  test("dismisses add transaction dialog on outside tap", async ({ page }) => {
    await page.getByRole("button", { name: "Add transaction", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Add transaction" })
    await expect(dialog).toBeVisible()
    const dialogBounds = await dialog.boundingBox()
    if (!dialogBounds) {
      throw new Error("Expected add transaction dialog bounds")
    }
    const viewport = await page.evaluate(() => ({
      height: window.visualViewport?.height ?? window.innerHeight,
      width: window.visualViewport?.width ?? window.innerWidth,
    }))
    expect(
      Math.abs(viewport.height / 2 - (dialogBounds.y + dialogBounds.height / 2))
    ).toBeLessThan(24)
    expect(
      Math.abs(viewport.width / 2 - (dialogBounds.x + dialogBounds.width / 2))
    ).toBeLessThan(24)
    expect(dialogBounds.y).toBeGreaterThanOrEqual(12)
    expect(viewport.height - (dialogBounds.y + dialogBounds.height)).toBeGreaterThanOrEqual(12)
    await page.mouse.click(10, 10)
    await expect(dialog).toBeHidden()
  })

  test("quick adds a transaction from the mobile sheet", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Expense")
    const tagName = `mobile-fab-${Date.now()}`
    const tagResponse = await request.post("/api/tags", {
      headers: { "X-CSRF-Token": token },
      data: { name: tagName, is_hidden_from_budget: false },
    })
    expect(tagResponse.ok()).toBeTruthy()

    await page.getByRole("button", { name: "Add transaction", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Add transaction" })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel("When")).toBeVisible()

    const title = `E2E Quick Add ${Date.now()}`
    await dialog.getByLabel("Amount").fill("12.34")
    await dialog.getByLabel("Category").selectOption(String(categoryId))
    await dialog.getByLabel("Title").fill(title)
    await dialog.getByPlaceholder("Optional description").fill("Mobile description")
    await dialog.getByRole("button", { name: `Add tag ${tagName}` }).click()
    await expect(
      dialog.getByRole("button", { name: `Remove tag ${tagName}` })
    ).toBeVisible()
    await dialog.getByRole("button", { name: "Add transaction" }).click()

    await expect(dialog).toBeHidden()
    await page.goto(`/transactions?q=${encodeURIComponent(title)}`)
    await expect(page.locator("body")).toContainText(title)
  })

  test("uses one balance hero and four semantic metric lanes", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    await createOverallMonthlyBudget(request, token, 310_000)
    await page.goto("/")

    await expect(page.getByRole("button", { name: "This month" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
    await expect(page.getByTestId("dashboard-balance-card")).toBeVisible()
    await expect(page.getByTestId("dashboard-secondary-kpi-card")).toHaveCount(2)
    await expect(page.locator("[data-metric-tone]")).toHaveCount(4)
    await expect(page.getByTestId("dashboard-balance-budget-pace")).toBeVisible()
    await expect(page.getByRole("group", { name: "Transaction type" })).toHaveCount(0)
    await expect(
      page.getByTestId("dashboard-balance-card").locator("canvas"),
    ).not.toBeVisible()
    await expect(
      page.getByTestId("dashboard-spending-bands").getByText(/Six months/),
    ).toHaveCount(0)
    await expect(
      page.getByTestId("dashboard-spending-bands").getByRole("link", {
        name: "Open ledger",
      }),
    ).toHaveCount(0)

    const lanes = page.locator("[data-metric-tone]")
    const boxes = await Promise.all(
      [0, 1, 2, 3].map((index) => lanes.nth(index).boundingBox()),
    )
    expect(boxes.every(Boolean)).toBeTruthy()
    expect(Math.abs((boxes[0]?.y ?? 0) - (boxes[1]?.y ?? 0))).toBeLessThan(2)
    expect((boxes[2]?.y ?? 0)).toBeGreaterThan((boxes[0]?.y ?? 0) + 40)
    expect(Math.abs((boxes[0]?.x ?? 0) - (boxes[2]?.x ?? 0))).toBeLessThan(2)
    const periodButton = page.getByRole("button", { name: "This month" })
    const periodButtonBox = await periodButton.boundingBox()
    expect(periodButtonBox?.height).toBeGreaterThanOrEqual(44)
  })

  test("uses a complete second row for net movement when no budgets exist", async ({
    page,
  }) => {
    const isolated = await loginAsIsolatedUser(page)
    await isolated.request.dispose()
    await page.goto("/")

    await expect(page.getByTestId("dashboard-planning-card")).toHaveCount(0)
    const grid = await page.getByTestId("dashboard-metric-grid").boundingBox()
    const cashIn = await page
      .getByTestId("dashboard-secondary-kpi-card")
      .filter({ hasText: "Cash in" })
      .boundingBox()
    const spent = await page
      .getByTestId("dashboard-secondary-kpi-card")
      .filter({ hasText: "Spent" })
      .boundingBox()
    const netMovement = await page
      .getByTestId("dashboard-net-movement-card")
      .boundingBox()

    expect(grid).not.toBeNull()
    expect(cashIn).not.toBeNull()
    expect(spent).not.toBeNull()
    expect(netMovement).not.toBeNull()
    expect(Math.abs((cashIn?.y ?? 0) - (spent?.y ?? 0))).toBeLessThan(2)
    expect((netMovement?.y ?? 0)).toBeGreaterThan((cashIn?.y ?? 0) + 40)
    expect(Math.abs((netMovement?.width ?? 0) - (grid?.width ?? 0))).toBeLessThan(2)
    const viewport = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth)
  })

  test("keeps category budget health as the fourth metric lane", async ({ page }) => {
    const isolated = await loginAsIsolatedUser(page)
    const monthStart = `${localToday().slice(0, 7)}-01`
    const today = localToday()
    // One overspent budget is at risk on any day of the month; the two
    // untouched budgets always stay on track.
    const plans = [
      { name: "Food", budgetCents: 80_000, spentCents: 84_000 },
      { name: "Transport", budgetCents: 50_000, spentCents: 0 },
      { name: "Utilities", budgetCents: 50_000, spentCents: 0 },
    ]
    for (const [index, plan] of plans.entries()) {
      const categoryResponse = await isolated.request.post("/api/categories", {
        headers: { "X-CSRF-Token": isolated.csrfToken },
        data: { name: plan.name, type: "expense", order: index },
      })
      expect(categoryResponse.ok()).toBeTruthy()
      const category = (await categoryResponse.json()) as { id: number }
      const budgetResponse = await isolated.request.post("/api/budgets/templates", {
        headers: { "X-CSRF-Token": isolated.csrfToken },
        data: {
          frequency: "monthly",
          category_id: category.id,
          amount_cents: plan.budgetCents,
          starts_on: monthStart,
          ends_on: null,
        },
      })
      expect(budgetResponse.ok()).toBeTruthy()
      if (plan.spentCents > 0) {
        await createTransaction(isolated.request, isolated.csrfToken, {
          date: today,
          occurred_at: `${today}T09:0${index}:00`,
          type: "expense",
          amount_cents: plan.spentCents,
          category_id: category.id,
          title: `${plan.name} spending`,
          tags: [],
        })
      }
    }
    await isolated.request.dispose()
    await page.goto("/")

    const planningCard = page.getByTestId("dashboard-planning-card")
    await expect(page.locator("[data-metric-tone]")).toHaveCount(4)
    await expect(planningCard).toContainText("Category budgets")
    await expect(planningCard).toContainText("1 at risk")
    await expect(planningCard).toContainText("Food")
    await expect(planningCard).toContainText("40 € over")
  })

  test("keeps budget pace and recent amounts readable when headline values are hidden", async ({
    page,
  }) => {
    const isolated = await loginAsIsolatedUser(page)
    const today = localToday()
    const incomeCategoryResponse = await isolated.request.post("/api/categories", {
      headers: { "X-CSRF-Token": isolated.csrfToken },
      data: { name: "Salary", type: "income", order: 0 },
    })
    expect(incomeCategoryResponse.ok()).toBeTruthy()
    const incomeCategory = (await incomeCategoryResponse.json()) as { id: number }
    const expenseCategoryResponse = await isolated.request.post("/api/categories", {
      headers: { "X-CSRF-Token": isolated.csrfToken },
      data: { name: "Food", type: "expense", order: 0 },
    })
    expect(expenseCategoryResponse.ok()).toBeTruthy()
    const expenseCategory = (await expenseCategoryResponse.json()) as { id: number }
    await createTransaction(isolated.request, isolated.csrfToken, {
      date: today,
      occurred_at: `${today}T08:00:00`,
      type: "income",
      amount_cents: 265_650,
      category_id: incomeCategory.id,
      title: "Salary payment",
      tags: [],
    })
    await createTransaction(isolated.request, isolated.csrfToken, {
      date: today,
      occurred_at: `${today}T12:00:00`,
      type: "expense",
      amount_cents: 3_000,
      category_id: expenseCategory.id,
      title: "Lunch",
      tags: [],
    })
    await createOverallMonthlyBudget(isolated.request, isolated.csrfToken, 310_000)
    await isolated.request.dispose()
    await page.goto("/")

    await page.getByRole("button", { name: "Hide values" }).click()

    await expect(
      page.getByTestId("dashboard-balance-card").getByText("2 626,50 €", {
        exact: true,
      }),
    ).toHaveClass(/kpi-hidden/)
    await expect(
      page.getByTestId("dashboard-secondary-kpi-card").filter({ hasText: "Cash in" })
        .getByText("2 656,50 €", { exact: true }),
    ).toHaveClass(/kpi-hidden/)
    await expect(
      page.getByTestId("dashboard-secondary-kpi-card").filter({ hasText: "Spent" })
        .getByText("30,00 €", { exact: true }),
    ).toHaveClass(/kpi-hidden/)
    await expect(page.getByTestId("dashboard-balance-budget-pace")).not.toHaveClass(
      /kpi-hidden/,
    )

    const planPace = page.locator('[data-metric-tone="warning"]')
    await expect(planPace.locator(".kpi-hidden")).toHaveCount(0)
    await expect(
      page.getByRole("link", { name: /Lunch/ }).getByText("−30,00 €", {
        exact: true,
      }),
    ).not.toHaveClass(/kpi-hidden/)
  })

  test("keeps recent transactions above breakdown charts", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Mobile Order")
    const today = localToday()
    await createTransaction(request, token, {
      date: today,
      occurred_at: `${today}T09:00:00`,
      type: "expense",
      amount_cents: 3_000,
      category_id: categoryId,
      title: `E2E Mobile Order ${Date.now()}`,
      tags: [],
    })
    await page.goto("/")

    const recentHeading = page.getByRole("heading", { name: "Recent transactions" })
    const expensesHeading = page.getByRole("heading", { name: "Expenses" }).first()
    const recentBox = await recentHeading.boundingBox()
    const expensesBox = await expensesHeading.boundingBox()

    expect(recentBox).not.toBeNull()
    expect(expensesBox).not.toBeNull()
    expect((recentBox?.y ?? 0) < (expensesBox?.y ?? 0)).toBeTruthy()
  })

  test("keeps the recent list compact and non-scrollable", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Mobile Recent")
    const today = localToday()
    const seed = Date.now()
    for (let index = 0; index < 6; index += 1) {
      await createTransaction(request, token, {
        date: today,
        occurred_at: `${today}T08:0${index}:00`,
        type: "expense",
        amount_cents: 2_000 + index,
        category_id: categoryId,
        title: `Mobile recent transaction ${seed}-${index + 1}`,
        tags: [],
      })
    }
    await page.goto("/")

    const recentList = page.getByTestId("dashboard-recent-list")
    await expect(recentList.getByRole("link")).toHaveCount(4)
    expect(
      ["auto", "scroll"],
    ).not.toContain(
      await recentList.evaluate((element) => getComputedStyle(element).overflowY),
    )
  })

  test("keeps long recent transaction titles inside the mobile viewport", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Mobile Long Title")
    const today = localToday()
    await createTransaction(request, token, {
      date: today,
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 3_000,
      category_id: categoryId,
      title:
        "This is a very long mobile transaction title with SupercalifragilisticexpialidociousStyleSegmentsThatShouldNeverStretchTheViewport",
      tags: [],
    })
    await page.goto("/")

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))

    expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
  })

  test("keeps large accumulated financial values inside the mobile viewport", async ({
    page,
  }) => {
    const isolated = await loginAsIsolatedUser(page)
    const today = localToday()
    const incomeCategoryResponse = await isolated.request.post("/api/categories", {
      headers: { "X-CSRF-Token": isolated.csrfToken },
      data: { name: "Salary", type: "income", order: 0 },
    })
    expect(incomeCategoryResponse.ok()).toBeTruthy()
    const incomeCategory = (await incomeCategoryResponse.json()) as { id: number }
    const expenseCategoryResponse = await isolated.request.post("/api/categories", {
      headers: { "X-CSRF-Token": isolated.csrfToken },
      data: { name: "Large purchase", type: "expense", order: 0 },
    })
    expect(expenseCategoryResponse.ok()).toBeTruthy()
    const expenseCategory = (await expenseCategoryResponse.json()) as { id: number }
    await createTransaction(isolated.request, isolated.csrfToken, {
      date: today,
      occurred_at: `${today}T08:00:00`,
      type: "income",
      amount_cents: 610_000,
      category_id: incomeCategory.id,
      title: "Salary payment",
      tags: [],
    })
    await createTransaction(isolated.request, isolated.csrfToken, {
      date: today,
      occurred_at: `${today}T09:00:00`,
      type: "expense",
      amount_cents: 1_000_793_493,
      category_id: expenseCategory.id,
      title: "Accumulated large purchase",
      tags: [],
    })
    // A small overall budget makes the projected pace figures extreme too.
    await createOverallMonthlyBudget(isolated.request, isolated.csrfToken, 200_000)
    await isolated.request.dispose()
    await page.goto("/")

    await expect(
      page
        .getByTestId("dashboard-secondary-kpi-card")
        .filter({ hasText: "Spent" })
        .getByText("10 007 934,93 €", { exact: true }),
    ).toBeVisible()
    const viewport = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth)
  })
})
