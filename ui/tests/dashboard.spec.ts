import { expect, request as playwrightRequest, test } from "./fixtures"
import {
  createTransaction,
  ensureCategory,
  getCsrfToken,
  mockDashboardApi,
} from "./helpers"
import { loginWith } from "./auth-helpers"

test.describe.configure({ mode: "parallel" })

const dashboardKpiLayoutPayload = {
  period: { slug: "this_month", start: "2026-03-01", end: "2026-03-05" },
  filters: { type: null },
  kpis: { income: 2_656_470, expenses: 5_489_509, balance: -2_833_039 },
  sparklines: {
    income: "12,11,10,8,9,10,12,11,10,12",
    expenses: "5,4,5,6,5,8,4,3,7,6,3",
    balance: "9,9,8,7,6,6,5,5,4,4",
  },
  deltas: null,
  donut: {
    has_any_transactions: false,
  },
  recent: [],
  categories: [],
  budget_pace: {
    velocity_ratio: 2.43,
    projected_cents: 607600,
    budget_cents: 250000,
    sparkline: "0.8,0.8,2.6,1.8,1.6,1.5,1.45",
  },
}

test.describe("Dashboard Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
  })

  test("should display KPI cards", async ({ page }) => {
    await page.waitForLoadState("networkidle")
    await expect(page.getByRole("main").locator("text=€").nth(1)).toBeVisible()
  })

  test("defaults the dashboard to this month with a balance hero", async ({ page }) => {
    await mockDashboardApi(page, dashboardKpiLayoutPayload)
    await page.goto("/")

    await expect(page.getByRole("button", { name: "This month" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
    await expect(page.getByTestId("dashboard-balance-card")).toBeVisible()
    await expect(page.getByTestId("dashboard-secondary-kpi-card")).toHaveCount(2)
    await expect(page.getByTestId("dashboard-balance-delta")).toHaveCount(0)
  })

  test("keeps recent activity and donut legends out of nested scroll regions", async ({
    page,
  }) => {
    const categories = Array.from({ length: 8 }, (_, index) => ({
      id: index + 1,
      name: `Category ${index + 1}`,
      type: "expense",
      icon: null,
    }))
    await mockDashboardApi(page, {
      ...dashboardKpiLayoutPayload,
      donut: {
        has_any_transactions: true,
        mode: "both",
        expense_breakdown: categories.map((category, index) => ({
          name: category.name,
          amount_cents: (index + 1) * 1_000,
          percent: 100 / categories.length,
        })),
        income_breakdown: [
          { name: "Salary", amount_cents: 430_000, percent: 100 },
        ],
      },
      recent: categories.map((category, index) => ({
        id: index + 1,
        date: "2026-03-05",
        occurred_at: `2026-03-05T12:0${index}:00Z`,
        type: "expense",
        amount_cents: (index + 1) * 1_000,
        net_amount_cents: (index + 1) * 1_000,
        reimbursed_total_cents: 0,
        is_reimbursement: false,
        category,
        title: `Recent transaction ${index + 1}`,
        tags: [],
      })),
      categories,
    })
    await page.goto("/")

    const recentList = page.getByTestId("dashboard-recent-list")
    const visibleRecentRows = recentList.getByRole("link")
    await expect.poll(() => visibleRecentRows.count()).toBeGreaterThan(4)
    const visibleRecentCount = await visibleRecentRows.count()
    expect(visibleRecentCount).toBeLessThan(categories.length)
    const listBox = await recentList.boundingBox()
    const rowBoxes = await visibleRecentRows.evaluateAll((rows) =>
      rows.map((row) => row.getBoundingClientRect().bottom),
    )
    expect(listBox).not.toBeNull()
    expect(
      rowBoxes.every((rowBottom) => rowBottom <= (listBox?.y ?? 0) + (listBox?.height ?? 0) + 1),
    ).toBeTruthy()
    expect(
      ["auto", "scroll"],
    ).not.toContain(
      await recentList.evaluate((element) => getComputedStyle(element).overflowY),
    )

    const legend = page.getByTestId("donut-legend").first()
    await expect(legend.getByRole("button")).toHaveCount(categories.length)
    expect(
      await legend.evaluate((element) => getComputedStyle(element).overflowY),
    ).toBe("visible")
    const firstLegendItem = await legend.getByRole("button").first().boundingBox()
    expect(firstLegendItem?.height).toBeGreaterThanOrEqual(44)
    const secondLegendItem = await legend.getByRole("button").nth(1).boundingBox()
    const thirdLegendItem = await legend.getByRole("button").nth(2).boundingBox()
    expect(Math.abs((firstLegendItem?.width ?? 0) - (secondLegendItem?.width ?? 0))).toBeLessThan(1)
    expect((secondLegendItem?.x ?? 0) > (firstLegendItem?.x ?? 0)).toBeTruthy()
    expect(Math.abs((firstLegendItem?.x ?? 0) - (thirdLegendItem?.x ?? 0))).toBeLessThan(1)

    const firstAmount = await legend.getByRole("button").nth(0).locator("span").last().boundingBox()
    const thirdAmount = await legend.getByRole("button").nth(2).locator("span").last().boundingBox()
    expect(
      Math.abs(
        (firstAmount?.x ?? 0) + (firstAmount?.width ?? 0) -
          ((thirdAmount?.x ?? 0) + (thirdAmount?.width ?? 0)),
      ),
    ).toBeLessThan(1)
  })

  test("reveals exact balance evidence when hovering the history chart", async ({ page }) => {
    await mockDashboardApi(page, dashboardKpiLayoutPayload)
    await page.goto("/")
    const chart = page.getByTestId("dashboard-balance-history").locator("canvas")
    await expect(chart).toBeVisible()
    const restingChart = await chart.evaluate((canvas) => canvas.toDataURL())
    await chart.hover({ position: { x: 180, y: 70 } })
    await expect
      .poll(() => chart.evaluate((canvas) => canvas.toDataURL()))
      .not.toBe(restingChart)
  })

  test("renders four metric lanes and accessible six-month actual and likely evidence", async ({
    page,
  }) => {
    const months = [
      ["2026-02", 1_000_000, 120_000],
      ["2026-03", 1_080_000, 150_000],
      ["2026-04", 1_040_000, 130_000],
      ["2026-05", 1_160_000, 180_000],
      ["2026-06", 1_220_000, 160_000],
      ["2026-07", 1_300_000, 200_000],
    ].map(([month, balance, spending], index) => ({
      month,
      balance_cents: balance,
      total_cents: spending,
      segments: [
        {
          category_id: 11,
          name: "Housing",
          icon: "house",
          amount_cents: index === 5 ? Number(spending) - 25_000 : spending,
        },
        ...(index === 5
          ? [{
              category_id: 12,
              name: "Restaurants",
              icon: "fork-knife",
              amount_cents: 25_000,
            }]
          : []),
      ],
    }))
    await page.route("**/api/category-breakdown?*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ months }),
      }),
    )
    await page.route("**/api/forecast?*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          start_balance_cents: 1_300_000,
          months: [
            {
              month: "2026-08",
              end_balance_cents: 1_360_000,
              end_balance_p10_cents: 1_330_000,
              end_balance_p90_cents: 1_390_000,
            },
            {
              month: "2026-09",
              end_balance_cents: 1_420_000,
              end_balance_p10_cents: 1_365_000,
              end_balance_p90_cents: 1_475_000,
            },
          ],
        }),
      }),
    )
    await mockDashboardApi(page, {
      ...dashboardKpiLayoutPayload,
      period: { slug: "this_month", start: "2026-07-01", end: "2026-07-31" },
      kpis: { income: 450_000, expenses: 200_000, balance: 1_300_000 },
    })

    await page.goto("/")

    await expect(page.locator("[data-metric-tone]")).toHaveCount(4)
    await expect(page.getByTestId("dashboard-spending-band-month")).toHaveCount(6)
    await expect(page.getByTestId("dashboard-spending-band-month").first()).toHaveAttribute(
      "href",
      /start=2026-02-01.*end=2026-02-28.*type=expense/,
    )
    await page.locator(".spending-band-segment").first().hover()
    const tooltip = page.getByTestId("spending-band-tooltip")
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toContainText("€")
    await expect(
      page.getByRole("img", {
        name: /Actual balance moved from.*Feb.*today.*Sept? likely balance.*80 percent range/,
      }),
    ).toBeVisible()
    await expect(
      page.getByRole("table", { name: "Expense totals by month and category" }),
    ).toHaveCount(1)
  })

  test("replaces overall budget pace with category budget health", async ({ page }) => {
    await mockDashboardApi(page, {
      ...dashboardKpiLayoutPayload,
      budget_pace: undefined,
      category_budget_summary: {
        total: 4,
        needs_attention: 2,
        priority: {
          scope_category_id: 1,
          scope_label: "Groceries",
          amount_cents: 40_000,
          spent_cents: 42_000,
          remaining_cents: -2_000,
          velocity_ratio: 1.4,
        },
      },
    })
    await page.goto("/")

    const planningCard = page.getByTestId("dashboard-planning-card")
    await expect(planningCard).toContainText("Category budgets")
    await expect(planningCard).toContainText("2 at risk")
    await expect(planningCard).toContainText("Groceries")
    await expect(planningCard).toContainText("20 € over")
    await expect(page.getByText("Set an overall budget")).toHaveCount(0)
  })

  test("keeps one concrete category visible when all category budgets are on track", async ({
    page,
  }) => {
    await mockDashboardApi(page, {
      ...dashboardKpiLayoutPayload,
      budget_pace: undefined,
      category_budget_summary: {
        total: 3,
        needs_attention: 0,
        priority: {
          scope_category_id: 1,
          scope_label: "Groceries",
          amount_cents: 40_000,
          spent_cents: 20_000,
          remaining_cents: 20_000,
          velocity_ratio: 0.91,
        },
      },
    })
    await page.goto("/")

    const planningCard = page.getByTestId("dashboard-planning-card")
    await expect(planningCard).toContainText("3 on track")
    await expect(planningCard).toContainText("Groceries")
    await expect(planningCard).toContainText("0.91× pace")
  })

  test("uses three equal metric columns when no budgets exist", async ({ page }) => {
    await mockDashboardApi(page, {
      ...dashboardKpiLayoutPayload,
      budget_pace: undefined,
    })
    await page.goto("/")

    await expect(page.getByTestId("dashboard-planning-card")).toHaveCount(0)
    await expect(page.getByText("Set an overall budget")).toHaveCount(0)
    await expect(page.locator("[data-metric-tone]")).toHaveCount(3)
    const gridColumns = await page
      .getByTestId("dashboard-metric-grid")
      .evaluate((element) =>
        getComputedStyle(element).gridTemplateColumns.split(" ").map(Number.parseFloat)
      )
    expect(gridColumns).toHaveLength(3)
    expect(Math.max(...gridColumns.map(Number)) - Math.min(...gridColumns.map(Number))).toBeLessThan(1)
  })

  test("keeps historical balance evidence honest and suppresses current forecast", async ({
    page,
  }) => {
    let forecastRequests = 0
    await page.route("**/api/category-breakdown?*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          months: [
            {
              month: "2026-05",
              balance_cents: 900_000,
              total_cents: 80_000,
              segments: [],
            },
            {
              month: "2026-06",
              balance_cents: 950_000,
              total_cents: 90_000,
              segments: [],
            },
          ],
        }),
      }),
    )
    await page.route("**/api/forecast?*", (route) => {
      forecastRequests += 1
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          start_balance_cents: 1_300_000,
          months: [{ month: "2026-08", end_balance_cents: 1_360_000 }],
        }),
      })
    })
    await mockDashboardApi(page, {
      ...dashboardKpiLayoutPayload,
      period: { slug: "last_month", start: "2026-06-01", end: "2026-06-30" },
      kpis: { income: 200_000, expenses: 150_000, balance: 950_000 },
    })

    await page.goto("/?period=last_month")

    const chart = page.getByTestId("dashboard-balance-history")
    await expect(chart.getByText("Historical period")).toBeVisible()
    await expect(chart.getByText("Likely", { exact: true })).toHaveCount(0)
    await expect(
      chart.getByRole("img", { name: /to 9 500,00 euros in Jun/ }),
    ).toBeVisible()
    expect(forecastRequests).toBe(0)
  })

  test("shows an honest empty state for six months without spending", async ({ page }) => {
    await page.route("**/api/category-breakdown?*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          months: Array.from({ length: 6 }, (_, index) => ({
            month: `2026-0${index + 2}`,
            balance_cents: 100_000,
            total_cents: 0,
            segments: [],
          })),
        }),
      }),
    )
    await mockDashboardApi(page, dashboardKpiLayoutPayload)

    await page.goto("/")

    await expect(
      page.getByText("No spending was recorded in the last six months."),
    ).toBeVisible()
  })

  test("distinguishes pending and unavailable current-period evidence", async ({
    page,
  }) => {
    await page.route("**/api/category-breakdown?*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800))
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ months: [] }),
      })
    })
    await page.route("**/api/forecast?*", (route) =>
      route.fulfill({ status: 503, body: "Unavailable" }),
    )
    await mockDashboardApi(page, {
      ...dashboardKpiLayoutPayload,
      period: { slug: "this_month", start: "2026-07-01", end: "2026-07-31" },
    })

    await page.goto("/")

    await expect(page.getByText("Loading six-month spending history…")).toBeVisible()
    await expect(page.getByText("Forecast unavailable")).toBeVisible()
    await expect(page.getByText("Historical period")).toHaveCount(0)
    await expect(
      page.getByText("No spending was recorded in the last six months."),
    ).toBeVisible()
  })

  test("should have period navigation", async ({ page }) => {
    const periodText = page.locator("text=/This month|Last month|Custom/i")
    await expect(periodText.first()).toBeVisible()
  })

  test("should load without errors", async ({ page }) => {
    await expect(page.locator("text=Unable to load")).not.toBeVisible()
    await expect(page.getByTestId("app-loading-fallback")).toHaveCount(0, { timeout: 10000 })
  })

  test("should dismiss add transaction dialog on outside click (desktop)", async ({
    page,
  }) => {
    await page.goto("/")
    await page.getByRole("button", { name: "Add transaction", exact: true }).first().click()
    const dialog = page.getByRole("dialog", { name: "Add transaction" })
    await expect(dialog).toBeVisible()
    await page.mouse.click(10, 10)
    await expect(dialog).toBeHidden()
  })

  test("should apply quick-add template in add sheet", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Template")
    const response = await request.post("/api/templates", {
      headers: { "X-CSRF-Token": token },
      data: {
        name: `Coffee Template ${Date.now()}`,
        type: "expense",
        category_id: categoryId,
        default_amount_cents: 425,
        title: "Template title",
        tags: ["template"],
      },
    })
    expect(response.ok()).toBeTruthy()

    await page.goto("/")
    await page.getByRole("button", { name: "Add transaction", exact: true }).first().click()
    const dialog = page.getByRole("dialog", { name: "Add transaction" })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText("Manage")).toBeVisible()

    const templateButton = dialog
      .locator("button")
      .filter({ hasText: /Coffee Template/ })
      .first()
    await templateButton.click()

    await expect(dialog.getByLabel("Amount")).toHaveValue("4.25")
    await expect(dialog.getByLabel("Title")).toHaveValue("Template title")
    await expect(
      dialog.getByRole("button", { name: "Remove tag template" })
    ).toBeVisible()
  })

  test("filters the add-sheet tag picker by search", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const marker = Date.now()
    const alphaTag = `alpha-${marker}`
    const betaTag = `beta-${marker}`
    for (const name of [alphaTag, betaTag]) {
      const tagResponse = await request.post("/api/tags", {
        headers: { "X-CSRF-Token": token },
        data: { name, is_hidden_from_budget: false },
      })
      expect(tagResponse.ok()).toBeTruthy()
    }

    await page.goto("/")
    await page.getByRole("button", { name: "Add transaction", exact: true }).first().click()
    const dialog = page.getByRole("dialog", { name: "Add transaction" })
    await expect(dialog).toBeVisible()

    await expect(dialog.getByRole("button", { name: `Add tag ${alphaTag}` })).toBeVisible()
    await expect(dialog.getByRole("button", { name: `Add tag ${betaTag}` })).toBeVisible()

    await dialog.getByPlaceholder("Search tags").fill(alphaTag)
    await expect(dialog.getByRole("button", { name: `Add tag ${alphaTag}` })).toBeVisible()
    await expect(dialog.getByRole("button", { name: `Add tag ${betaTag}` })).toHaveCount(0)
  })

  test("refreshes current forecast evidence after adding a transaction", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(
      request,
      token,
      "expense",
      `E2E Forecast Refresh ${Date.now()}`,
    )
    let forecastRequests = 0
    await page.route("**/api/forecast?*", async (route) => {
      forecastRequests += 1
      await route.continue()
    })

    await page.goto("/")
    await expect.poll(() => forecastRequests).toBeGreaterThanOrEqual(1)

    await page.getByRole("button", { name: "Add transaction", exact: true }).first().click()
    const dialog = page.getByRole("dialog", { name: "Add transaction" })
    await dialog.getByLabel("Amount").fill("12.34")
    await dialog.getByLabel("Category").selectOption(String(categoryId))
    await dialog.getByLabel("Title").fill("Forecast refresh evidence")
    await dialog.getByRole("button", { name: "Add transaction" }).click()

    await expect(dialog).toBeHidden()
    await expect.poll(() => forecastRequests).toBeGreaterThanOrEqual(2)
  })

  test("hides archived categories in add sheet category options", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const archivedName = `E2E Archived Add ${Date.now()}`
    const activeName = `E2E Active Add ${Date.now()}`
    const activeResponse = await request.post("/api/categories", {
      headers: { "X-CSRF-Token": token },
      data: {
        name: activeName,
        type: "expense",
        order: 0,
      },
    })
    expect(activeResponse.ok()).toBeTruthy()

    const archivedResponse = await request.post("/api/categories", {
      headers: { "X-CSRF-Token": token },
      data: {
        name: archivedName,
        type: "expense",
        order: 1,
      },
    })
    expect(archivedResponse.ok()).toBeTruthy()
    const archivedCategory = (await archivedResponse.json()) as { id: number }
    const archiveResponse = await request.post(
      `/api/categories/${archivedCategory.id}/archive`,
      {
        headers: { "X-CSRF-Token": token },
      }
    )
    expect(archiveResponse.ok()).toBeTruthy()

    await page.goto("/")
    const categoriesResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/categories?period=all") &&
        response.request().method() === "GET" &&
        response.ok()
    )
    await page.getByRole("button", { name: "Add transaction", exact: true }).first().click()
    await categoriesResponse
    const dialog = page.getByRole("dialog", { name: "Add transaction" })
    await expect(dialog).toBeVisible()

    const categoryOptions = await dialog
      .getByLabel("Category")
      .locator("option")
      .allTextContents()
    expect(categoryOptions).toContain(activeName)
    expect(categoryOptions).not.toContain(archivedName)
  })

  test("preserves add-sheet field behavior, validation, and templates handoff", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Add Sheet")
    const response = await request.post("/api/templates", {
      headers: { "X-CSRF-Token": token },
      data: {
        name: `Handoff Template ${Date.now()}`,
        type: "expense",
        category_id: categoryId,
        default_amount_cents: null,
        title: "Handoff title",
        tags: [],
      },
    })
    expect(response.ok()).toBeTruthy()

    await page.goto("/")
    await page.getByRole("button", { name: "Add transaction", exact: true }).first().click()
    const dialog = page.getByRole("dialog", { name: "Add transaction" })
    await expect(dialog).toBeVisible()

    await expect(dialog.getByLabel("When")).toBeVisible()
    await expect(dialog.getByLabel("Amount")).toBeVisible()
    await expect(dialog.getByLabel("Category")).toBeVisible()
    await expect(dialog.getByLabel("Title")).toBeVisible()
    await expect(dialog.getByText("Tags", { exact: true })).toBeVisible()
    await expect(dialog.getByText("Templates", { exact: true })).toBeVisible()
    await expect(dialog.getByText("This is a reimbursement")).toHaveCount(0)

    await dialog.getByText("Income", { exact: true }).click()
    await expect(dialog.getByText("This is a reimbursement")).toBeVisible()
    await dialog.getByText("Expense", { exact: true }).click()
    await expect(dialog.getByText("This is a reimbursement")).toHaveCount(0)

    await dialog.getByLabel("Amount").fill("12.34")
    await dialog.getByLabel("Title").fill("   ")
    await dialog.locator("form").evaluate((form) => {
      if (form instanceof HTMLFormElement) {
        form.requestSubmit()
      }
    })
    await expect(dialog.getByText("Title is required")).toBeVisible()

    await dialog.getByRole("button", { name: "Manage", exact: true }).click()
    await expect(page).toHaveURL("/templates")
    await expect(page.getByRole("dialog", { name: "Add transaction" })).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("")
  })

  test("should show durable purchases section when data exists", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Durable")
    const title = `E2E Durable ${Date.now()}`
    const txnId = await createTransaction(request, token, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 120_000,
      category_id: categoryId,
      title,
      tags: [],
    })

    const durableResponse = await request.post(`/api/transactions/${txnId}/durable`, {
      headers: { "X-CSRF-Token": token },
      data: {
        expected_lifespan_days: 730,
        acquired_on: new Date().toISOString().slice(0, 10),
      },
    })
    expect(durableResponse.ok()).toBeTruthy()

    await page.goto("/")
    await expect(page.getByText("Durable purchases")).toBeVisible()
    await expect(page.locator("body")).toContainText(title)
  })

  test("should show budget pace inside the balance card when overall budget exists", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const today = new Date().toISOString().slice(0, 10)
    const response = await request.post("/api/budgets/templates", {
      headers: { "X-CSRF-Token": token },
      data: {
        frequency: "monthly",
        category_id: null,
        amount_cents: 200_000,
        starts_on: `${today.slice(0, 7)}-01`,
        ends_on: null,
      },
    })
    expect(response.ok()).toBeTruthy()

    await page.goto("/")
    const balanceCard = page.getByTestId("dashboard-balance-card")
    await expect(balanceCard.getByText("Budget pace", { exact: true })).toBeVisible()
    await expect(page.getByTestId("dashboard-balance-budget-pace")).toBeVisible()
  })

  test("should show category budget health when only category budgets exist", async ({
    page,
  }) => {
    const credentials = {
      username: `dashboard-budget-${Date.now()}`,
      password: "hunter22",
    }
    const accountRequest = await playwrightRequest.newContext({
      baseURL: new URL(page.url()).origin,
      storageState: { cookies: [], origins: [] },
    })
    const signupResponse = await accountRequest.post("/api/auth/signup", {
      data: credentials,
    })
    expect(
      signupResponse.ok(),
      `${signupResponse.status()}: ${await signupResponse.text()}`
    ).toBeTruthy()
    const loginResponse = await accountRequest.post("/api/auth/login", {
      data: credentials,
    })
    expect(loginResponse.ok()).toBeTruthy()
    await page.context().clearCookies()
    await loginWith(page, credentials)

    const token = await getCsrfToken(accountRequest)
    const categoryId = await ensureCategory(
      accountRequest,
      token,
      "expense",
      `E2E Category Plan ${Date.now()}`
    )
    const today = new Date().toISOString().slice(0, 10)
    const budgetResponse = await accountRequest.post("/api/budgets/templates", {
      headers: { "X-CSRF-Token": token },
      data: {
        frequency: "monthly",
        category_id: categoryId,
        amount_cents: 10_000,
        starts_on: `${today.slice(0, 7)}-01`,
        ends_on: null,
      },
    })
    expect(budgetResponse.ok()).toBeTruthy()
    await createTransaction(accountRequest, token, {
      date: today,
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 12_000,
      category_id: categoryId,
      title: `E2E Category Plan Spend ${Date.now()}`,
      tags: [],
    })
    await accountRequest.dispose()

    await page.goto("/")

    const planningCard = page.getByTestId("dashboard-planning-card")
    await expect(planningCard).toContainText("Category budgets")
    await expect(planningCard).toContainText("1 at risk")
    await expect(planningCard).toContainText("20 € over")
    await expect(page.getByRole("link", { name: "Open category budgets" })).toHaveAttribute(
      "href",
      "/budgets"
    )
  })

  test("keeps dashboard-origin detail/edit history coherent and preserves dashboard context", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", `E2E Dashboard Return ${Date.now()}`)
    const title = `E2E Dashboard Return Txn ${Date.now()}`
    const transactionId = await createTransaction(request, token, {
      date: "2026-03-15",
      occurred_at: "2026-03-15T11:45:00",
      type: "expense",
      amount_cents: 4321,
      category_id: categoryId,
      title,
      tags: [],
    })

    await page.addInitScript(() => {
      window.localStorage.setItem("ew.theme.preference", "light")
    })
    const dashboardUrl = "/?period=custom&start=2026-03-01&end=2026-03-31&type=expense"
    await page.goto(dashboardUrl)

    const rowLink = page.getByRole("link", { name: new RegExp(title) }).first()
    await expect(rowLink).toBeVisible()
    await rowLink.click()

    await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}$`))
    await expect(
      page.evaluate(() => document.documentElement.dataset.theme)
    ).resolves.toBe("light")

    await page.locator(`a[href="/transactions/${transactionId}/edit"]`).first().click()
    await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}/edit$`))

    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}$`))

    await page.locator(`a[href="/transactions/${transactionId}/edit"]`).first().click()
    await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}/edit$`))

    await page.locator(`a[href="/transactions/${transactionId}"]`).first().click()
    await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}$`))

    await page.getByRole("link", { name: "← Back" }).click()
    await expect(page).toHaveURL(dashboardUrl)
    await expect(
      page.evaluate(() => document.documentElement.dataset.theme)
    ).resolves.toBe("light")
  })

  test("should filter recent transactions by donut category selection", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const seed = Date.now()
    const focusName = `E2E Focus ${seed}`
    const nonFocusName = `E2E Non Focus ${seed}`
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth()
    const pad2 = (value: number) => String(value).padStart(2, "0")
    const dateInCurrentMonth = `${year}-${pad2(month + 1)}-01`
    const toCurrentMonthIso = (minutesAfterMonthStart: number) =>
      `${dateInCurrentMonth}T00:${pad2(minutesAfterMonthStart)}:00`

    const focusCategoryResponse = await request.post("/api/categories", {
      headers: { "X-CSRF-Token": token },
      data: { name: focusName, type: "expense", order: 0 },
    })
    expect(focusCategoryResponse.ok()).toBeTruthy()
    const focusCategory = (await focusCategoryResponse.json()) as { id: number }

    const nonFocusCategoryResponse = await request.post("/api/categories", {
      headers: { "X-CSRF-Token": token },
      data: { name: nonFocusName, type: "expense", order: 1 },
    })
    expect(nonFocusCategoryResponse.ok()).toBeTruthy()
    const nonFocusCategory = (await nonFocusCategoryResponse.json()) as { id: number }

    const focusNote = `E2E Focus Title ${seed}`
    const focusOccurredAt = toCurrentMonthIso(0)
    await createTransaction(request, token, {
      date: dateInCurrentMonth,
      occurred_at: focusOccurredAt,
      type: "expense",
      amount_cents: 1_000_000_000 + (seed % 1_000_000),
      category_id: focusCategory.id,
      title: focusNote,
      tags: [],
    })
    for (let i = 0; i < 11; i += 1) {
      await createTransaction(request, token, {
        date: dateInCurrentMonth,
        occurred_at: toCurrentMonthIso(i + 1),
        type: "expense",
        amount_cents: 10_000 + i,
        category_id: nonFocusCategory.id,
        title: `E2E Non Focus Txn ${seed}-${i}`,
        tags: [],
      })
    }

    await page.goto("/")
    await expect(page.locator("body")).not.toContainText(focusNote)

    const expensesChart = page
      .locator("div.surface-card")
      .filter({ has: page.getByRole("heading", { name: "Expenses" }) })
      .first()
    const focusLegendButton = expensesChart.getByRole("button", {
      name: new RegExp(focusName),
    })
    await expect(focusLegendButton).toBeVisible()
    await focusLegendButton.click()
    await expect(page).toHaveURL(new RegExp(`category=${focusCategory.id}`))
    await expect(page.locator("body")).toContainText(focusNote)

    await focusLegendButton.click()
    await expect(page).not.toHaveURL(/category=/)
  })
})
