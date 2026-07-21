import { expect, test } from "./fixtures"
import { ensureElevatedAdmin } from "./auth-helpers"

test.describe("Settings and administration (mobile)", () => {
  test("uses appearance and export controls from Settings", async ({ page }) => {
    await page.goto("/settings")
    await expect(page.getByTestId("settings-page")).toBeVisible()
    const theme = page.getByTestId("settings-theme-control")
    await theme.getByRole("button", { name: "Dark" }).click()
    await expect(theme.getByRole("button", { name: "Dark" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
    await expect(
      page.getByRole("link", { name: "Download portable archive" })
    ).toHaveAttribute("href", "/api/export/portable.zip")
  })

  test("shows elevated maintenance and SQLite import controls", async ({ page }) => {
    await ensureElevatedAdmin(page)
    await expect(page.getByText("Database backups")).toBeVisible()
    await expect(page.getByText("System information")).toBeVisible()

    await page.getByRole("link", { name: "Open importer" }).click()
    await expect(page).toHaveURL("/admin/import")
    await expect(page.getByLabel("SQLite database file")).toBeAttached()
    await expect(page.getByText("Upload a .db file")).toBeVisible()
    await expect(page.getByRole("button", { name: "Preview SQLite" })).toBeVisible()

    const width = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }))
    expect(width.scroll).toBeLessThanOrEqual(width.client)
  })
})
