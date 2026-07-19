import { expect, test } from "./fixtures"
import { createTransaction, ensureCategory, getCsrfToken } from "./helpers"

function nextMonthValue(): string {
  const nextMonth = new Date()
  nextMonth.setMonth(nextMonth.getMonth() + 1, 1)
  return `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}`
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
    const categoryId = await ensureCategory(
      request,
      token,
      "expense",
      "E2E Forecast"
    )
    for (const [index, amount] of [12000, 18000, 15000].entries()) {
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
    await expect(page.getByText(/80% prediction range/)).toBeVisible()
    await page.getByRole("button", { name: "12 months" }).click()
    await page.getByRole("button", { name: "Recurring only" }).click()
    await expect(page).toHaveURL(/horizon=12/)
    await expect(page).toHaveURL(/mode=recurring/)

    await page.getByRole("link", { name: "What if?" }).click()
    await expect(page).toHaveURL(/\/scenarios\?horizon=12&mode=recurring/)
    await expect(page.getByRole("heading", { name: "What If" })).toBeVisible()
  })

  test("adds and removes a one-time scenario adjustment", async ({ page }) => {
    await page.goto("/scenarios")
    await page.getByLabel("Adjustment type").selectOption("one_time")
    await page.getByLabel("Name").fill("Mobile vacation")
    await page
      .getByRole("textbox", { name: "Month", exact: true })
      .fill(nextMonthValue())
    await page.getByLabel("Amount").fill("300.00")
    await page.getByRole("button", { name: "Add adjustment" }).click()

    await expect(page.getByText("Mobile vacation")).toBeVisible()
    await expect(page.locator("canvas").first()).toBeVisible()
    await page.getByLabel("Delete adjustment").click()
    await expect(
      page.getByText("No adjustments yet. Add one to simulate impact.")
    ).toBeVisible()
  })
})
