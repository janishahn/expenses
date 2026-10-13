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
  test("deletes from the peek menu after cancelling once", async ({ page, request }) => {
    const { title, id } = await seedExpense(request, "Peek Delete")
    const listUrl = `/transactions?q=${encodeURIComponent(title)}`
    await page.goto(listUrl)
    await page.getByRole("listitem", { name: title }).click()
    const peek = page.getByRole("complementary", { name: title })

    await peek.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Delete" }).click()
    const prompt = page.getByRole("dialog", { name: "Delete this transaction?" })
    await prompt.getByRole("button", { name: "Cancel" }).click()
    await expect(prompt).toBeHidden()
    await expect(peek).toBeVisible()
    expect((await request.get(`/api/transactions/${id}`)).ok()).toBeTruthy()

    await peek.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Delete" }).click()
    const deleted = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/transactions/${id}`) &&
        response.request().method() === "DELETE" &&
        response.ok(),
    )
    await page.getByRole("dialog", { name: "Delete this transaction?" }).getByRole("button", { name: "Delete" }).click()
    await deleted

    await expect(page.getByRole("status")).toContainText("Moved to Trash")
    await expect(peek).toBeHidden()
    await expect(page.getByRole("listitem", { name: title })).toHaveCount(0)
    expect((await request.get(`/api/transactions/${id}`)).status()).toBe(404)
  })

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

  test("deleting from the full view returns to the list and Back skips the dead record", async ({
    page,
    request,
  }) => {
    const { title, id } = await seedExpense(request, "Full Delete")
    await page.goto("/transactions")
    await page.goto(`/transactions/${id}`)
    const main = page.getByRole("main")

    await main.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Delete" }).click()
    const prompt = page.getByRole("dialog", { name: "Delete this transaction?" })
    await prompt.getByRole("button", { name: "Cancel" }).click()
    await expect(prompt).toBeHidden()
    await expect(page).toHaveURL(new RegExp(`/transactions/${id}$`))

    await main.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Delete" }).click()
    await page.getByRole("dialog", { name: "Delete this transaction?" }).getByRole("button", { name: "Delete" }).click()
    await expect(page).toHaveURL("/transactions")
    await expect(page.getByRole("status")).toContainText("Moved to Trash")

    await page.goBack()
    await expect(page).not.toHaveURL(new RegExp(`/transactions/${id}$`))
    expect(title).toBeTruthy()
  })

  test("deleting from a full view opened from the peek returns to a list without the record", async ({
    page,
    request,
  }) => {
    const { title, id } = await seedExpense(request, "Peek Full Delete")
    const listUrl = `/transactions?q=${encodeURIComponent(title)}`
    await page.goto(listUrl)
    await page.getByRole("listitem", { name: title }).click()
    await page.getByRole("complementary", { name: title }).getByRole("button", { name: "Open full view" }).click()
    await expect(page).toHaveURL(new RegExp(`/transactions/${id}$`))
    await expect(page.getByRole("complementary", { name: title })).toHaveCount(0)

    await page.getByRole("main").getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Delete" }).click()
    await page.getByRole("dialog", { name: "Delete this transaction?" }).getByRole("button", { name: "Delete" }).click()

    await expect(page).toHaveURL(/\/transactions\?/)
    await expect(page).not.toHaveURL(/peek=/)
    await expect(page.getByRole("listitem", { name: title })).toHaveCount(0)
    await expect(page.getByText("Transaction not found.")).toHaveCount(0)

    await page.goBack()
    await expect(page).not.toHaveURL(new RegExp(`/transactions/${id}$`))
  })

  test("keeps the record and shows an error when the delete fails", async ({ page, request }) => {
    const { title, id } = await seedExpense(request, "Delete Failure")
    const failure = "Delete failed from test"
    await page.route(`**/api/transactions/${id}`, async (route, routed) => {
      if (routed.method() !== "DELETE") {
        await route.continue()
        return
      }
      await route.fulfill({ status: 500, json: { detail: failure } })
    })

    await page.goto(`/transactions?q=${encodeURIComponent(title)}`)
    await page.getByRole("listitem", { name: title }).click()
    const peek = page.getByRole("complementary", { name: title })
    await peek.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Delete" }).click()
    await page.getByRole("dialog", { name: "Delete this transaction?" }).getByRole("button", { name: "Delete" }).click()

    await expect(peek).toContainText(failure)
    await expect(peek).toBeVisible()
    await expect(page.getByRole("listitem", { name: title })).toBeVisible()

    await page.goto(`/transactions/${id}`)
    const main = page.getByRole("main")
    await main.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Delete" }).click()
    await page.getByRole("dialog", { name: "Delete this transaction?" }).getByRole("button", { name: "Delete" }).click()
    await expect(main).toContainText(failure)
    await expect(page).toHaveURL(new RegExp(`/transactions/${id}$`))
    await page.unroute(`**/api/transactions/${id}`)
    expect((await request.get(`/api/transactions/${id}`)).ok()).toBeTruthy()
  })

  test("shows recoverable not-found states for a missing full view and peek", async ({ page }) => {
    await page.goto("/transactions/999999999")
    await expect(page.getByRole("main")).toContainText("Transaction not found.")
    await page.getByRole("link", { name: "Back to transactions" }).click()
    await expect(page).toHaveURL("/transactions")

    await page.goto("/transactions?peek=999999999")
    const peek = page.getByRole("complementary", { name: "Transaction" })
    await expect(peek).toContainText("Transaction not found.")
    await peek.getByRole("button", { name: "Close" }).click()
    await expect(peek).toBeHidden()
    await expect(page).not.toHaveURL(/peek=/)
  })
})
