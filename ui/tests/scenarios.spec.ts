import { expect, test } from "./fixtures"
import { ensureCategory, getCsrfToken } from "./helpers"

function nextMonthValue(): string {
  const now = new Date()
  const value = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, "0")
  return `${year}-${month}`
}

test.describe("Scenarios Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/scenarios")
  })

  test("should validate incomplete adjustment input", async ({ page }) => {
    await page.getByLabel("Adjustment type").selectOption("add_rule")
    await page.getByRole("button", { name: "Add adjustment" }).click()
    await expect(page.getByText("Enter a valid name and amount.")).toBeVisible()
  })

  test("should add one-time event adjustment", async ({ page }) => {
    await page.getByLabel("Adjustment type").selectOption("one_time")
    await page.getByLabel("Name").fill("Vacation")
    await page.getByRole("textbox", { name: "Month", exact: true }).fill(nextMonthValue())
    await page.getByLabel("Amount").fill("300.00")
    await page.getByRole("button", { name: "Add adjustment" }).click()
    await expect(page.locator("text=Vacation")).toBeVisible()
  })

  test("should add remove-rule adjustment when recurring rule exists", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const incomeCategory = await ensureCategory(request, token, "income", "E2E Scn Inc")
    const month = nextMonthValue()
    const ruleName = `E2E Scenario Salary ${Date.now()}`
    const response = await request.post("/api/recurring", {
      headers: { "X-CSRF-Token": token },
      data: {
        name: ruleName,
        type: "income",
        currency_code: "EUR",
        amount_cents: 200_000,
        category_id: incomeCategory,
        anchor_date: `${month}-01`,
        interval_unit: "month",
        interval_count: 1,
        next_occurrence: `${month}-01`,
        end_date: null,
        auto_post: true,
        skip_weekends: false,
        month_day_policy: "snap_to_end",
      },
    })
    expect(response.ok()).toBeTruthy()

    await page.goto("/scenarios")
    await page.getByLabel("Adjustment type").selectOption("remove_rule")
    const ruleSelect = page.locator("select").nth(1)
    await expect(ruleSelect).toBeVisible()
    await ruleSelect.selectOption({ index: 1 })
    await page.getByRole("button", { name: "Add adjustment" }).click()
    await expect(page.getByLabel("Delete adjustment").first()).toBeVisible()
  })

  test("should render comparison chart and impact summary", async ({ page }) => {
    await page.getByLabel("Adjustment type").selectOption("one_time")
    await page.getByLabel("Name").fill("Scenario chart event")
    await page.getByRole("textbox", { name: "Month", exact: true }).fill(nextMonthValue())
    await page.getByLabel("Amount").fill("200.00")
    await page.getByRole("button", { name: "Add adjustment" }).click()
    const chart = page.locator("canvas").first()
    await expect(chart).toBeVisible()
    const restingChart = await chart.evaluate((canvas) => canvas.toDataURL())
    await chart.hover({ position: { x: 180, y: 140 } })
    await expect
      .poll(() => chart.evaluate((canvas) => canvas.toDataURL()))
      .not.toBe(restingChart)
    await expect(page.locator("text=Average monthly delta")).toBeVisible()
  })

  test("should render monthly impact table by modification", async ({ page }) => {
    await page.getByLabel("Adjustment type").selectOption("one_time")
    await page.getByLabel("Name").fill("Scenario table event")
    await page.getByRole("textbox", { name: "Month", exact: true }).fill(nextMonthValue())
    await page.getByLabel("Amount").fill("120.00")
    await page.getByRole("button", { name: "Add adjustment" }).click()
    await expect(page.getByText("Modification")).toBeVisible()
    await expect(page.getByText("Total")).toBeVisible()
  })

  test("should clear stale comparison output after deleting the last adjustment", async ({
    page,
  }) => {
    await page.getByLabel("Adjustment type").selectOption("one_time")
    await page.getByLabel("Name").fill("Scenario delete event")
    await page.getByRole("textbox", { name: "Month", exact: true }).fill(nextMonthValue())
    await page.getByLabel("Amount").fill("80.00")
    await page.getByRole("button", { name: "Add adjustment" }).click()

    await expect(page.locator("canvas").first()).toBeVisible()
    await expect(page.locator("text=Average monthly delta")).toBeVisible()

    await page.getByLabel("Delete adjustment").click()

    await expect(
      page.getByText("No adjustments yet. Add one to simulate impact.")
    ).toBeVisible()
    await expect(
      page.getByText("Add an adjustment to render scenario comparison and impact.")
    ).toBeVisible()
    await expect(page.locator("text=Average monthly delta")).not.toBeVisible()
    await expect(page.getByText("Modification")).not.toBeVisible()
  })

})
