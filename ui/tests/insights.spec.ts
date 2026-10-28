import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import {
  createCategory,
  createTransaction,
  loginAsIsolatedUser,
  provisionInsightsData,
} from "./helpers"

test.describe.configure({ mode: "parallel" })

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

// "YYYY-MM" as the month label of the tables, e.g. "Sep 2026".
function monthLabel(key: string): string {
  return `${SHORT_MONTHS[Number(key.slice(5)) - 1]} ${key.slice(0, 4)}`
}

// Amounts group thousands with a narrow space, so tests write them with a dot.
function eur(text: string): RegExp {
  return new RegExp(text.replace("+", "\\+").replace(/\./g, "[\\s.]").replace(/ /g, "\\s"))
}

// The label of a strip metric with its value and detail beneath.
function metric(page: Page, label: string) {
  return page.getByText(label, { exact: true }).first().locator("..")
}

async function showAsTable(page: Page, cardName: string) {
  const card = page.getByRole("region", { name: cardName })
  await card.getByRole("button", { name: "Chart options" }).click()
  await page.getByRole("menuitemcheckbox", { name: "Show as table" }).click()
  await expect(page.getByRole("menu")).toHaveCount(0)
  return card
}

test.describe("Insights Page", () => {
  test("renders the heading, strip and every card without errors", async ({ page }) => {
    await page.goto("/insights")
    await expect(page.getByRole("heading", { name: "Insights", level: 1 })).toBeVisible()
    for (const label of ["Income", "Spent", "Saved", "Recurring"]) {
      await expect(metric(page, label)).toBeVisible()
    }
    for (const name of [
      "Income and expenses",
      "Recurring and other spending",
      "By month",
      "Daily spending",
      "Budget history",
    ]) {
      await expect(page.getByRole("region", { name })).toBeVisible()
    }
    await expect(page.getByText(/Unable to load|is unavailable/)).toHaveCount(0)
    await expect(page.getByTestId("app-loading-fallback")).toHaveCount(0)
  })

  test("shows the strip and exact monthly values for all time and follows period changes", async ({
    page,
  }) => {
    await page.goto("/")
    const isolated = await loginAsIsolatedUser(page)
    const { lastMonth, thisMonth } = await provisionInsightsData(isolated.request, isolated.csrfToken)
    await isolated.request.dispose()

    await page.goto("/insights")
    await expect(metric(page, "Income")).toContainText(eur("2.000,00 €"))
    await expect(metric(page, "Spent")).toContainText(eur("620,00 €"))
    await expect(metric(page, "Spent")).toContainText("per month")
    await expect(metric(page, "Saved")).toContainText(eur("1.380,00 €"))
    await expect(metric(page, "Saved")).toContainText("69 % of income")

    const flow = await showAsTable(page, "Income and expenses")
    const flowTable = flow.getByRole("table", { name: "Income and expenses by month" })
    const lastRow = flowTable.getByRole("row", { name: new RegExp(`^${monthLabel(lastMonth)}`) })
    await expect(lastRow).toContainText(eur("2.000,00 €"))
    await expect(lastRow).toContainText("500,00 €")
    await expect(lastRow).toContainText(eur("1.500,00 €"))
    const thisRow = flowTable.getByRole("row", { name: new RegExp(`^${monthLabel(thisMonth)}`) })
    await expect(thisRow).toContainText("120,00 €")

    await page.getByRole("button", { name: /^Period:/ }).click()
    await page.getByRole("menuitemcheckbox", { name: "Last month" }).click()
    await expect(page).toHaveURL(/period=last_month/)
    await expect(page.getByRole("menu")).toHaveCount(0)
    await expect(metric(page, "Income")).toContainText(eur("2.000,00 €"))
    await expect(metric(page, "Spent")).toContainText("500,00 €")
    await expect(metric(page, "Saved")).toContainText(eur("1.500,00 €"))
    await expect(metric(page, "Saved")).toContainText("75 % of income")
    await expect(flowTable.getByRole("row")).toHaveCount(2)

    await page.getByRole("button", { name: /^Period:/ }).click()
    await page.getByRole("menuitemcheckbox", { name: "This month" }).click()
    await expect(page).toHaveURL(/period=this_month/)
    await expect(metric(page, "Spent")).toContainText("120,00 €")
    await expect(metric(page, "Income")).toContainText("0,00 €")
  })

  test("includes or excludes tags with the Filter and keeps the choice in the URL", async ({
    page,
  }) => {
    await page.goto("/")
    const isolated = await loginAsIsolatedUser(page)
    const { tagId } = await provisionInsightsData(isolated.request, isolated.csrfToken)
    await isolated.request.dispose()

    await page.goto("/insights")
    await expect(metric(page, "Spent")).toContainText("620,00 €")
    await page.getByRole("button", { name: "Filter", exact: true }).click()
    const filter = page.getByRole("dialog", { name: "Filter" })
    await filter.getByRole("checkbox", { name: "Trip" }).click()
    await expect(page).toHaveURL(new RegExp(`tags=${tagId}(?:&|$)`))
    await expect(metric(page, "Spent")).toContainText("500,00 €")
    await expect(metric(page, "Spent")).not.toContainText("620,00 €")

    await filter.getByRole("radio", { name: "Exclude" }).click()
    await expect(page).toHaveURL(new RegExp(`exclude_tags=${tagId}(?:&|$)`))
    await expect(page).not.toHaveURL(/[?&]tags=/)
    await expect(metric(page, "Spent")).toContainText("120,00 €")
    await expect(metric(page, "Spent")).not.toContainText("620,00 €")
    await page.keyboard.press("Escape")
    await expect(page.getByRole("button", { name: "Filter · 1" })).toBeVisible()

    await page.reload()
    await expect(page.getByRole("button", { name: "Filter · 1" })).toBeVisible()
    await expect(metric(page, "Spent")).toContainText("120,00 €")

    await page.getByRole("button", { name: "Filter · 1" }).click()
    await page.getByRole("dialog", { name: "Filter" }).getByRole("checkbox", { name: "Trip" }).click()
    await expect(page).not.toHaveURL(/exclude_tags=/)
    await expect(metric(page, "Spent")).toContainText("620,00 €")
  })

  test("lists the exact amounts of the By month grid for expenses, income and tags", async ({
    page,
  }) => {
    await page.goto("/")
    const isolated = await loginAsIsolatedUser(page)
    await provisionInsightsData(isolated.request, isolated.csrfToken)
    await isolated.request.dispose()

    await page.goto("/insights")
    const card = await showAsTable(page, "By month")
    const table = card.getByRole("table", { name: "Amounts by month" })
    await expect(table.getByRole("columnheader", { name: "Category" })).toBeVisible()
    await expect(table.getByRole("row", { name: /^Rent/ })).toContainText("500 €")
    await expect(table.getByRole("row", { name: /^Dining/ })).toContainText("120 €")
    await expect(table.getByRole("row", { name: /^Salary/ })).toHaveCount(0)

    await card.getByRole("radio", { name: "Income" }).click()
    await expect(table.getByRole("row", { name: /^Salary/ })).toContainText(eur("2.000 €"))
    await expect(table.getByRole("row", { name: /^Rent/ })).toHaveCount(0)

    await card.getByRole("radio", { name: "Tags" }).click()
    await expect(table.getByRole("columnheader", { name: "Tag" })).toBeVisible()
    await expect(table.getByRole("row", { name: /^Trip/ })).toContainText("500 €")
    await expect(table.getByRole("row", { name: /^Rent/ })).toHaveCount(0)

    await card.getByRole("radio", { name: "Expenses" }).click()
    await expect(table.getByRole("row", { name: /^Rent/ })).toBeVisible()
  })

  test("opens the ledger from a By month table link and returns with the breadcrumb", async ({
    page,
  }) => {
    await page.goto("/")
    const isolated = await loginAsIsolatedUser(page)
    const { lastMonth, rentId, tagId } = await provisionInsightsData(
      isolated.request,
      isolated.csrfToken,
    )
    await isolated.request.dispose()

    await page.goto("/insights")
    const card = await showAsTable(page, "By month")
    const table = card.getByRole("table", { name: "Amounts by month" })
    await table.getByRole("row", { name: /^Rent/ }).getByRole("link", { name: "500 €", exact: true }).click()
    await expect(page).toHaveURL(
      new RegExp(`/transactions\\?.*period=custom.*start=${lastMonth}-01.*category=${rentId}.*from=insights`),
    )
    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" })
    await expect(breadcrumb).toContainText("Insights")
    await expect(page.getByRole("listitem", { name: "Rent payment" })).toBeVisible()
    await expect(page.getByRole("listitem", { name: "Salary payment" })).toHaveCount(0)

    await breadcrumb.getByRole("link", { name: "Insights" }).click()
    await expect(page.getByRole("heading", { name: "Insights", level: 1 })).toBeVisible()

    await showAsTable(page, "By month")
    await page.getByRole("region", { name: "By month" }).getByRole("radio", { name: "Tags" }).click()
    await page
      .getByRole("table", { name: "Amounts by month" })
      .getByRole("row", { name: /^Trip/ })
      .getByRole("link", { name: "500 €", exact: true })
      .click()
    await expect(page).toHaveURL(new RegExp(`/transactions\\?.*tags=${tagId}.*from=insights`))
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Insights")
    await expect(page.getByRole("listitem", { name: "Rent payment" })).toBeVisible()
  })

  test("opens the ledger when a By month grid cell is clicked", async ({ page }) => {
    await page.goto("/")
    const isolated = await loginAsIsolatedUser(page)
    const { rentId } = await provisionInsightsData(isolated.request, isolated.csrfToken)
    await isolated.request.dispose()

    await page.goto("/insights")
    const row = page
      .getByRole("region", { name: "By month" })
      .locator('[class*="_hmRow_"]')
      .filter({ hasText: "Rent" })
    // The last cell is the month in progress; the one before it is last month.
    await row.locator('[class*="_hmCell_"]').nth(11).click()
    await expect(page).toHaveURL(new RegExp(`/transactions\\?.*category=${rentId}.*from=insights`))
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Insights")
    await expect(page.getByRole("listitem", { name: "Rent payment" })).toBeVisible()
  })

  test("shows merged categories in the By month drill-down", async ({ page }) => {
    await page.goto("/")
    const isolated = await loginAsIsolatedUser(page)
    const { lastMonth } = await provisionInsightsData(isolated.request, isolated.csrfToken)
    const sourceId = await createCategory(isolated.request, isolated.csrfToken, "expense", "Merge Source")
    const targetId = await createCategory(isolated.request, isolated.csrfToken, "expense", "Merge Target")
    await createTransaction(isolated.request, isolated.csrfToken, {
      date: `${lastMonth}-15`,
      occurred_at: `${lastMonth}-15T09:00:00`,
      type: "expense",
      amount_cents: 96_000,
      category_id: sourceId,
      title: "Merged expense",
      tags: [],
    })
    const merge = await isolated.request.post("/api/categories/merge", {
      headers: { "X-CSRF-Token": isolated.csrfToken },
      data: { source_category_id: sourceId, target_category_id: targetId },
    })
    expect(merge.ok()).toBeTruthy()
    await isolated.request.dispose()

    await page.goto("/insights")
    const card = await showAsTable(page, "By month")
    const table = card.getByRole("table", { name: "Amounts by month" })
    await expect(table.getByRole("row", { name: /^Merge Source/ })).toHaveCount(0)
    await table.getByRole("row", { name: /^Merge Target/ }).getByRole("link", { name: /^960 €$/ }).click()
    await expect(page).toHaveURL(new RegExp(`/transactions\\?.*category=${targetId}.*from=insights`))
    await expect(page.getByRole("listitem", { name: "Merged expense" })).toBeVisible()
  })

  test("lists daily spending and weekday averages and opens a day in the ledger", async ({
    page,
  }) => {
    await page.goto("/")
    const isolated = await loginAsIsolatedUser(page)
    const { thisMonth } = await provisionInsightsData(isolated.request, isolated.csrfToken)
    await isolated.request.dispose()

    await page.goto("/insights")
    const card = await showAsTable(page, "Daily spending")
    const weekdays = card.getByRole("table", { name: "Average spending by weekday" })
    await expect(weekdays.getByRole("row")).toHaveCount(8)
    await expect(weekdays.getByRole("row", { name: /^Monday/ })).toBeVisible()
    await expect(weekdays.getByRole("row", { name: /^Sunday/ })).toBeVisible()

    const day = `${thisMonth}-01`
    const dayLabel = new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    })
    const days = card.getByRole("table", { name: "Spending by day" })
    await expect(days.getByRole("row")).toHaveCount(3)
    await expect(days.getByRole("row", { name: new RegExp(`^${dayLabel}`) })).toContainText("120,00 €")
    await days.getByRole("link", { name: dayLabel }).click()
    await expect(page).toHaveURL(new RegExp(`/transactions\\?.*start=${day}.*end=${day}.*from=insights`))
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Insights")
    await expect(page.getByRole("listitem", { name: "Team dinner" })).toBeVisible()
    await expect(page.getByRole("listitem", { name: "Rent payment" })).toHaveCount(0)
  })

  test("links the budget history table to the budgets of that month", async ({ page }) => {
    await page.goto("/")
    const isolated = await loginAsIsolatedUser(page)
    const { thisMonth } = await provisionInsightsData(isolated.request, isolated.csrfToken)
    await isolated.request.dispose()

    await page.goto("/insights")
    const card = await showAsTable(page, "Budget history")
    const table = card.getByRole("table", { name: "Budget history by month" })
    const row = table.getByRole("row", { name: /^Dining/ })
    await expect(row).toContainText("0 € of 300 €")
    await expect(row).toContainText("1 of 1")
    await row.getByRole("link", { name: "120 € of 300 €" }).click()
    await expect(page).toHaveURL(new RegExp(`/budgets\\?month=${thisMonth}`))
    await expect(page.getByRole("heading", { name: "Budgets", level: 1 })).toBeVisible()

    await page.goto("/insights")
    await page.getByRole("button", { name: "Open budgets" }).click()
    await expect(page).toHaveURL(/\/budgets$/)
  })

  test("spreads durables over the days of their life and keeps Spent on the purchase", async ({ page }) => {
    await page.goto("/")
    const isolated = await loginAsIsolatedUser(page)
    // A 1.000 € laptop over 1.000 days from the first of last month: 1 € a day.
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const lastMonth = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`
    const lastMonthDays = new Date(now.getFullYear(), now.getMonth(), 0).getDate()
    const category = await createCategory(isolated.request, isolated.csrfToken, "expense", "Electronics")
    const transactionId = await createTransaction(isolated.request, isolated.csrfToken, {
      date: `${lastMonth}-01`,
      occurred_at: `${lastMonth}-01T09:00:00`,
      type: "expense",
      amount_cents: 100_000,
      category_id: category,
      title: "Laptop",
      tags: [],
    })
    const durable = await isolated.request.post(`/api/transactions/${transactionId}/durable`, {
      headers: { "X-CSRF-Token": isolated.csrfToken },
      data: { expected_lifespan_days: 1000 },
    })
    expect(durable.ok()).toBeTruthy()
    await isolated.request.dispose()

    await page.goto("/insights")
    const flow = await showAsTable(page, "Income and expenses")
    const lastRow = flow
      .getByRole("table", { name: "Income and expenses by month" })
      .getByRole("row", { name: new RegExp(`^${monthLabel(lastMonth)}`) })
    await expect(lastRow).toContainText(eur("1.000,00 €"))

    const spread = page.getByRole("button", { name: "Spread durables" })
    await spread.click()
    await expect(spread).toHaveAttribute("aria-pressed", "true")
    await expect(page).toHaveURL(/spread_durables=true/)
    await expect(lastRow).toContainText(eur(`${lastMonthDays},00 €`))
    await expect(lastRow).not.toContainText(eur("1.000,00 €"))
    await expect(metric(page, "Spent")).toContainText(eur("1.000,00 €"))
  })
})
