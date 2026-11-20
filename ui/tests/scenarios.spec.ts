import type { Locator, Page } from "@playwright/test"
import { expect, test } from "./fixtures"

function nextMonthDate(): Date {
  const value = new Date()
  value.setDate(1)
  value.setMonth(value.getMonth() + 1)
  return value
}

function monthShort(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(date)
}

function adjustments(page: Page): Locator {
  return page.getByRole("region", { name: "Adjustments" })
}

async function openAdjustmentForm(page: Page, kind: string): Promise<Locator> {
  await expect(page.getByRole("menu")).toHaveCount(0)
  await adjustments(page).getByRole("button", { name: "Add", exact: true }).click()
  await page.getByRole("menuitem", { name: kind }).click()
  const form = adjustments(page).locator("form")
  await expect(form).toBeVisible()
  // The opened form takes focus from the Add menu.
  await expect(form.getByLabel("Adjustment")).toBeFocused()
  return form
}

function submit(form: Locator): Promise<void> {
  return form.getByRole("button", { name: "Add", exact: true }).click()
}

async function addOneTime(page: Page, name: string, amount: string): Promise<void> {
  const form = await openAdjustmentForm(page, "One-time event")
  await form.getByLabel("Name").fill(name)
  await form.getByLabel("Amount").fill(amount)
  await submit(form)
}

test.describe("Scenarios Page", () => {
  test("adds a one-time event and shows the comparison chart, strip and impact list", async ({
    page,
  }) => {
    await page.goto("/scenarios")
    await expect(page.getByText("No changes")).toBeVisible()
    await addOneTime(page, "Vacation", "300.00")

    const month = monthShort(nextMonthDate())
    await expect(adjustments(page).getByRole("listitem")).toContainText(`Vacation in ${month}`)
    await expect(page.getByText(/^Baseline in /)).toBeVisible()
    await expect(page.getByText(/^Scenario in /)).toBeVisible()
    await expect(page.getByText("after 1 adjustment")).toBeVisible()
    await expect(page.getByText("No changes")).toHaveCount(0)

    const chart = page.getByRole("region", { name: "Balance" })
    await expect(chart.getByText("Scenario", { exact: true })).toBeVisible()
    await expect(chart.getByText("Baseline", { exact: true })).toBeVisible()
    await expect(chart.getByText("Difference", { exact: true })).toBeVisible()
    await chart.getByRole("button", { name: "Chart options" }).click()
    await page.getByRole("menuitemcheckbox", { name: "Show as table" }).click()
    const table = chart.getByRole("table", { name: "Scenario and baseline balance by month" })
    await expect(table.getByRole("columnheader")).toHaveText([
      "Month",
      "Scenario",
      "Baseline",
      "Difference",
    ])
    await expect(
      table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: month }) }),
    ).toContainText(/300,00\s?€/)
    await expect(
      table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Now" }) }),
    ).toContainText(/0,00\s?€/)

    const impact = page.getByRole("list", { name: "Impact by adjustment" })
    await expect(impact.getByRole("listitem")).toHaveCount(1)
    await expect(impact).toContainText(`Vacation in ${month}`)
    await expect(impact).toContainText(/300\s?€/)
  })

  test("totals several adjustments in the impact list", async ({ page }) => {
    await page.goto("/scenarios")
    await addOneTime(page, "First event", "100")
    await addOneTime(page, "Second event", "50")

    await expect(page.getByText("after 2 adjustments")).toBeVisible()
    await expect(adjustments(page).getByRole("listitem")).toHaveCount(2)
    const impact = page.getByRole("list", { name: "Impact by adjustment" })
    await expect(impact.getByRole("listitem")).toHaveCount(3)
    const total = impact.getByRole("listitem").last()
    await expect(total).toContainText("Total")
    await expect(total).toContainText(/150\s?€/)
  })
})
