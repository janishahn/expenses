import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import {
  createCategory,
  createTransaction,
  loginAsIsolatedUser,
} from "./helpers"

test.describe.configure({ mode: "parallel" })

// Explicit lookup keyed on the month number of a YYYY-MM key so expected
// labels never depend on the timezone of the process computing them.
// en-US short month names as rendered by the dashboard's Intl formatter.
const SHORT_MONTHS: Record<string, string> = {
  "01": "Jan",
  "02": "Feb",
  "03": "Mar",
  "04": "Apr",
  "05": "May",
  "06": "Jun",
  "07": "Jul",
  "08": "Aug",
  "09": "Sep",
  "10": "Oct",
  "11": "Nov",
  "12": "Dec",
}

function monthKey(offsetMonths: number): string {
  const now = new Date()
  const target = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1)
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}`
}

// Today's local date, or the date a number of days before it.
function localToday(daysBack = 0): string {
  const now = new Date()
  now.setDate(now.getDate() - daysBack)
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-")
}

// Amounts group thousands with a narrow space, so tests write them with a dot.
function eur(text: string): RegExp {
  return new RegExp(text.replace("+", "\\+").replace(/\./g, "[\\s.]").replace(/ /g, "\\s"))
}

// The label text of a metric in the strip, with its value and detail beneath.
function metric(page: Page, label: string) {
  return page.getByText(label, { exact: true }).first().locator("..")
}

test.describe("Dashboard Page", () => {
  test("shows balance, cash in, spent and net for the period and follows period changes", async ({
    page,
  }) => {
    await page.goto("/")
    const isolated = await loginAsIsolatedUser(page)
    const lastMonth = monthKey(-1)
    const salary = await createCategory(isolated.request, isolated.csrfToken, "income", "Salary")
    const rent = await createCategory(isolated.request, isolated.csrfToken, "expense", "Rent")
    await createTransaction(isolated.request, isolated.csrfToken, {
      date: `${lastMonth}-10`,
      occurred_at: `${lastMonth}-10T09:00:00`,
      type: "income",
      amount_cents: 200_000,
      category_id: salary,
      title: "Salary payment",
      tags: [],
    })
    await createTransaction(isolated.request, isolated.csrfToken, {
      date: `${lastMonth}-12`,
      occurred_at: `${lastMonth}-12T09:00:00`,
      type: "expense",
      amount_cents: 50_000,
      category_id: rent,
      title: "Rent payment",
      tags: [],
    })
    await createTransaction(isolated.request, isolated.csrfToken, {
      date: `${monthKey(0)}-01`,
      occurred_at: `${monthKey(0)}-01T09:00:00`,
      type: "expense",
      amount_cents: 12_000,
      category_id: rent,
      title: "Groceries",
      tags: [],
    })
    await isolated.request.dispose()

    await page.goto("/?period=last_month")
    await expect(metric(page, "Cash in")).toContainText(eur("2.000,00 €"))
    await expect(metric(page, "Spent")).toContainText("500,00 €")
    await expect(metric(page, "Net")).toContainText(eur("+ 1.500,00 €"))
    await expect(metric(page, "Balance")).toContainText(eur("1.500,00 €"))
    await expect(metric(page, "Balance")).toContainText(
      `as of ${SHORT_MONTHS[lastMonth.slice(5)]} ${lastMonth.slice(0, 4)}`,
    )

    await page.getByRole("button", { name: /^Period:/ }).click()
    await page.getByRole("menuitemcheckbox", { name: "This month" }).click()
    await expect(page).toHaveURL(/period=this_month/)
    await expect(metric(page, "Cash in")).toContainText("0,00 €")
    await expect(metric(page, "Spent")).toContainText("120,00 €")
    await expect(metric(page, "Spent")).toContainText("vs previous")
    await expect(metric(page, "Balance")).toContainText(eur("1.380,00 €"))
    await expect(metric(page, "Balance")).toContainText("as of today")

    const recent = page.getByRole("region", { name: "Recent" })
    await page.getByRole("button", { name: "Hide amounts" }).click()
    await expect(metric(page, "Spent")).toContainText("Hidden amount")
    await expect(recent.getByRole("listitem", { name: "Groceries" })).toContainText("Hidden amount")
    await page.reload()
    await expect(metric(page, "Spent")).toContainText("Hidden amount")
    await page.getByRole("button", { name: "Show amounts" }).click()
    await expect(metric(page, "Spent")).toContainText("120,00 €")
  })

  test("opens the transaction ledger for a spending band segment and returns with the breadcrumb", async ({
    page,
  }) => {
    await page.goto("/")
    const isolated = await loginAsIsolatedUser(page)
    const today = localToday()
    const categoryName = "Groceries"
    const category = await createCategory(isolated.request, isolated.csrfToken, "expense", categoryName)
    await createTransaction(isolated.request, isolated.csrfToken, {
      date: today,
      occurred_at: `${today}T10:00:00`,
      type: "expense",
      amount_cents: 7_500,
      category_id: category,
      title: "Weekly shop",
      tags: [],
    })
    await isolated.request.dispose()

    await page.goto("/?period=this_month")
    const spending = page.getByRole("region", { name: "Spending by category" })
    const segment = spending.locator('[class*="_track_"] > span').first()
    await segment.hover()
    await expect(page.locator('[class*="_chartTip_"]')).toContainText("75,00 €")

    await segment.click()
    await expect(page).toHaveURL(new RegExp(`/transactions\\?.*category=${category}.*from=dashboard`))
    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" })
    await expect(breadcrumb).toContainText("Dashboard")
    await expect(breadcrumb).toContainText(categoryName)
    await expect(page.getByRole("listitem", { name: "Weekly shop" })).toBeVisible()

    await breadcrumb.getByRole("link", { name: "Dashboard" }).click()
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible()
  })
})
