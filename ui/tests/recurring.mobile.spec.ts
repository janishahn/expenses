import { expect, test } from "./fixtures"
import { ensureCategory, getCsrfToken } from "./helpers"

test.describe("Recurring Rules Page (mobile)", () => {
  test("uses the header Add action and keeps History compact", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(
      request,
      token,
      "expense",
      "E2E Mobile Recurring",
    )
    const ruleName = `E2E Mobile Recurring ${Date.now()}`
    const today = new Date().toISOString().slice(0, 10)
    const response = await request.post("/api/recurring", {
      headers: { "X-CSRF-Token": token },
      data: {
        name: ruleName,
        type: "expense",
        amount_cents: 4200,
        currency_code: "EUR",
        category_id: categoryId,
        anchor_date: today,
        interval_unit: "month",
        interval_count: 1,
        next_occurrence: today,
        end_date: null,
        auto_post: false,
        skip_weekends: false,
        month_day_policy: "snap_to_end",
      },
    })
    expect(response.ok()).toBeTruthy()

    await page.goto("/recurring")

    const addAction = page
      .getByTestId("app-shell-header")
      .getByTestId("app-shell-mobile-add-action")
    await expect(addAction).toHaveAccessibleName("Add rule")
    await expect(addAction).toHaveText("Add rule")
    await addAction.click()
    await expect(page.getByRole("dialog", { name: "Add rule" })).toBeVisible()
    await page.getByRole("button", { name: "Close rule editor" }).click()

    const row = page
      .getByTestId("recurring-commitment")
      .filter({ hasText: ruleName })
      .first()
    const history = row.getByRole("link", { name: "History" })
    await expect(history).toBeVisible()
    const historyWidth = await history.evaluate(
      (node) => node.getBoundingClientRect().width,
    )
    expect(historyWidth).toBeLessThan(120)

    await history.click()
    await expect(page).toHaveURL(/\/recurring\/\d+\/occurrences/)
    await expect(page.getByTestId("recurring-occurrence-summary")).toBeVisible()
    await page.getByRole("link", { name: "← Back to recurring" }).click()
    await expect(page).toHaveURL("/recurring")
  })

  test("creates a recurring rule from the mobile editor", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(
      request,
      token,
      "expense",
      "Mobile recurring create"
    )
    const name = `Mobile recurring create ${Date.now()}`

    await page.goto("/recurring")
    await page.getByRole("button", { name: "Add rule" }).click()
    const dialog = page.getByRole("dialog", { name: "Add rule" })
    await dialog.getByLabel("Name").fill(name)
    await dialog.locator('label:has-text("Amount") input').fill("19.99")
    await dialog.getByLabel("Category").selectOption(String(categoryId))
    await dialog.getByLabel("Start date").fill(new Date().toISOString().slice(0, 10))
    await dialog.getByRole("button", { name: "Add rule" }).click()

    await expect(
      page.getByTestId("recurring-commitment").filter({ hasText: name })
    ).toBeVisible()
  })
})
