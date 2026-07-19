import { expect, test } from "./fixtures"
import { mockDashboardApi, mockVisualSupportingApi } from "./helpers"

const visualDashboard = {
  period: { slug: "this_month", start: "2026-07-01", end: "2026-07-31" },
  filters: { type: null },
  kpis: { income: 265_650, expenses: 148_950, balance: 116_700 },
  sparklines: {},
  deltas: { income: 11_100, expenses: -9_900, balance: 21_000 },
  donut: {
    has_any_transactions: true,
    mode: "both" as const,
    expense_breakdown: [
      { name: "Housing", amount_cents: 90_000, percent: 60.42 },
      { name: "Food", amount_cents: 58_950, percent: 39.58 },
    ],
    income_breakdown: [
      { name: "Salary", amount_cents: 265_650, percent: 100 },
    ],
  },
  recent: [
    {
      id: 10_001,
      date: "2026-07-14",
      occurred_at: "2026-07-14T12:00:00Z",
      type: "expense",
      amount_cents: 3_250,
      net_amount_cents: 3_250,
      reimbursed_total_cents: 0,
      is_reimbursement: false,
      category: { id: 1, name: "Food", type: "expense", icon: "fork-knife" },
      title: "Lunch",
      tags: [{ id: 1, name: "Workday" }],
    },
  ],
  categories: [
    { id: 1, name: "Food", type: "expense", icon: "fork-knife" },
    { id: 2, name: "Housing", type: "expense", icon: "house" },
  ],
  category_budget_summary: {
    total: 2,
    needs_attention: 1,
    priority: {
      scope_category_id: 1,
      scope_label: "Food",
      amount_cents: 55_000,
      spent_cents: 58_950,
      remaining_cents: -3_950,
      velocity_ratio: 1.18,
    },
  },
}

test("Dashboard and add transaction dialog retain their mobile visual contract @visual", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" })
  await mockDashboardApi(page, visualDashboard)
  await mockVisualSupportingApi(page)
  await page.goto("/")
  await page.waitForLoadState("networkidle")

  await expect(page).toHaveScreenshot("dashboard-mobile.png", {
    animations: "disabled",
    fullPage: true,
  })

  await page.getByRole("button", { name: "Add transaction", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Add transaction" })
  await expect(dialog).toHaveScreenshot("add-transaction-mobile.png", {
    animations: "disabled",
    mask: [page.locator("input[type='datetime-local']")],
    maskColor: "#d8dbd6",
  })
})
