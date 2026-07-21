import { expect, test } from "./fixtures"
import {
  createTransaction,
  ensureCategory,
  getCsrfToken,
} from "./helpers"

test.describe("Deleted Transactions Page", () => {
  test("should have back link to transactions", async ({ page }) => {
    await page.goto("/transactions/deleted")
    const backLink = page.getByRole("link", { name: /back to transactions/i })
    await expect(backLink).toBeVisible()
  })

  test("should show empty state or deleted list", async ({ page }) => {
    await page.goto("/transactions/deleted")
    await page.waitForLoadState("networkidle")
    await expect(page.locator("main")).toContainText(
      /Restore|No deleted transactions/
    )
  })

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
    const row = page.getByTestId(`deleted-transaction-${transactionId}`)
    await expect(row).toBeVisible()
    await row.getByRole("button", { name: "Restore" }).click()

    await page.goto(`/transactions?q=${encodeURIComponent(title)}`)
    await expect(page.locator("body")).toContainText(title)
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

    page.once("dialog", (dialog) => dialog.accept())
    const permanentDeleteResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/transactions/${transactionId}/permanent`) &&
        response.request().method() === "DELETE" &&
        response.status() === 200
    )
    await row.getByRole("button", { name: "Delete forever" }).click()
    await permanentDeleteResponse

    await expect(row).toHaveCount(0)
    const detailResponse = await request.get(`/api/transactions/${transactionId}`)
    expect(detailResponse.status()).toBe(404)
  })

})
