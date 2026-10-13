import { expect, test } from "./fixtures"

test.describe("Critical mobile journey", () => {
  test("creates a transaction from the add sheet and opens it from the ledger", async ({
    page,
  }) => {
    const title = `Cross-browser mobile ${Date.now()}`

    await page.goto("/transactions")
    await expect(page.getByRole("heading", { name: "Transactions" })).toBeVisible()
    await page.getByRole("button", { name: "Add transaction", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Add transaction" })
    await dialog.getByLabel("Amount").fill("9,87")
    await dialog.getByLabel("Title").fill(title)
    await dialog.getByRole("button", { name: "Add transaction" }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole("status")).toContainText("Transaction added")

    await page.goto(`/transactions?q=${encodeURIComponent(title)}`)
    const transaction = page.getByRole("listitem", { name: title })
    await expect(transaction).toBeVisible()
    await expect(transaction).toContainText("9,87")
    await transaction.click()
    await expect(page).toHaveURL(/peek=\d+/)
    const peek = page.getByRole("complementary", { name: title })
    await expect(peek).toBeVisible()
    await expect(peek.getByRole("button", { name: "Edit Title" })).toHaveText(title)

    const width = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }))
    expect(width.scroll).toBeLessThanOrEqual(width.client)
  })
})
