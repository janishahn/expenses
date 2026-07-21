import { expect, test } from "./fixtures"
import { createTransaction, ensureCategory, getCsrfToken } from "./helpers"

test.describe("Digest Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/digest")
  })

  test("should navigate weeks", async ({ page }) => {
    await page.waitForLoadState("networkidle")
    const before = page.url()
    await page.getByRole("button", { name: "Previous week" }).click()
    await expect(page).not.toHaveURL(before)
  })

  test("should render all digest sections", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Digest")
    await createTransaction(request, token, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 4_200,
      category_id: categoryId,
      title: `Digest composition ${Date.now()}`,
      tags: [],
    })

    await page.goto("/digest")
    await page.waitForLoadState("networkidle")
    const main = page.locator("main")
    await expect(main.getByText("Total spent")).toBeVisible()
    await expect(main.getByText("vs. last week")).toBeVisible()
    await expect(main.getByText("vs. 4-week avg")).toBeVisible()
    await expect(main.getByText("Transactions", { exact: true })).toBeVisible()
    await expect(page.getByTestId("digest-weekly-composition")).toBeVisible()
    await expect(main.getByText("Top 5 categories this week")).toBeVisible()
    await expect(main.getByText("Budget status as of this week")).toBeVisible()
    await expect(main.getByText("Flagged this week")).toBeVisible()
    await expect(main.getByText("Auto-posted this week")).toBeVisible()
  })

  test("should preserve hierarchy and empty states for a sparse week", async ({
    page,
  }) => {
    await page.route("**/api/digest*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          week_start: "2026-02-02",
          week_end: "2026-02-08",
          headline: {
            total_spent_cents: 0,
            vs_last_week_cents: 0,
            vs_four_week_avg_cents: 0,
            transaction_count: 0,
          },
          top_categories: [],
          budget_pulse: [],
          unusual_transactions: [],
          recurring_postings: [],
        }),
      })
    })

    await page.goto("/digest?week_of=2026-02-02")
    const main = page.locator("main")
    await expect(main.getByText("Top 5 categories this week")).toBeVisible()
    await expect(main.getByText("No spending in this week.")).toBeVisible()
    await expect(main.getByText("No active budgets this month.")).toBeVisible()
    await expect(main.getByText("Nothing unusual this week.")).toBeVisible()
    await expect(main.getByText("No recurring postings this week.")).toBeVisible()
  })
})
