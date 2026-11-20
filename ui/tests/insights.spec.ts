import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { loginAsIsolatedUser, provisionInsightsData } from "./helpers"

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
})
