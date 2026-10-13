import { expect, type APIRequestContext, type Page } from "@playwright/test"
import { createCategory, createTransaction } from "./helpers"

export const FIXED_NOW = new Date("2026-07-16T12:00:00Z")
export const THEMES = ["light", "dark"] as const
export type Theme = (typeof THEMES)[number]

// Browser state shared by every baseline: a fixed clock, time zone and locale,
// reduced motion, and a stored theme so the app never follows the OS.
export const visualContext = { timezoneId: "Europe/Berlin", locale: "en-US" }

export async function prepareVisualPage(page: Page, theme: Theme) {
  await page.clock.setFixedTime(FIXED_NOW)
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" })
  await page.addInitScript((value) => window.localStorage.setItem("ew.theme.preference", value), theme)
}

export async function settle(page: Page) {
  await page.waitForLoadState("networkidle")
  await page.evaluate(() => document.fonts.ready)
  // Signing in leaves the pointer over the page; move it off so no row shows its hover state.
  await page.mouse.move(0, 0)
}

// The category color is the id modulo 8. Burn ids until the next one is 1 mod 8,
// so the seeded categories get the same colors whatever the database held before.
async function alignCategoryIds(request: APIRequestContext, csrfToken: string) {
  for (;;) {
    const id = await createCategory(request, csrfToken, "expense", `Filler ${Date.now()}`)
    await request.post(`/api/categories/${id}/archive`, { headers: { "X-CSRF-Token": csrfToken } })
    if (id % 8 === 0) return
  }
}

type Entry = {
  date: string
  time: string
  category: string
  title: string
  cents: number
  description?: string
  tags?: string[]
}

const CATEGORIES = [
  { name: "Salary", type: "income" },
  { name: "Freelance", type: "income" },
  { name: "Rent", type: "expense" },
  { name: "Groceries", type: "expense" },
  { name: "Dining", type: "expense" },
  { name: "Transport", type: "expense" },
  { name: "Leisure", type: "expense" },
] as const

const INCOME = new Set(["Salary", "Freelance"])

export const PEEK_TITLE = "Dinner at Trattoria"

// July 2026 is the month under test; June gives the ledger a second month.
const LEDGER: Entry[] = [
  { date: "2026-06-01", time: "08:00", category: "Salary", title: "Salary June", cents: 320_000 },
  { date: "2026-06-01", time: "09:00", category: "Rent", title: "Rent June", cents: 105_000 },
  { date: "2026-06-18", time: "17:40", category: "Groceries", title: "Edeka weekly shop", cents: 91_270 },
  { date: "2026-06-27", time: "20:10", category: "Leisure", title: "Concert tickets", cents: 7_800 },
  { date: "2026-07-01", time: "08:00", category: "Salary", title: "Salary July", cents: 320_000 },
  { date: "2026-07-01", time: "09:00", category: "Rent", title: "Rent July", cents: 105_000 },
  { date: "2026-07-03", time: "18:05", category: "Groceries", title: "Rewe", cents: 6_430 },
  { date: "2026-07-04", time: "12:30", category: "Dining", title: "Lunch with Ben", cents: 2_750 },
  { date: "2026-07-06", time: "07:45", category: "Transport", title: "Deutschlandticket", cents: 4_900 },
  { date: "2026-07-08", time: "17:20", category: "Groceries", title: "Edeka weekly shop", cents: 8_215 },
  { date: "2026-07-09", time: "21:00", category: "Leisure", title: "Cinema tickets", cents: 3_600 },
  { date: "2026-07-10", time: "11:15", category: "Freelance", title: "Logo design invoice", cents: 25_000 },
  {
    date: "2026-07-11",
    time: "19:30",
    category: "Dining",
    title: PEEK_TITLE,
    cents: 4_190,
    description: "Birthday dinner for Mara.",
    tags: ["Birthday"],
  },
  { date: "2026-07-13", time: "18:10", category: "Groceries", title: "Rewe", cents: 7_120 },
  { date: "2026-07-14", time: "18:45", category: "Leisure", title: "Climbing gym pass", cents: 6_000 },
  { date: "2026-07-15", time: "16:30", category: "Transport", title: "Bike repair", cents: 3_700 },
  { date: "2026-07-16", time: "08:20", category: "Dining", title: "Bakery", cents: 840 },
  { date: "2026-07-16", time: "10:05", category: "Groceries", title: "Weekend market", cents: 9_500 },
]

