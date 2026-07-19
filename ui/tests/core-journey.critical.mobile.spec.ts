import { expect, test } from "./fixtures"
import { ensureCategory, getCsrfToken } from "./helpers"

test.describe("Critical mobile journey", () => {
  test("loads the mobile shell, creates a transaction, and opens it from the ledger", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(
      request,
      token,
      "expense",
      "Cross-browser mobile expense"
    )
    const title = `Cross-browser mobile ${Date.now()}`

    await page.goto("/")
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible()
    await page.getByRole("button", { name: "Add transaction", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Add transaction" })
    await dialog.getByLabel("Amount").fill("9.87")
    await dialog.getByLabel("Category").selectOption(String(categoryId))
    await dialog.getByLabel("Title").fill(title)
    await dialog.getByRole("button", { name: "Add transaction" }).click()
    await expect(dialog).toBeHidden()

    await page.goto(`/transactions?q=${encodeURIComponent(title)}`)
    const transaction = page
      .locator('[data-testid^="transaction-row-"]')
      .filter({ hasText: title })
    await expect(transaction).toBeVisible()
    await transaction.click()
    await expect(page).toHaveURL(/\/transactions\/\d+$/)
    await expect(page.getByRole("heading", { name: title })).toBeVisible()

    const width = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }))
    expect(width.scroll).toBeLessThanOrEqual(width.client)
  })
})
