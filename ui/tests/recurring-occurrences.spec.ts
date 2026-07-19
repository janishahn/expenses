import { expect, test } from "./fixtures"
import { ensureCategory, getCsrfToken } from "./helpers"

test.describe("Recurring Occurrences Page", () => {
  test("should render recurring rule history page", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Recurrence")
    const ruleName = `E2E History ${Date.now()}`
    const today = new Date().toISOString().slice(0, 10)

    const response = await request.post("/api/recurring", {
      headers: { "X-CSRF-Token": token },
      data: {
        name: ruleName,
        type: "expense",
        currency_code: "EUR",
        amount_cents: 12345,
        category_id: categoryId,
        anchor_date: today,
        interval_unit: "month",
        interval_count: 1,
        next_occurrence: today,
        end_date: null,
        auto_post: true,
        skip_weekends: false,
        month_day_policy: "snap_to_end",
      },
    })
    expect(response.ok()).toBeTruthy()
    const payload = (await response.json()) as { id: number }

    await page.addInitScript(() => {
      window.localStorage.setItem("ew.theme.preference", "light")
    })
    await page.goto(`/recurring/${payload.id}/occurrences`)
    await expect(
      page.evaluate(() => document.documentElement.dataset.theme)
    ).resolves.toBe("light")
    await expect(page.locator("main h1")).toContainText(ruleName)
    await expect(page.locator("body")).toContainText("Posted transactions")
    await expect(page.getByTestId("recurring-occurrence-summary")).toBeVisible()
    await expect(page.getByTestId("recurring-occurrence-ledger")).toBeVisible()

    await page.getByRole("link", { name: "← Back to recurring" }).click()
    await expect(page).toHaveURL("/recurring")
    await expect(
      page.evaluate(() => document.documentElement.dataset.theme)
    ).resolves.toBe("light")
  })
})
