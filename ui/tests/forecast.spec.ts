import { expect, test } from "@playwright/test"

const THEME_STORAGE_KEY = "ew.theme.preference"

test.describe("Forecast Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/forecast")
  })

  test("should render controls and chart", async ({ page }) => {
    await page.waitForLoadState("networkidle")
    await expect(page.getByRole("button", { name: "3 months" })).toBeVisible()
    await expect(page.getByRole("button", { name: "6 months" })).toBeVisible()
    await expect(page.getByRole("button", { name: "12 months" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Recurring only" })).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Recurring + estimates" })
    ).toBeVisible()
    await expect(page.locator("canvas").first()).toBeVisible()
  })

  test("should update query when changing horizon and mode", async ({ page }) => {
    await page.getByRole("button", { name: "3 months" }).click()
    await expect(page).toHaveURL(/horizon=3/)
    await page.getByRole("button", { name: "Recurring only" }).click()
    await expect(page).toHaveURL(/mode=recurring/)
  })

  test("should navigate to what-if page", async ({ page }) => {
    await page.getByRole("button", { name: "12 months" }).click()
    await page.getByRole("button", { name: "Recurring only" }).click()
    await page.getByRole("link", { name: "What if?" }).click()
    await expect(page).toHaveURL(/\/scenarios\?horizon=12&mode=recurring/)
  })

  test("shows monthly drill-down details and negative-balance warning", async ({
    page,
  }) => {
    await page.route("**/api/forecast?*", async (route) => {
      const url = new URL(route.request().url())
      const mode = url.searchParams.get("mode") === "recurring" ? "recurring" : "full"
      const response = {
        horizon: 6,
        mode,
        start_balance_cents: 300000,
        months: [
          {
            month: "2027-01",
            projected_income_cents: 120000,
            projected_expenses_cents: 210000,
            projected_net_cents: -90000,
            end_balance_cents: -15000,
            crosses_negative: true,
            breakdown: {
              recurring_rules: [
                {
                  rule_id: 101,
                  name: "Rent",
                  type: "expense",
                  amount_cents: 95000,
                  occurrence_date: "2027-01-03",
                  category_id: 1,
                  category_name: "Housing",
                },
              ],
              variable_estimates: [
                {
                  category_id: 9,
                  name: "Groceries",
                  icon: null,
                  amount_cents: 24000,
                },
              ],
              one_time_events: [
                {
                  name: "Tax refund",
                  type: "income",
                  amount_cents: 18000,
                },
              ],
            },
          },
        ],
        summary: {
          projected_balance_cents: -15000,
          average_monthly_net_cents: -90000,
          months_until_negative: 1,
        },
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(response),
      })
    })

    await page.goto("/forecast")
    await expect(page.getByText("Balance goes negative")).toBeVisible()
    await page.getByRole("button", { name: /Jan 2027/i }).click()
    await expect(page.getByText("Recurring postings")).toBeVisible()
    await expect(page.getByText("Rent · Housing")).toBeVisible()
    await expect(page.getByText("Variable estimates")).toBeVisible()
    await expect(page.getByText("One-time events")).toBeVisible()
  })

  test("preserves explicit light mode and route state when navigating to scenarios and back", async ({
    page,
  }) => {
    await page.addInitScript(
      ([storageKey, value]) => {
        window.localStorage.setItem(storageKey, value)
      },
      [THEME_STORAGE_KEY, "light"] as const
    )
    await page.goto("/forecast")
    await page.getByRole("button", { name: "12 months" }).click()
    await page.getByRole("button", { name: "Recurring only" }).click()

    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("light")

    await page.getByRole("link", { name: "What if?" }).click()
    await expect(page).toHaveURL(/\/scenarios\?/)
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("light")

    await page.goBack()
    await expect(page).toHaveURL(/\/forecast\?horizon=12&mode=recurring/)
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("light")
  })

})