const BUDGETS = [
  { category: null, cents: 190_000, frequency: "monthly" },
  { category: "Rent", cents: 105_000, frequency: "monthly" },
  { category: "Groceries", cents: 45_000, frequency: "monthly" },
  { category: "Dining", cents: 15_000, frequency: "monthly" },
  { category: "Transport", cents: 10_000, frequency: "monthly" },
  { category: "Leisure", cents: 12_000, frequency: "monthly" },
  { category: "Leisure", cents: 120_000, frequency: "yearly" },
]

// Seeds the categories and transactions, and returns the id of the transaction to peek at.
export async function seedLedger(request: APIRequestContext, csrfToken: string): Promise<number> {
  await alignCategoryIds(request, csrfToken)
  const ids = new Map<string, number>()
  for (const category of CATEGORIES) {
    ids.set(category.name, await createCategory(request, csrfToken, category.type, category.name))
  }
  let peekId = 0
  for (const entry of LEDGER) {
    const id = await createTransaction(request, csrfToken, {
      date: entry.date,
      occurred_at: `${entry.date}T${entry.time}:00+02:00`,
      type: INCOME.has(entry.category) ? "income" : "expense",
      amount_cents: entry.cents,
      category_id: ids.get(entry.category)!,
      title: entry.title,
      description: entry.description,
      tags: entry.tags ?? [],
    })
    if (entry.title === PEEK_TITLE) peekId = id
  }
  return peekId
}

export async function seedBudgets(request: APIRequestContext, csrfToken: string) {
  const categories = (await (await request.get("/api/categories?period=all")).json()) as {
    categories: Array<{ id: number; name: string }>
  }
  const idByName = new Map(categories.categories.map((category) => [category.name, category.id]))
  for (const budget of BUDGETS) {
    const response = await request.post("/api/budgets/templates", {
      headers: { "X-CSRF-Token": csrfToken },
      data: {
        frequency: budget.frequency,
        category_id: budget.category === null ? null : idByName.get(budget.category),
        amount_cents: budget.cents,
        starts_on: "2026-01-01",
        ends_on: null,
      },
    })
    expect(response.ok()).toBeTruthy()
  }
}

// Dashboard payloads. The server resolves "this month" and month ranges from its own
// clock, so these endpoints are mocked; totals derive from the ledger above.
const JULY = LEDGER.filter((entry) => entry.date.startsWith("2026-07"))
const categoryId = (name: string) => CATEGORIES.findIndex((category) => category.name === name) + 1
const categorySummary = (name: string) => {
  const category = CATEGORIES.find((item) => item.name === name)!
  return { id: categoryId(name), name, type: category.type, icon: null }
}
const sum = (entries: Entry[]) => entries.reduce((total, entry) => total + entry.cents, 0)
const expenses = (entries: Entry[]) => entries.filter((entry) => !INCOME.has(entry.category))
const incomes = (entries: Entry[]) => entries.filter((entry) => INCOME.has(entry.category))
const byCategory = (entries: Entry[]) => {
  const totals = new Map<string, number>()
  for (const entry of entries) totals.set(entry.category, (totals.get(entry.category) ?? 0) + entry.cents)
  return [...totals].sort((a, b) => b[1] - a[1])
}
const breakdown = (entries: Entry[]) =>
  byCategory(entries).map(([name, amount]) => ({
    category_id: categoryId(name),
    name,
    amount_cents: amount,
    percent: (amount / sum(entries)) * 100,
  }))

const JUNE = LEDGER.filter((entry) => entry.date.startsWith("2026-06"))
const MONTHS = [
  { month: "2026-02", spent: 168_400 },
  { month: "2026-03", spent: 172_900 },
  { month: "2026-04", spent: 181_300 },
  { month: "2026-05", spent: 176_200 },
  { month: "2026-06", spent: sum(expenses(JUNE)) },
  { month: "2026-07", spent: sum(expenses(JULY)) },
]
const OPENING_BALANCE = 612_000
const NET = [38_000, 61_500, 52_300, 70_800, sum(incomes(JUNE)) - sum(expenses(JUNE)), sum(incomes(JULY)) - sum(expenses(JULY))]

