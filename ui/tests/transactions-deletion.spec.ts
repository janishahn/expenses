import type { APIRequestContext } from "@playwright/test"
import { expect, test } from "./fixtures"
import { createTransaction, ensureCategory, getCsrfToken } from "./helpers"

async function seedExpense(request: APIRequestContext, label: string) {
  const token = await getCsrfToken(request)
  const categoryId = await ensureCategory(request, token, "expense", `E2E ${label}`)
  const title = `E2E ${label} ${Date.now()}`
  const id = await createTransaction(request, token, {
    date: "2026-04-18",
    occurred_at: "2026-04-18T13:10:00",
    type: "expense",
    amount_cents: 6789,
    category_id: categoryId,
    title,
    tags: ["delete-flow"],
  })
  return { title, id }
}

test.describe("Transaction deletion flows", () => {

  test("restores a deleted transaction with the toast Undo", async ({ page, request }) => {
    const { title, id } = await seedExpense(request, "Undo Delete")
    await page.goto(`/transactions?q=${encodeURIComponent(title)}`)
    await page.getByRole("listitem", { name: title }).click()
    await page.getByRole("complementary", { name: title }).getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Delete" }).click()
    await page.getByRole("dialog", { name: "Delete this transaction?" }).getByRole("button", { name: "Delete" }).click()
    await expect(page.getByRole("listitem", { name: title })).toHaveCount(0)

    await page.getByRole("status").getByRole("button", { name: "Undo" }).click()
    await expect(page.getByRole("listitem", { name: title })).toBeVisible()
    expect((await request.get(`/api/transactions/${id}`)).ok()).toBeTruthy()
  })

})
