import { expect, test } from "./fixtures"
import {
  createTransaction,
  ensureCategory,
  getCsrfToken,
} from "./helpers"

test.describe("Deleted Transactions Page", () => {
  test("should restore a deleted transaction", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Expense")
    const title = `E2E Restore ${Date.now()}`
    const transactionId = await createTransaction(request, token, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 999,
      category_id: categoryId,
      title,
      tags: [],
    })
    const deleteResponse = await request.delete(`/api/transactions/${transactionId}`, {
      headers: { "X-CSRF-Token": token },
    })
    expect(deleteResponse.ok()).toBeTruthy()

    await page.goto("/transactions/deleted")
    await expect(page.locator("main h1")).toContainText("Deleted Transactions")
    const row = page.getByTestId(`deleted-transaction-${transactionId}`)
    await expect(row).toBeVisible()
    const restored = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/transactions/${transactionId}/restore`) &&
        response.request().method() === "POST" &&
        response.status() === 200
    )
    await row.getByRole("button", { name: "Restore" }).click()
    await restored
    await expect(row).toHaveCount(0)
    await page.getByRole("link", { name: /back to transactions/i }).click()
    await expect(page).toHaveURL("/transactions")

    await page.goto(`/transactions?q=${encodeURIComponent(title)}`)
    await page.reload()
    const restoredRow = page.getByTestId(`transaction-row-${transactionId}`)
    await expect(restoredRow).toContainText(title)
    await expect(restoredRow).toContainText("-9,99 €")
  })

  test("should permanently delete a deleted transaction", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Expense")
    const title = `E2E Delete Forever ${Date.now()}`
    const transactionId = await createTransaction(request, token, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 1234,
      category_id: categoryId,
      title,
      tags: [],
    })
    const deleteResponse = await request.delete(`/api/transactions/${transactionId}`, {
      headers: { "X-CSRF-Token": token },
    })
    expect(deleteResponse.ok()).toBeTruthy()

    await page.goto("/transactions/deleted")
    const row = page.getByTestId(`deleted-transaction-${transactionId}`)
    await expect(row).toBeVisible()

    const permanentDeleteResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/transactions/${transactionId}/permanent`) &&
        response.request().method() === "DELETE" &&
        response.status() === 200
    )
    await row.getByRole("button", { name: "Delete forever" }).click()
    await page
      .getByRole("dialog", { name: "Permanently delete this transaction?" })
      .getByRole("button", { name: "Delete forever" })
      .click()
    await permanentDeleteResponse

    await expect(row).toHaveCount(0)
    await page.reload()
    await expect(row).toHaveCount(0)
    const detailResponse = await request.get(`/api/transactions/${transactionId}`)
    expect(detailResponse.status()).toBe(404)
  })

})
