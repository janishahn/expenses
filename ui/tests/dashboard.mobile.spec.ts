import { expect, test } from "@playwright/test"
import { ensureCategory, getCsrfToken, mockDashboardApi } from "./helpers"

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

  test("dismisses add transaction dialog on outside tap", async ({ page }) => {
    await page.getByRole("button", { name: "Add", exact: true }).click()
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

    await page.getByRole("button", { name: "Add", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Add transaction" })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel("When")).toBeVisible()

    const title = `E2E Quick Add ${Date.now()}`
    await dialog.getByLabel("Amount").fill("12.34")
    await dialog.getByLabel("Category").selectOption(String(categoryId))
    await dialog.getByLabel("Title").fill(title)
    await dialog.getByPlaceholder("Optional description").fill("Mobile description")
    await dialog.getByLabel("Tags (comma-separated)").fill("mobile,fab")
    await dialog.getByLabel("Tags (comma-separated)").press("Enter")

    await expect(dialog).toBeHidden()
    await page.goto(`/transactions?q=${encodeURIComponent(title)}`)
    await expect(page.locator("body")).toContainText(title)
  })

  test("uses one balance hero and two secondary KPI cards", async ({ page }) => {
    await mockDashboardApi(page, dashboardMobileLayoutPayload)
    await page.goto("/")

    await expect(page.getByRole("button", { name: "This month" })).toHaveClass(/ptab-active/)
    await expect(page.getByTestId("dashboard-balance-card")).toBeVisible()
    await expect(page.getByTestId("dashboard-secondary-kpi-card")).toHaveCount(2)
    await expect(page.getByTestId("dashboard-balance-budget-pace")).toBeVisible()
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
})
