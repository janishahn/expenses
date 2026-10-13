import type { APIRequestContext } from "@playwright/test"
import { expect, test } from "./fixtures"
import { createTransaction, ensureCategory, getCsrfToken } from "./helpers"

async function createDeleted(
  request: APIRequestContext,
  token: string,
  title: string,
  amountCents: number
): Promise<number> {
  const categoryId = await ensureCategory(request, token, "expense", "E2E Expense")
  const id = await createTransaction(request, token, {
    date: new Date().toISOString().slice(0, 10),
    occurred_at: new Date().toISOString(),
    type: "expense",
    amount_cents: amountCents,
    category_id: categoryId,
    title,
    tags: [],
  })
  const response = await request.delete(`/api/transactions/${id}`, {
    headers: { "X-CSRF-Token": token },
  })
  expect(response.ok()).toBeTruthy()
  return id
}

async function deletedIds(request: APIRequestContext): Promise<number[]> {
  const response = await request.get("/api/transactions/deleted?page=1&limit=50")
  const body = (await response.json()) as { transactions: Array<{ id: number }> }
  return body.transactions.map((row) => row.id)
}

test.describe("Trash page", () => {
  test("links back to Transactions from the breadcrumb", async ({ page }) => {
    await page.goto("/transactions/deleted")
    await expect(page.getByRole("heading", { name: "Trash", level: 1 })).toBeVisible()
    await page.getByRole("link", { name: "Transactions", exact: true }).first().click()
    await expect(page).toHaveURL(/\/transactions$/)
  })

  test("restores selected deleted transactions", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const stamp = Date.now()
    const titles = [`E2E Restore ${stamp} one`, `E2E Restore ${stamp} two`]
    const ids = [
      await createDeleted(request, token, titles[0], 999),
      await createDeleted(request, token, titles[1], 1999),
    ]
    const keptTitle = `E2E Trash kept ${stamp}`
    const keptId = await createDeleted(request, token, keptTitle, 500)

    await page.goto("/transactions/deleted")
    const list = page.getByRole("list", { name: "Deleted transactions" })
    await expect(list.getByRole("listitem", { name: keptTitle })).toContainText("Deleted")
    await list.getByRole("listitem", { name: titles[0] }).click()
    await list.getByRole("checkbox", { name: `Select ${titles[1]}` }).check()
    const bar = page.getByRole("toolbar", { name: "Selected rows" })
    await expect(bar).toContainText("2 selected")
    await bar.getByRole("button", { name: "Restore" }).click()

    await expect(page.getByRole("status")).toContainText("Restored 2 transactions")
    await expect(list.getByRole("listitem", { name: titles[0] })).toHaveCount(0)
    await expect(list.getByRole("listitem", { name: titles[1] })).toHaveCount(0)
    await expect(list.getByRole("listitem", { name: keptTitle })).toBeVisible()
    await expect(bar).toBeHidden()
    for (const id of ids) {
      expect((await request.get(`/api/transactions/${id}`)).ok()).toBeTruthy()
    }
    expect((await request.get(`/api/transactions/${keptId}`)).status()).toBe(404)

    await page.goto(`/transactions?q=${encodeURIComponent(`E2E Restore ${stamp}`)}`)
    await expect(page.getByRole("listitem", { name: titles[0] })).toBeVisible()
  })

  test("deletes selected transactions forever after confirming", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const stamp = Date.now()
    const title = `E2E Delete Forever ${stamp}`
    const id = await createDeleted(request, token, title, 1234)
    const keptTitle = `E2E Delete Forever kept ${stamp}`
    const keptId = await createDeleted(request, token, keptTitle, 500)

    await page.goto("/transactions/deleted")
    const list = page.getByRole("list", { name: "Deleted transactions" })
    await list.getByRole("listitem", { name: title }).click()
    const bar = page.getByRole("toolbar", { name: "Selected rows" })
    await expect(bar).toContainText("1 selected")

    await bar.getByRole("button", { name: "Delete forever" }).click()
    const dialog = page.getByRole("dialog", { name: "Delete 1 transaction forever?" })
    await expect(dialog).toContainText("This cannot be undone.")
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(dialog).toBeHidden()
    await expect(list.getByRole("listitem", { name: title })).toBeVisible()
    expect(await deletedIds(request)).toContain(id)

    await bar.getByRole("button", { name: "Delete forever" }).click()
    await dialog.getByRole("button", { name: "Delete forever" }).click()
    await expect(page.getByRole("status")).toContainText("Deleted 1 transaction forever")
    await expect(list.getByRole("listitem", { name: title })).toHaveCount(0)
    await expect(list.getByRole("listitem", { name: keptTitle })).toBeVisible()

    const remaining = await deletedIds(request)
    expect(remaining).not.toContain(id)
    expect(remaining).toContain(keptId)
  })
})
