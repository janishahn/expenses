import { expect, test } from "./fixtures"
import { ensureElevatedAdmin } from "./auth-helpers"
import { getCsrfToken } from "./helpers"
import { legacySqliteUpload, readPortableExport } from "./import-export-files"

test.describe("Settings and administration (mobile)", () => {
  test("persists appearance, imports CSV, and exports the exact saved transaction", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const suffix = Date.now()
    const category = `Mobile CSV category ${suffix}`
    const created = await request.post("/api/categories", {
      headers: { "X-CSRF-Token": token },
      data: { name: category, type: "expense", order: 0 },
    })
    expect(created.ok()).toBeTruthy()
    const title = `Mobile CSV transaction ${suffix}`
    await page.goto("/settings")
    const theme = page.getByTestId("settings-theme-control")
    await theme.getByRole("button", { name: "Dark" }).click()
    await page.reload()
    await expect(theme.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true")
    await page.getByLabel("CSV file").setInputFiles({
      name: "mobile-import.csv",
      mimeType: "text/csv",
      buffer: Buffer.from([
        "Date,Type,IsReimbursement,Amount,Category,Title",
        `2026-04-18,expense,0,19.99,${category},${title}`,
      ].join("\n")),
    })
    await page.getByRole("button", { name: "Preview CSV" }).click()
    await expect(page.getByText(title, { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Import CSV" }).click()
    await expect(page.getByText("Imported 1 transaction(s).", { exact: true })).toBeVisible()
    await page.goto(`/transactions?period=all&q=${encodeURIComponent(title)}`)
    await page.reload()
    const row = page.locator('[data-testid^="transaction-row-"]').filter({ hasText: title })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText("-19,99 €")
    await expect(row).toContainText(category)

    await page.goto("/settings")
    const exportPromise = page.waitForEvent("download")
    await page.getByRole("link", { name: "Download portable archive" }).click()
    const archive = await exportPromise
    expect(await archive.failure()).toBeNull()
    const exported = readPortableExport((await archive.path())!)
    expect(exported.format).toBe("expenses-portable-export")
    expect(exported.transactions).toContainEqual(expect.objectContaining({
      title, type: "expense", amount_cents: 1_999,
    }))
  })

  test("runs maintenance and imports a legacy database into the ledger", async ({ page }) => {
    await ensureElevatedAdmin(page)
    await expect(page.getByText("Database backups")).toBeVisible()
    await expect(page.getByText("System information")).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Post all overdue transactions" })
    ).toBeVisible()

    await page.getByRole("button", { name: "Rebuild now" }).click()
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Rebuild", exact: true })
      .click()
    await expect(
      page.getByRole("status").filter({ hasText: "Monthly rollups rebuilt successfully." })
    ).toBeVisible()

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

    const title = `Legacy mobile import ${Date.now()}`
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
    await row.click()
    await expect(page.getByRole("heading", { name: title })).toBeVisible()
    await expect(page.locator("main")).toContainText("03.01.2025 08:15")
  })
})
