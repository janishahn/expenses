import { expect, test } from "@playwright/test"
import { ensureElevatedAdmin } from "./auth-helpers"
import { getCsrfToken } from "./helpers"

test.describe("Admin Page", () => {
  test.beforeEach(async ({ page }) => {
    await ensureElevatedAdmin(page)
  })

  test("shows elevated admin tools and omits personal settings controls", async ({ page }) => {
    await expect(page.locator("main h1")).toContainText("Admin")
    await expect(page.getByText("Database Backups")).toBeVisible()
    await expect(page.getByText("Export Transactions")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Import" })).toBeVisible()
    await expect(page.getByText("Danger Zone")).toBeVisible()
    await expect(page.getByText("Rebuild Rollups")).toBeVisible()
    await expect(page.getByText("Recurring Catch-Up")).toBeVisible()
    await expect(page.getByText("Pi Health")).toBeVisible()
    await expect(page.getByText("System information")).toBeVisible()

    await expect(page.getByText("Appearance")).toHaveCount(0)
    await expect(page.getByText("Balance Snapshots")).toHaveCount(0)
  })

  test("shows app version metadata and backup download link", async ({ page }) => {
    await page.waitForLoadState("networkidle")
    await expect(page.getByText("App version")).toBeVisible()

    const backupLink = page.locator('a[href="/api/admin/download-db"]')
    await expect(backupLink).toBeVisible()
    await expect(backupLink).toContainText("Download backup")
  })

  test("requests structured error logs for the Errors tab", async ({ page }) => {
    let logsRequestUrl: URL | null = null
    await page.route("**/api/admin/logs?*", async (route) => {
      logsRequestUrl = new URL(route.request().url())
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ entries: [], next_cursor: null }),
      })
    })

    await page.reload()

    await expect
      .poll(() => logsRequestUrl?.searchParams.get("error_only"))
      .toBe("true")
    expect(logsRequestUrl?.searchParams.get("q")).not.toBe("failed")
  })

  test("renders low storage warning from backend validation override", async ({ page }) => {
    const csrfToken = await getCsrfToken(page.request)
    const setOverrideResponse = await page.request.post(
      "/api/admin/system-health/validation-override",
      {
        headers: { "X-CSRF-Token": csrfToken },
        data: { profile: "critical" },
      }
    )
    expect(setOverrideResponse.ok()).toBeTruthy()

    try {
      await page.reload()
      await expect(page.getByText(/Storage is running low/i)).toBeVisible()
      await expect(
        page.getByRole("link", { name: /Purge deleted transactions/i })
      ).toBeVisible()
    } finally {
      await page.request.delete("/api/admin/system-health/validation-override", {
        headers: { "X-CSRF-Token": csrfToken },
      })
    }
  })

  test("navigates to sqlite importer and back", async ({ page }) => {
    await page.getByRole("link", { name: "Open importer" }).click()
    await expect(page).toHaveURL("/admin/import")
    await expect(page.locator("main h1")).toContainText("SQLite Import")
    await expect(page.getByRole("button", { name: "Preview CSV" })).toHaveCount(0)

    await page.getByRole("link", { name: "← Back to admin" }).click()
    await expect(page).toHaveURL("/admin")
    await expect(page.locator("main h1")).toContainText("Admin")
  })
})
