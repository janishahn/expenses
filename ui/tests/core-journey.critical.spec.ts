import { expect, test } from "./fixtures"
import { getCsrfToken } from "./helpers"

test.describe("Critical desktop journey", () => {
  test("loads the shell, navigates the ledger, and creates a transaction", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const stamp = Date.now()
    const categoryName = `Cross-browser expense ${stamp}`
    const categoryResponse = await request.post("/api/categories", {
      headers: { "X-CSRF-Token": token },
      data: { name: categoryName, type: "expense", order: 0 },
    })
    expect(categoryResponse.ok()).toBeTruthy()
    const title = `Cross-browser desktop ${stamp}`

    await page.goto("/")
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible()
    await page.getByRole("link", { name: "Transactions", exact: true }).click()
    await expect(page).toHaveURL(/\/transactions(?:\?|$)/)

    await page.getByRole("button", { name: "Add transaction", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Add transaction" })
    await dialog.getByLabel("Amount").fill("12.34")
    await dialog.getByLabel("Title").fill(title)
    await dialog.getByRole("button", { name: "Category", exact: true }).click()
    await page.getByRole("option", { name: categoryName }).click()
    await dialog.getByRole("button", { name: "Add transaction" }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole("status")).toContainText("Transaction added")

    await page.goto(`/transactions?q=${encodeURIComponent(title)}`)
    const row = page.getByRole("listitem", { name: title })
    await expect(row).toBeVisible()
    await row.click()
    await expect(page).toHaveURL(/[?&]peek=\d+/)
    const peek = page.getByRole("complementary", { name: title })
    await expect(peek).toBeVisible()
    await expect(peek.getByRole("button", { name: `Category ${categoryName}` })).toBeVisible()
    await expect(peek.getByRole("button", { name: "Edit Amount" })).toContainText("12,34")
  })
})
