import { expect, test } from "./fixtures"
import {
  createTransaction,
  ensureCategory,
  getCsrfToken,
  loginAsIsolatedUser,
} from "./helpers"

test.describe.configure({ mode: "parallel" })

// Explicit lookup keyed on the month number of a YYYY-MM key so expected
// labels never depend on the timezone of the process computing them.
// en-GB short month names as rendered by the browser's Intl formatter.
const SHORT_MONTHS: Record<string, string> = {
  "01": "Jan",
  "02": "Feb",
  "03": "Mar",
  "04": "Apr",
  "05": "May",
  "06": "Jun",
  "07": "Jul",
  "08": "Aug",
  "09": "Sept",
  "10": "Oct",
  "11": "Nov",
  "12": "Dec",
}

function monthKey(offsetMonths: number): string {
  const now = new Date()
  const target = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1)
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}`
}

function monthEndDate(key: string): string {
  const [year, month] = key.split("-").map(Number)
  return `${key}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`
}

function localToday(): string {
  const now = new Date()
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-")
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
    const isolated = await loginAsIsolatedUser(page)
    const today = localToday()
    const categoryCount = 8
    for (let index = 0; index < categoryCount; index += 1) {
      const categoryResponse = await isolated.request.post("/api/categories", {
        headers: { "X-CSRF-Token": isolated.csrfToken },
        data: { name: `Legend Category ${index + 1}`, type: "expense", order: index },
      })
      expect(categoryResponse.ok()).toBeTruthy()
      const category = (await categoryResponse.json()) as { id: number }
      await createTransaction(isolated.request, isolated.csrfToken, {
        date: today,
        occurred_at: `${today}T08:0${index}:00`,
        type: "expense",
        amount_cents: (index + 1) * 1_000,
        category_id: category.id,
        title: `Recent transaction ${index + 1}`,
        tags: [],
      })
    }
    await isolated.request.dispose()
    await page.goto("/")

    const recentList = page.getByTestId("dashboard-recent-list")
    const visibleRecentRows = recentList.getByRole("link")
    await expect.poll(() => visibleRecentRows.count()).toBeGreaterThan(4)
    const visibleRecentCount = await visibleRecentRows.count()
    expect(visibleRecentCount).toBeLessThan(categoryCount)
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
    await expect(legend.getByRole("button")).toHaveCount(categoryCount)
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

  test("reveals exact balance evidence when hovering the history chart", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Balance Hover")
    for (const offset of [-2, -1, 0]) {
      const key = monthKey(offset)
      await createTransaction(request, token, {
        date: `${key}-01`,
        occurred_at: `${key}-01T09:00:00`,
        type: "expense",
        amount_cents: 25_000,
        category_id: categoryId,
        title: `E2E Balance Hover ${Date.now()} ${offset}`,
        tags: [],
      })
    }

    await page.goto("/")
    const chart = page.getByTestId("dashboard-balance-history").locator("canvas")
    await expect(chart).toBeVisible()
    await page.waitForLoadState("networkidle")
    const restingChart = await chart.evaluate((canvas) => canvas.toDataURL())
    await chart.hover({ position: { x: 180, y: 70 } })
    await expect
      .poll(() => chart.evaluate((canvas) => canvas.toDataURL()))
      .not.toBe(restingChart)
  })

  test("renders four metric lanes and accessible six-month actual and likely evidence", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Metric Lanes")
    const seed = Date.now()
    // Six months of real spending: the five completed months double as the
    // forecast history needed for an 80 percent interval (>= 3 history months).
    for (let offset = -5; offset <= 0; offset += 1) {
      const key = monthKey(offset)
      await createTransaction(request, token, {
        date: `${key}-01`,
        occurred_at: `${key}-01T08:00:00`,
        type: "expense",
        amount_cents: 30_000 + (offset + 5) * 5_000,
        category_id: categoryId,
        title: `E2E Metric Lanes ${seed} ${offset}`,
        tags: [],
      })
    }
    const budgetResponse = await request.post("/api/budgets/templates", {
      headers: { "X-CSRF-Token": token },
      data: {
        frequency: "monthly",
        category_id: null,
        amount_cents: 200_000,
        starts_on: `${monthKey(0)}-01`,
        ends_on: null,
      },
    })
    expect(budgetResponse.ok()).toBeTruthy()

    const bandsResponse = await request.get(
      "/api/category-breakdown?view=monthly&period=this_month"
    )
    const bandsPayload = (await bandsResponse.json()) as {
      months: Array<{ month: string }>
    }
    expect(bandsPayload.months).toHaveLength(6)
    const firstMonthKey = bandsPayload.months[0].month
    const forecastResponse = await request.get("/api/forecast?horizon=6&mode=full")
    const forecastPayload = (await forecastResponse.json()) as {
      months: Array<{
        month: string
        end_balance_p10_cents: number | null
        end_balance_p90_cents: number | null
      }>
    }
    const finalForecast = forecastPayload.months[forecastPayload.months.length - 1]
    expect(finalForecast.end_balance_p10_cents).not.toBeNull()
    expect(finalForecast.end_balance_p90_cents).not.toBeNull()

    await page.goto("/")

    await expect(page.locator("[data-metric-tone]")).toHaveCount(4)
    await expect(page.getByTestId("dashboard-spending-band-month")).toHaveCount(6)
    await expect(page.getByTestId("dashboard-spending-band-month").first()).toHaveAttribute(
      "href",
      new RegExp(
        `start=${firstMonthKey}-01.*end=${monthEndDate(firstMonthKey)}.*type=expense`
      ),
    )
    await page.locator(".spending-band-segment").first().hover()
    const tooltip = page.getByTestId("spending-band-tooltip")
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toContainText("€")
    await expect(
      page.getByRole("img", {
        name: new RegExp(
          `Actual balance moved from.*${SHORT_MONTHS[firstMonthKey.slice(5)]}.*today.*${SHORT_MONTHS[finalForecast.month.slice(5)]} likely balance.*80 percent range`
        ),
      }),
    ).toBeVisible()
    await expect(
      page.getByRole("table", { name: "Expense totals by month and category" }),
    ).toHaveCount(1)
  })

  test("replaces overall budget pace with category budget health", async ({ page }) => {
    const isolated = await loginAsIsolatedUser(page)
    const monthStart = `${monthKey(0)}-01`
    const today = localToday()
    // Two overspent budgets are at risk regardless of the day of month; the
    // two untouched budgets always stay on track.
    const plans = [
      { name: "Groceries", budgetCents: 10_000, spentCents: 13_000 },
      { name: "Dining out", budgetCents: 10_000, spentCents: 12_000 },
      { name: "Utilities", budgetCents: 20_000, spentCents: 0 },
      { name: "Hobbies", budgetCents: 20_000, spentCents: 0 },
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
    await expect(planningCard).toContainText("Category budgets")
    await expect(planningCard).toContainText("2 at risk")
    await expect(planningCard).toContainText("Groceries")
    await expect(planningCard).toContainText("30 € over")
    await expect(page.getByText("Set an overall budget")).toHaveCount(0)
  })

  test("keeps one concrete category visible when all category budgets are on track", async ({
    page,
  }) => {
    const isolated = await loginAsIsolatedUser(page)
    const monthStart = `${monthKey(0)}-01`
    const today = localToday()
    const categoryIds: number[] = []
    for (const [index, name] of ["Groceries", "Transport", "Utilities"].entries()) {
      const categoryResponse = await isolated.request.post("/api/categories", {
        headers: { "X-CSRF-Token": isolated.csrfToken },
        data: { name, type: "expense", order: index },
      })
      expect(categoryResponse.ok()).toBeTruthy()
      categoryIds.push(((await categoryResponse.json()) as { id: number }).id)
      const budgetResponse = await isolated.request.post("/api/budgets/templates", {
        headers: { "X-CSRF-Token": isolated.csrfToken },
        data: {
          frequency: "monthly",
          category_id: categoryIds[index],
          amount_cents: 40_000,
          starts_on: monthStart,
          ends_on: null,
        },
      })
      expect(budgetResponse.ok()).toBeTruthy()
    }
    // Small enough to stay under a 1.1 velocity even on the first day of the
    // month, but the only spend, so Groceries is always the priority category.
    await createTransaction(isolated.request, isolated.csrfToken, {
      date: today,
      occurred_at: `${today}T09:00:00`,
      type: "expense",
      amount_cents: 1_000,
      category_id: categoryIds[0],
      title: "Groceries run",
      tags: [],
    })
    const dashboardResponse = await isolated.request.get("/api/dashboard?period=this_month")
    const dashboardPayload = (await dashboardResponse.json()) as {
      category_budget_summary: {
        needs_attention: number
        priority: { scope_label: string; velocity_ratio: number }
      }
    }
    expect(dashboardPayload.category_budget_summary.needs_attention).toBe(0)
    expect(dashboardPayload.category_budget_summary.priority.scope_label).toBe("Groceries")
    const expectedPace = `${dashboardPayload.category_budget_summary.priority.velocity_ratio
      .toFixed(2)
      .replace(/\.00$/, "")}× pace`
    await isolated.request.dispose()
    await page.goto("/")

    const planningCard = page.getByTestId("dashboard-planning-card")
    await expect(planningCard).toContainText("3 on track")
    await expect(planningCard).toContainText("Groceries")
    await expect(planningCard).toContainText(expectedPace)
  })

  test("uses three equal metric columns when no budgets exist", async ({ page }) => {
    const isolated = await loginAsIsolatedUser(page)
    await isolated.request.dispose()
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
    const isolated = await loginAsIsolatedUser(page)
    const lastMonthKey = monthKey(-1)
    const incomeCategoryResponse = await isolated.request.post("/api/categories", {
      headers: { "X-CSRF-Token": isolated.csrfToken },
      data: { name: "Salary", type: "income", order: 0 },
    })
    expect(incomeCategoryResponse.ok()).toBeTruthy()
    const incomeCategory = (await incomeCategoryResponse.json()) as { id: number }
    await createTransaction(isolated.request, isolated.csrfToken, {
      date: `${lastMonthKey}-15`,
      occurred_at: `${lastMonthKey}-15T09:00:00`,
      type: "income",
      amount_cents: 950_000,
      category_id: incomeCategory.id,
      title: "Salary payment",
      tags: [],
    })
    await isolated.request.dispose()

    let forecastRequests = 0
    page.on("request", (interceptedRequest) => {
      if (interceptedRequest.url().includes("/api/forecast")) {
        forecastRequests += 1
      }
    })
    await page.goto("/?period=last_month")

    const chart = page.getByTestId("dashboard-balance-history")
    await expect(chart.getByText("Historical period")).toBeVisible()
    await expect(chart.getByText("Likely", { exact: true })).toHaveCount(0)
    await expect(
      chart.getByRole("img", {
        name: new RegExp(
          `to 9 500,00 euros in ${SHORT_MONTHS[lastMonthKey.slice(5)]}`
        ),
      }),
    ).toBeVisible()
    expect(forecastRequests).toBe(0)
  })

  test("shows an honest empty state for six months without spending", async ({ page }) => {
    const isolated = await loginAsIsolatedUser(page)
    await isolated.request.dispose()

    await page.goto("/")

    await expect(
      page.getByText("No spending was recorded in the last six months."),
    ).toBeVisible()
  })

  test("distinguishes pending and unavailable current-period evidence", async ({
    page,
  }) => {
    const isolated = await loginAsIsolatedUser(page)
    await isolated.request.dispose()

    // Deterministic pending-state injection: hold the real spending-history
    // response until the loading state has been observed, then let it through.
    let releaseSpendingBands = () => {}
    const spendingBandsGate = new Promise<void>((resolve) => {
      releaseSpendingBands = resolve
    })
    await page.route("**/api/category-breakdown?*", async (route) => {
      await spendingBandsGate
      await route.continue()
    })
    // Failure injection: the forecast service itself cannot be made to fail
    // deterministically through the API.
    await page.route("**/api/forecast?*", (route) =>
      route.fulfill({ status: 503, body: "Unavailable" }),
    )

    await page.goto("/")

    await expect(page.getByText("Loading six-month spending history…")).toBeVisible()
    await expect(page.getByText("Forecast unavailable")).toBeVisible()
    await expect(page.getByText("Historical period")).toHaveCount(0)
    releaseSpendingBands()
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
    const isolated = await loginAsIsolatedUser(page)
    const categoryId = await ensureCategory(
      isolated.request,
      isolated.csrfToken,
      "expense",
      `E2E Category Plan ${Date.now()}`
    )
    const today = localToday()
    const budgetResponse = await isolated.request.post("/api/budgets/templates", {
      headers: { "X-CSRF-Token": isolated.csrfToken },
      data: {
        frequency: "monthly",
        category_id: categoryId,
        amount_cents: 10_000,
        starts_on: `${monthKey(0)}-01`,
        ends_on: null,
      },
    })
    expect(budgetResponse.ok()).toBeTruthy()
    await createTransaction(isolated.request, isolated.csrfToken, {
      date: today,
      occurred_at: `${today}T09:00:00`,
      type: "expense",
      amount_cents: 12_000,
      category_id: categoryId,
      title: `E2E Category Plan Spend ${Date.now()}`,
      tags: [],
    })
    await isolated.request.dispose()

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

test.describe("Dashboard month labels in a UTC-negative timezone", () => {
  test.use({ timezoneId: "America/New_York" })

  test("renders spending-band and balance-history month labels matching the backend month keys", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Month Label")
    const seed = Date.now()
    for (const offset of [-2, -1, 0]) {
      const key = monthKey(offset)
      await createTransaction(request, token, {
        date: `${key}-01`,
        occurred_at: `${key}-01T09:00:00`,
        type: "expense",
        amount_cents: 20_000,
        category_id: categoryId,
        title: `E2E Month Label ${seed} ${offset}`,
        tags: [],
      })
    }
    const bandsResponse = await request.get(
      "/api/category-breakdown?view=monthly&period=this_month"
    )
    const bandsPayload = (await bandsResponse.json()) as {
      months: Array<{ month: string }>
    }
    expect(bandsPayload.months).toHaveLength(6)
    const expectedLabels = bandsPayload.months.map(
      (month) => SHORT_MONTHS[month.month.slice(5)]
    )

    await page.goto("/")

    const monthLinks = page.getByTestId("dashboard-spending-band-month")
    await expect(monthLinks).toHaveCount(6)
    for (const [index, expectedLabel] of expectedLabels.entries()) {
      await expect(monthLinks.nth(index).locator("span").first()).toHaveText(
        expectedLabel
      )
    }
    await expect(
      page.getByTestId("dashboard-balance-history").getByRole("img", {
        name: new RegExp(`euros in ${expectedLabels[0]}`),
      }),
    ).toBeVisible()
  })
})
