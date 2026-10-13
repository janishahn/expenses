import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { loginAsIsolatedUser, provisionInsightsData } from "./helpers"

test.describe.configure({ mode: "parallel" })

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
  await card.getByRole("button", { name: "Chart options" }).tap()
  await page.getByRole("menuitemcheckbox", { name: "Show as table" }).tap()
  await expect(page.getByRole("menu")).toHaveCount(0)
  return card
}

test.describe("Insights Page (mobile)", () => {
  test("renders the heading and every card without horizontal page scrolling", async ({
    page,
  }) => {
    await page.goto("/")
    const isolated = await loginAsIsolatedUser(page)
    await provisionInsightsData(isolated.request, isolated.csrfToken)
    await isolated.request.dispose()

    await page.goto("/insights")
    await expect(page.getByRole("heading", { name: "Insights", level: 1 })).toBeVisible()
    for (const name of [
      "Income and expenses",
      "Recurring and other spending",
      "By month",
      "Daily spending",
      "Budget history",
    ]) {
      const card = page.getByRole("region", { name })
      await card.scrollIntoViewIfNeeded()
      await expect(card).toBeVisible()
    }
    await expect(page.getByText(/Unable to load|is unavailable/)).toHaveCount(0)
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      )
      .toBeLessThanOrEqual(0)
  })

  test("applies period and tag filters from the mobile controls", async ({ page }) => {
    await page.goto("/")
    const isolated = await loginAsIsolatedUser(page)
    const { tagId } = await provisionInsightsData(isolated.request, isolated.csrfToken)
    await isolated.request.dispose()

    await page.goto("/insights")
    await expect(metric(page, "Spent")).toContainText(eur("620,00 €"))
    await expect(metric(page, "Income")).toContainText(eur("2.000,00 €"))

    await page.getByRole("button", { name: /^Period:/ }).tap()
    await page.getByRole("menuitemcheckbox", { name: "Last month" }).tap()
    await expect(page).toHaveURL(/period=last_month/)
    await expect(page.getByRole("menu")).toHaveCount(0)
    await expect(metric(page, "Spent")).toContainText("500,00 €")
    await expect(metric(page, "Saved")).toContainText(eur("1.500,00 €"))

    await page.getByRole("button", { name: "Filter", exact: true }).tap()
    const sheet = page.getByRole("dialog", { name: "Filter" })
    await expect(sheet).toBeVisible()
    await sheet.getByRole("radio", { name: "Exclude" }).tap()
    await sheet.getByRole("checkbox", { name: "Trip" }).click()
    await expect(page).toHaveURL(new RegExp(`exclude_tags=${tagId}(?:&|$)`))
    await expect(page).toHaveURL(/period=last_month/)
    await expect(page.getByRole("menu")).toHaveCount(0)
    await expect(metric(page, "Spent")).toContainText("0,00 €")
    await expect(metric(page, "Spent")).not.toContainText("500,00 €")
    await page.keyboard.press("Escape")
    await expect(sheet).toBeHidden()
    await expect(page.getByRole("button", { name: "Filter · 1" })).toBeVisible()
  })

  test("lists the exact By month amounts and opens the ledger with the Insights breadcrumb", async ({
    page,
  }) => {
    await page.goto("/")
    const isolated = await loginAsIsolatedUser(page)
    const { lastMonth, rentId } = await provisionInsightsData(
      isolated.request,
      isolated.csrfToken,
    )
    await isolated.request.dispose()

    await page.goto("/insights")
    const card = await showAsTable(page, "By month")
    const table = card.getByRole("table", { name: "Amounts by month" })
    await expect(table.getByRole("row", { name: /^Dining/ })).toContainText("120 €")
    await card.getByRole("radio", { name: "Income" }).tap()
    await expect(table.getByRole("row", { name: /^Salary/ })).toContainText(eur("2.000 €"))
    await card.getByRole("radio", { name: "Tags" }).tap()
    await expect(table.getByRole("row", { name: /^Trip/ })).toContainText("500 €")
    await card.getByRole("radio", { name: "Expenses" }).tap()

    await table.getByRole("row", { name: /^Rent/ }).getByRole("link", { name: "500 €", exact: true }).tap()
    await expect(page).toHaveURL(
      new RegExp(`/transactions\\?.*start=${lastMonth}-01.*category=${rentId}.*from=insights`),
    )
    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" })
    await expect(breadcrumb).toContainText("Insights")
    await expect(page.getByRole("listitem", { name: "Rent payment" })).toBeVisible()
    await breadcrumb.getByRole("link", { name: "Insights" }).tap()
    await expect(page.getByRole("heading", { name: "Insights", level: 1 })).toBeVisible()
  })

  test("opens a day of daily spending and the budget history month", async ({ page }) => {
    await page.goto("/")
    const isolated = await loginAsIsolatedUser(page)
    const { thisMonth } = await provisionInsightsData(isolated.request, isolated.csrfToken)
    await isolated.request.dispose()

    await page.goto("/insights")
    const daily = await showAsTable(page, "Daily spending")
    const day = `${thisMonth}-01`
    const dayLabel = new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    })
    await expect(
      daily.getByRole("table", { name: "Spending by day" }).getByRole("row", { name: new RegExp(`^${dayLabel}`) }),
    ).toContainText("120,00 €")
    await daily.getByRole("link", { name: dayLabel }).tap()
    await expect(page).toHaveURL(new RegExp(`start=${day}.*end=${day}.*from=insights`))
    await expect(page.getByRole("listitem", { name: "Team dinner" })).toBeVisible()

    await page.goto("/insights")
    const budgets = await showAsTable(page, "Budget history")
    await budgets
      .getByRole("table", { name: "Budget history by month" })
      .getByRole("row", { name: /^Dining/ })
      .getByRole("link", { name: "120 € of 300 €" })
      .tap()
    await expect(page).toHaveURL(new RegExp(`/budgets\\?month=${thisMonth}`))
    await expect(page.getByRole("heading", { name: "Budgets", level: 1 })).toBeVisible()
  })
})
