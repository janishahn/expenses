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

  test("renders assistant usage stats and switches the reporting period", async ({
    page,
  }) => {
    const requestedPeriods: string[] = []
    await page.route("**/api/ai/usage/summary?*", async (route) => {
      const period =
        new URL(route.request().url()).searchParams.get("period") ?? "week"
      requestedPeriods.push(period)
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          feature: "spending_chat",
          period,
          started_at: period === "all" ? null : "2026-06-21T00:00:00",
          total_chats: period === "all" ? 42 : 7,
          completed_chats: period === "all" ? 40 : 6,
          failed_chats: 1,
          cancelled_chats: 0,
          costed_chats: 5,
          input_tokens: 1000,
          output_tokens: 500,
          total_tokens: 1500,
          cached_input_tokens: 200,
          cache_write_tokens: 0,
          reasoning_tokens: 50,
          total_cost_decimal: "0.0123",
          average_cost_decimal: "0.0025",
          cost_unit: "usd",
          average_total_tokens: 214,
          p95_duration_ms: 4200,
        }),
      })
    })

    await page.reload()

    const usage = page.getByTestId("admin-ai-usage")
    await expect(
      usage.getByRole("heading", { name: "Assistant usage" })
    ).toBeVisible()
    await expect(usage.getByText("$0.0123")).toBeVisible()
    await expect(usage.getByText("Ø $0.0025 per chat")).toBeVisible()
    await expect(usage.getByText(/^Since /)).toBeVisible()

    await expect.poll(() => requestedPeriods.includes("week")).toBeTruthy()

    await usage.getByRole("button", { name: "All time" }).click()

    await expect.poll(() => requestedPeriods.includes("all")).toBeTruthy()
    await expect(usage.getByText("42")).toBeVisible()
    await expect(usage.getByText(/^Since /)).toHaveCount(0)
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
