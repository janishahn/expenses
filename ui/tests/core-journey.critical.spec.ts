import { expect, test } from "./fixtures"
import { ensureCategory, getCsrfToken } from "./helpers"

test.describe("Critical desktop journey", () => {
  test("creates a transaction and preserves its exact amount after reload", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(
      request,
      token,
      "expense",
      "Cross-browser expense"
    )
    const title = `Cross-browser desktop ${Date.now()}`

    await page.goto("/")
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible()
    await page.getByRole("link", { name: "Transactions", exact: true }).click()
    await expect(page).toHaveURL(/\/transactions(?:\?|$)/)

    await page.getByRole("button", { name: "Add transaction", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Add transaction" })
    await dialog.getByLabel("Amount").fill("12.34")
    await dialog.getByLabel("Category").selectOption(String(categoryId))
    await dialog.getByLabel("Title").fill(title)
    await dialog.getByRole("button", { name: "Add transaction" }).click()
    await expect(dialog).toBeHidden()

    await page.goto(`/transactions?q=${encodeURIComponent(title)}`)
    const transaction = page
      .locator('[data-testid^="transaction-row-"]')
      .filter({ hasText: title })
    await expect(transaction).toContainText("-12,34 €")
    await transaction.click()
    await expect(page).toHaveURL(/\/transactions\/\d+$/)
    await page.reload()
    await expect(page.getByRole("heading", { name: title })).toBeVisible()
    await expect(page.locator("main")).toContainText("-12,34 €")
  })
})
