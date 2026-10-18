import { expect, test } from "./fixtures"
import { createCategory, createTransaction, ensureCategory, getCsrfToken } from "./helpers"

function nextMonth(): { value: string; short: string; long: string } {
  const date = new Date()
  date.setDate(1)
  date.setMonth(date.getMonth() + 1)
  return {
    value: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
    short: new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(date),
    long: new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(date),
  }
}

function previousMonthDate(monthsAgo: number): string {
  const value = new Date()
  value.setMonth(value.getMonth() - monthsAgo, 15)
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-15`
}

test.describe("Planning surfaces (mobile)", () => {
  test("changes the forecast and carries its state into What If", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Forecast")
    for (const [index, amount] of [12000, 18000, 15000, 12000, 18000, 15000, 12000, 18000, 15000].entries()) {
      const transactionDate = previousMonthDate(index + 1)
      await createTransaction(request, token, {
        date: transactionDate,
        occurred_at: `${transactionDate}T12:00:00`,
        type: "expense",
        amount_cents: amount,
        category_id: categoryId,
        title: `Forecast history ${index + 1}`,
        tags: [],
      })
    }

    await page.goto("/forecast")
    await expect(page.getByText(/80% range/).first()).toBeVisible()
    await page.getByRole("radio", { name: "12M" }).click()
    await page.getByRole("radio", { name: "Recurring only" }).click()
    await expect(page).toHaveURL(/horizon=12/)
    await expect(page).toHaveURL(/mode=recurring/)
    await expect(
      page.getByRole("list", { name: "Monthly outlook" }).getByRole("listitem"),
    ).toHaveCount(12)

    await page.getByRole("link", { name: "What if", exact: true }).click()
    await expect(page).toHaveURL(/\/scenarios\?horizon=12&mode=recurring/)
    await expect(page.getByRole("heading", { name: "What If", level: 1 })).toBeVisible()
    await expect(page.getByRole("radio", { name: "12M" })).toBeChecked()
    await expect(page.getByRole("radio", { name: "Recurring only" })).toBeChecked()
  })

  test("opens a forecast month and returns to the outlook", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryId = await createCategory(
      request,
      token,
      "expense",
      `E2E Mobile Forecast Rent ${Date.now()}`,
    )
    const month = nextMonth()
    const ruleName = `E2E Mobile Forecast Rule ${Date.now()}`
    const response = await request.post("/api/recurring", {
      headers: { "X-CSRF-Token": token },
      data: {
        name: ruleName,
        type: "expense",
        currency_code: "EUR",
        amount_cents: 90_000_000,
        category_id: categoryId,
        anchor_date: `${month.value}-02`,
        interval_unit: "month",
        interval_count: 1,
        next_occurrence: `${month.value}-02`,
        end_date: null,
        auto_post: true,
        skip_weekends: false,
        month_day_policy: "snap_to_end",
      },
    })
    expect(response.ok()).toBeTruthy()

    await page.goto("/forecast?mode=recurring")
    const row = page.getByRole("listitem", { name: month.long })
    await row.click()
    await expect(page).toHaveURL(new RegExp(`peek=${month.value}`))
    const peek = page.getByRole("complementary", { name: month.long })
    await expect(peek.getByRole("list", { name: "Recurring" })).toContainText(ruleName)
    await peek.getByRole("button", { name: "Forecast" }).click()
    await expect(page).not.toHaveURL(/peek=/)
    await expect(row).toBeVisible()
  })

  test("adds and removes a one-time scenario adjustment", async ({ page }) => {
    await page.goto("/scenarios")
    const adjustments = page.getByRole("region", { name: "Adjustments" })
    await adjustments.getByRole("button", { name: "Add", exact: true }).click()
    await page.getByRole("menuitem", { name: "One-time event" }).click()
    const form = adjustments.locator("form")
    await form.getByLabel("Name").fill("Mobile vacation")
    await form.getByLabel("Amount").fill("300.00")
    await form.getByRole("button", { name: "Add", exact: true }).click()

    await expect(adjustments.getByRole("listitem")).toContainText(
      new RegExp(`^Mobile vacation in ${nextMonth().short}`),
    )
    await expect(page.getByText("after 1 adjustment")).toBeVisible()
    const chart = page.getByRole("region", { name: "Balance" })
    await expect(chart.getByText("Difference", { exact: true })).toBeVisible()
    const impact = page.getByRole("list", { name: "Impact by adjustment" })
    await expect(impact).toContainText("Mobile vacation")
    await expect(impact).toContainText(/300\s?€/)

    await adjustments.getByRole("button", { name: "Remove adjustment" }).click()
    await expect(adjustments.getByText("No adjustments")).toBeVisible()
    await expect(page.getByText("No changes")).toBeVisible()
    await expect(page.getByRole("list", { name: "Impact by adjustment" })).toHaveCount(0)
  })
})
