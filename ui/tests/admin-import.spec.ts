import { expect, test, type Page } from "./fixtures"
import { ensureElevatedAdmin } from "./auth-helpers"

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

})
