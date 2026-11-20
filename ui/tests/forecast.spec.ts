import { expect, test } from "./fixtures"
import { createCategory, createTransaction, getCsrfToken } from "./helpers"

function nextMonth(offset = 1): { value: string; short: string; long: string } {
  const date = new Date()
  date.setDate(1)
  date.setMonth(date.getMonth() + offset)
  const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
  return {
    value,
    short: new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(date),
    long: new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(date),
  }
}

test.describe("Forecast Page", () => {
  test("opens What If with the chosen horizon and model", async ({ page }) => {
    await page.goto("/forecast")
    await page.getByRole("radio", { name: "12 months" }).click()
    await page.getByRole("radio", { name: "Recurring only" }).click()
    await page.getByRole("link", { name: "What if", exact: true }).click()
    await expect(page).toHaveURL(/\/scenarios\?horizon=12&mode=recurring/)
    await expect(page.getByRole("radio", { name: "12 months" })).toBeChecked()
    await expect(page.getByRole("radio", { name: "Recurring only" })).toBeChecked()
  })

  test("shows monthly drill-down details and the negative-balance warning", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await createCategory(
      request,
      token,
      "expense",
      `E2E Forecast Housing ${Date.now()}`,
    )
    const incomeId = await createCategory(
      request,
      token,
      "income",
      `E2E Forecast Savings ${Date.now()}`,
    )
    // A positive starting balance, so the rule below is what takes it below zero.
    await createTransaction(request, token, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "income",
      amount_cents: 20_000_000,
      category_id: incomeId,
      title: "E2E Forecast starting balance",
      tags: [],
    })
    const month = nextMonth()
    const ruleName = `E2E Forecast Rent ${Date.now()}`
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
    const strip = page.locator("section").filter({ hasText: "Below zero" }).first()
    await expect(strip).toContainText(month.short)
    await expect(strip).toContainText("expected")

    const row = page.getByRole("listitem", { name: month.long })
    await expect(row).toContainText("Dips below zero")
    await row.click()
    await expect(page).toHaveURL(new RegExp(`peek=${month.value}`))
    const peek = page.getByRole("complementary", { name: month.long })
    await expect(peek.getByText("Lowest", { exact: true })).toBeVisible()
    await expect(peek.getByText("Expenses", { exact: true })).toBeVisible()
    await expect(peek.getByText("Net", { exact: true })).toBeVisible()
    await expect(peek.getByText(/900\s?000,00\s?€/).first()).toBeVisible()
    await expect(peek.getByRole("list", { name: "Recurring" })).toContainText(ruleName)
    await expect(peek.getByRole("heading", { name: "One-time" })).toBeVisible()
    await expect(peek.getByRole("heading", { name: "Estimated" })).toHaveCount(0)

    await page.getByRole("radio", { name: "With estimates" }).click()
    await expect(peek.getByRole("heading", { name: "Estimated" })).toBeVisible()

    await peek.getByRole("button", { name: "Close" }).click()
    await expect(page).not.toHaveURL(/peek=/)
  })
})
