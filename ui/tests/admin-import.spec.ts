import { expect, test, type Page } from "./fixtures"
import { ensureElevatedAdmin } from "./auth-helpers"
import { legacySqliteUpload } from "./import-export-files"

async function openImportPage(page: Page): Promise<void> {
  await ensureElevatedAdmin(page)
  await page.goto("/admin/import")
  await expect(page).toHaveURL("/admin/import")
  await expect(page.locator("main h1")).toContainText("SQLite Import")
}

test.describe("Admin Import Page", () => {
  test("shows sqlite-only import controls after admin elevation", async ({ page }) => {
    await openImportPage(page)

    await expect(page.getByRole("heading", { name: "Legacy SQLite" })).toBeVisible()
    await expect(page.getByText("CSV import is available in Settings.")).toBeVisible()
    await expect(page.getByRole("button", { name: "Preview SQLite" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Import legacy DB" })).toHaveCount(0)
    await expect(page.getByLabel("SQLite database file")).toHaveCount(1)

    await expect(page.getByLabel("CSV file")).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Preview CSV" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Import CSV" })).toHaveCount(0)
  })

  test("shows validation error for non-db sqlite upload", async ({ page }) => {
    await openImportPage(page)

    await page.getByLabel("SQLite database file").setInputFiles({
      name: "legacy.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not-a-db"),
    })
    await page.getByRole("button", { name: "Preview SQLite" }).click()
    await expect(page.locator("body")).toContainText("Please upload a .db file")
  })

  test("imports a legacy database and preserves its exact amount in the ledger", async ({ page }) => {
    await openImportPage(page)
    const title = `Legacy desktop import ${Date.now()}`
    await page.getByLabel("SQLite database file").setInputFiles({
      name: "legacy.db",
      mimeType: "application/octet-stream",
      buffer: legacySqliteUpload(title),
    })
    await page.getByRole("button", { name: "Preview SQLite" }).click()
    await expect(page.getByText("Category mapping", { exact: true })).toBeVisible()
    await page.getByRole("combobox").selectOption("create")
    await page.getByRole("button", { name: "Import legacy DB" }).click()
    await expect(page.getByText(/inserted transactions: 1/)).toBeVisible()

    await page.goto(`/transactions?period=all&q=${encodeURIComponent(title)}`)
    await page.reload()
    const row = page.locator('[data-testid^="transaction-row-"]').filter({ hasText: title })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText("-42,51 €")
    await expect(row).toContainText("Legacy Food")
    await row.click()
    await expect(page.getByRole("heading", { name: title })).toBeVisible()
    await expect(page.locator("main")).toContainText("03.01.2025 08:15")
  })

})
