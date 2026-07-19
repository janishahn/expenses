import { expect, test } from "./fixtures"
import { ensureCategory, getCsrfToken, mockDashboardApi } from "./helpers"

test.describe.configure({ mode: "parallel" })

const dashboardMobileLayoutPayload = {
  period: { slug: "this_month", start: "2026-03-01", end: "2026-03-05" },
  filters: { type: null },
  kpis: { income: 265_650, expenses: 548_950, balance: -283_300 },
  sparklines: {},
  deltas: { income: 11_100, expenses: -9_900, balance: 1_200 },
  donut: {
    has_any_transactions: true,
    mode: "expense-only" as const,
    expense_breakdown: [
      { name: "Housing", amount_cents: 120_000, percent: 60 },
      { name: "Food", amount_cents: 80_000, percent: 40 },
    ],
  },
  recent: [
    {
      id: 1,
      date: "2026-03-05",
      occurred_at: "2026-03-05T12:00:00Z",
      type: "expense",
      amount_cents: 3_000,
      net_amount_cents: 3_000,
      reimbursed_total_cents: 0,
      is_reimbursement: false,
      category: { id: 1, name: "Food", type: "expense", icon: null },
      title: "Lunch",
      tags: [],
    },
  ],
  categories: [
    { id: 1, name: "Food", type: "expense", icon: null },
    { id: 2, name: "Housing", type: "expense", icon: null },
  ],
  budget_pace: {
    velocity_ratio: 1.74,
    projected_cents: 540_000,
    budget_cents: 310_000,
    sparkline: "0.8,1.0,1.2,1.5,1.7",
  },
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

  test("uses one balance hero and four semantic metric lanes", async ({ page }) => {
    await mockDashboardApi(page, dashboardMobileLayoutPayload)
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
    await mockDashboardApi(page, {
      ...dashboardMobileLayoutPayload,
      budget_pace: undefined,
    })
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
    await mockDashboardApi(page, {
      ...dashboardMobileLayoutPayload,
      budget_pace: undefined,
      category_budget_summary: {
        total: 3,
        needs_attention: 1,
        priority: {
          scope_category_id: 1,
          scope_label: "Food",
          amount_cents: 80_000,
          spent_cents: 84_000,
          remaining_cents: -4_000,
          velocity_ratio: 1.3,
        },
      },
    })
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
    await mockDashboardApi(page, dashboardMobileLayoutPayload)
    await page.goto("/")

    await page.getByRole("button", { name: "Hide values" }).click()

    await expect(
      page.getByTestId("dashboard-balance-card").getByText("-2 833,00 €", {
        exact: true,
      }),
    ).toHaveClass(/kpi-hidden/)
    await expect(
      page.getByTestId("dashboard-secondary-kpi-card").filter({ hasText: "Cash in" })
        .getByText("2 656,50 €", { exact: true }),
    ).toHaveClass(/kpi-hidden/)
    await expect(
      page.getByTestId("dashboard-secondary-kpi-card").filter({ hasText: "Spent" })
        .getByText("5 489,50 €", { exact: true }),
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

  test("keeps recent transactions above breakdown charts", async ({ page }) => {
    await mockDashboardApi(page, dashboardMobileLayoutPayload)
    await page.goto("/")

    const recentHeading = page.getByRole("heading", { name: "Recent transactions" })
    const expensesHeading = page.getByRole("heading", { name: "Expenses" }).first()
    const recentBox = await recentHeading.boundingBox()
    const expensesBox = await expensesHeading.boundingBox()

    expect(recentBox).not.toBeNull()
    expect(expensesBox).not.toBeNull()
    expect((recentBox?.y ?? 0) < (expensesBox?.y ?? 0)).toBeTruthy()
  })

  test("keeps the recent list compact and non-scrollable", async ({ page }) => {
    await mockDashboardApi(page, {
      ...dashboardMobileLayoutPayload,
      recent: Array.from({ length: 6 }, (_, index) => ({
        ...dashboardMobileLayoutPayload.recent[0],
        id: index + 1,
        title: `Mobile recent transaction ${index + 1}`,
      })),
    })
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
  }) => {
    await mockDashboardApi(page, {
      ...dashboardMobileLayoutPayload,
      recent: [
        {
          ...dashboardMobileLayoutPayload.recent[0],
          title:
            "This is a very long mobile transaction title with SupercalifragilisticexpialidociousStyleSegmentsThatShouldNeverStretchTheViewport",
        },
      ],
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
    await mockDashboardApi(page, {
      ...dashboardMobileLayoutPayload,
      kpis: {
        income: 610_000,
        expenses: 1_000_793_493,
        balance: -1_000_183_493,
      },
      deltas: {
        income: 610_000,
        expenses: 1_000_793_493,
        balance: -1_000_183_493,
      },
      budget_pace: {
        velocity_ratio: 9_695.19,
        projected_cents: 1_939_037_400,
        budget_cents: 200_000,
        sparkline: "1200,2400,4800,7200,9695",
      },
    })
    await page.goto("/")

    await expect(page.getByText("10 007 934,93 €", { exact: true })).toBeVisible()
    const viewport = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth)
  })
})