export async function mockDashboardApi(page: Page) {
  const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) })
  const julyExpenses = expenses(JULY)
  const budgetByCategory = new Map(BUDGETS.filter((budget) => budget.frequency === "monthly").map((budget) => [budget.category, budget.cents]))
  const pulse = byCategory(julyExpenses)
    .filter(([name]) => name !== "Rent")
    .map(([name, spent]) => ({
      scope_category_id: categoryId(name),
      scope_label: name,
      amount_cents: budgetByCategory.get(name)!,
      spent_cents: spent,
      remaining_cents: budgetByCategory.get(name)! - spent,
    }))
  const overallBudget = budgetByCategory.get(null)!
  const spent = sum(julyExpenses)
  const balances = NET.reduce<number[]>((all, net) => [...all, (all.at(-1) ?? OPENING_BALANCE) + net], [])

  await page.route((url) => url.pathname === "/api/dashboard", (route) =>
    route.fulfill(
      json({
        period: { slug: "this_month", start: "2026-07-01", end: "2026-07-31" },
        kpis: { income: sum(incomes(JULY)), expenses: spent, balance: balances.at(-1) },
        deltas: {
          income: sum(incomes(JULY)) - sum(incomes(JUNE)),
          expenses: spent - sum(expenses(JUNE)),
          balance: NET.at(-1)! - NET.at(-2)!,
        },
        donut: {
          has_any_transactions: true,
          expense_breakdown: breakdown(julyExpenses),
          income_breakdown: breakdown(incomes(JULY)),
        },
        recent: [...JULY].reverse().map((entry, index) => ({
          id: 10_000 + index,
          date: entry.date,
          occurred_at: `${entry.date}T${entry.time}:00+02:00`,
          type: INCOME.has(entry.category) ? "income" : "expense",
          amount_cents: entry.cents,
          net_amount_cents: entry.cents,
          reimbursed_total_cents: 0,
          is_reimbursement: false,
          category: categorySummary(entry.category),
          title: entry.title,
          description: entry.description ?? null,
          tags: [],
        })),
        categories: CATEGORIES.map((category) => categorySummary(category.name)),
        tags: [],
        budget_pace: {
          velocity_ratio: spent / overallBudget / (16 / 31),
          projected_cents: Math.round((spent * 31) / 16),
          budget_cents: overallBudget,
          spent_cents: spent,
          remaining_cents: overallBudget - spent,
          daily_remaining_cents: Math.round((overallBudget - spent) / 15),
          days_remaining: 15,
        },
        category_budget_pulse: pulse,
      }),
    ),
  )
  await page.route((url) => url.pathname === "/api/category-breakdown", (route) =>
    route.fulfill(
      json({
        months: MONTHS.map((entry) => {
          const entries = entry.month === "2026-07" ? julyExpenses : entry.month === "2026-06" ? expenses(JUNE) : null
          const segments = entries
            ? byCategory(entries).map(([name, amount]) => ({ category_id: categoryId(name), name, amount_cents: amount }))
            : [
                { category_id: categoryId("Rent"), name: "Rent", amount_cents: 105_000 },
                { category_id: categoryId("Groceries"), name: "Groceries", amount_cents: Math.round((entry.spent - 105_000) * 0.6) },
                { category_id: categoryId("Dining"), name: "Dining", amount_cents: Math.round((entry.spent - 105_000) * 0.2) },
                { category_id: categoryId("Leisure"), name: "Leisure", amount_cents: Math.round((entry.spent - 105_000) * 0.2) },
              ]
          return { month: entry.month, total_cents: segments.reduce((total, segment) => total + segment.amount_cents, 0), segments }
        }),
      }),
    ),
  )
  await page.route((url) => url.pathname === "/api/dashboard/balance-history", (route) =>
    route.fulfill(json({ months: MONTHS.map((entry, index) => ({ month: entry.month, balance_cents: balances[index] })) })),
  )
  await page.route((url) => url.pathname === "/api/forecast", (route) => {
    const last = balances.at(-1)!
    return route.fulfill(
      json({
        start_balance_cents: last,
        months: ["2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01"].map((month, index) => ({
          month,
          end_balance_cents: last + 60_000 * (index + 1),
          end_balance_p10_cents: last + 60_000 * (index + 1) - 15_000 * (index + 1),
          end_balance_p90_cents: last + 60_000 * (index + 1) + 15_000 * (index + 1),
        })),
      }),
    )
  })
  await page.route((url) => url.pathname === "/api/durable-purchases", (route) =>
    route.fulfill(
      json({
        items: [
          {
            id: 1,
            transaction_id: 9_001,
            expected_lifespan_days: 1_825,
            days_owned: 412,
            cost_per_day_cents: 49,
            percent_amortized: 22.6,
            fully_amortized: false,
            title: "Standing desk",
            category: categorySummary("Leisure"),
          },
          {
            id: 2,
            transaction_id: 9_002,
            expected_lifespan_days: 1_095,
            days_owned: 203,
            cost_per_day_cents: 82,
            percent_amortized: 18.5,
            fully_amortized: false,
            title: "Road bike",
            category: categorySummary("Transport"),
          },
        ],
      }),
    ),
  )
}
