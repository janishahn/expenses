import { expect, test } from "./fixtures"
import { createCategory, createTransaction, getCsrfToken } from "./helpers"

const THEME_STORAGE_KEY = "ew.theme.preference"

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
  test("renders controls, summary strip and the balance chart with its table", async ({
    page,
  }) => {
    await page.goto("/forecast")
    await expect(page.getByRole("heading", { name: "Forecast", level: 1 })).toBeVisible()

    const horizon = page.getByRole("radiogroup", { name: "Forecast horizon" })
    await expect(horizon.getByRole("radio", { name: "3 months" })).toBeVisible()
    await expect(horizon.getByRole("radio", { name: "6 months" })).toBeChecked()
    await expect(horizon.getByRole("radio", { name: "12 months" })).toBeVisible()
    const model = page.getByRole("radiogroup", { name: "Forecast model" })
    await expect(model.getByRole("radio", { name: "Recurring only" })).toBeVisible()
    await expect(model.getByRole("radio", { name: "With estimates" })).toBeChecked()

    await expect(page.getByText("Average monthly net")).toBeVisible()
    await expect(page.getByText("Below zero", { exact: true })).toBeVisible()
    await expect(page.getByText(/^Balance in /)).toBeVisible()

    const card = page.getByRole("region", { name: "Balance" })
    await expect(card.getByRole("button", { name: /still expected this month/ })).toBeVisible()
    await card.getByRole("button", { name: "Chart options" }).click()
    await page.getByRole("menuitemcheckbox", { name: "Show as table" }).click()
    const table = card.getByRole("table", { name: "Projected balance by month" })
    await expect(table.getByRole("rowheader", { name: "Now" })).toBeVisible()
    await expect(table.locator("tbody tr")).toHaveCount(7)
    await expect(page.getByRole("list", { name: "Monthly outlook" }).getByRole("listitem")).toHaveCount(6)
  })

  test("updates the query when changing horizon and mode", async ({ page }) => {
    await page.goto("/forecast")
    await page.getByRole("radio", { name: "3 months" }).click()
    await expect(page).toHaveURL(/horizon=3/)
    await expect(
      page.getByRole("list", { name: "Monthly outlook" }).getByRole("listitem"),
    ).toHaveCount(3)
    await page.getByRole("radio", { name: "Recurring only" }).click()
    await expect(page).toHaveURL(/mode=recurring/)
    await expect(page.getByRole("radio", { name: "Recurring only" })).toBeChecked()
    await expect(page.getByRole("radio", { name: "3 months" })).toBeChecked()
  })

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

  test("preserves explicit light mode and route state when navigating to scenarios and back", async ({
    page,
  }) => {
    await page.addInitScript(
      ([storageKey, value]) => {
        window.localStorage.setItem(storageKey, value)
      },
      [THEME_STORAGE_KEY, "light"] as const,
    )
    await page.goto("/forecast")
    await page.getByRole("radio", { name: "12 months" }).click()
    await page.getByRole("radio", { name: "Recurring only" }).click()

    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("light")

    await page.getByRole("link", { name: "What if", exact: true }).click()
    await expect(page).toHaveURL(/\/scenarios\?/)
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("light")

    await page.goBack()
    await expect(page).toHaveURL(/\/forecast\?horizon=12&mode=recurring/)
    await expect(page.getByRole("radio", { name: "12 months" })).toBeChecked()
    await expect(page.getByRole("radio", { name: "Recurring only" })).toBeChecked()
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("light")
  })
})
