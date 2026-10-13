import { expect, test, type Page } from "./fixtures"
import { ensureElevatedAdmin } from "./auth-helpers"
import { getCsrfToken, loginAsIsolatedUser } from "./helpers"

async function expectNoHorizontalOverflow(page: Page) {
  const width = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(width.scroll).toBeLessThanOrEqual(width.client)
}

test.describe("Settings and administration (mobile)", () => {
  test("enables local categorization, trains, and saves a validated threshold after a failed save", async ({
    page,
  }) => {
    await page.goto("/settings")
    const { request, csrfToken } = await loginAsIsolatedUser(page)
    const headers = { "X-CSRF-Token": csrfToken }
    try {
      const categories: number[] = []
      for (const name of ["Bakery", "Transit"]) {
        const response = await request.post("/api/categories", {
          headers,
          data: { name, type: "expense", order: 0 },
        })
        expect(response.ok()).toBeTruthy()
        categories.push((await response.json()).id)
      }
      for (let i = 0; i < 90; i++) {
        const response = await request.post("/api/transactions", {
          headers,
          data: {
            date: "2026-01-01",
            occurred_at: "2026-01-01T12:00:00",
            type: "expense",
            amount_cents: 500,
            category_id: categories[i % 2],
            title: i % 2 === 0 ? "Corner bakery" : "City metro",
            tags: [],
          },
        })
        expect(response.ok()).toBeTruthy()
      }

      await page.goto("/settings")
      await page
        .getByRole("navigation", { name: "Settings sections" })
        .getByRole("link", { name: "Categorization" })
        .click()
      await expect(page).toHaveURL("/settings/categorization")
      const toggle = page.getByRole("switch", { name: "Categorize new expenses" })
      const threshold = page.getByLabel("Minimum confidence")
      const trainingStatus = page.getByRole("status").filter({ hasText: /Active|Training|Waiting/ })
      await expect(toggle).not.toBeChecked()
      await expect(threshold).toHaveValue("80")

      await toggle.click()
      await expect(toggle).toBeChecked()
      await expect(trainingStatus).toContainText("Active", { timeout: 30_000 })

      const response = await request.post("/api/transactions", {
        headers,
        data: {
          date: "2026-10-11",
          occurred_at: "2026-10-11T12:00:00",
          type: "expense",
          amount_cents: 500,
          title: "Corner bakery",
          tags: [],
        },
      })
      expect(response.ok()).toBeTruthy()
      const detail = await request.get(`/api/transactions/${(await response.json()).id}`)
      expect((await detail.json()).category_id).toBe(categories[0])

      await threshold.fill("101")
      await threshold.press("Enter")
      await expect(page.getByRole("alert")).toHaveText("Enter a whole number from 0 to 100.")

      await page.route(
        "**/api/settings/auto-categorization",
        (route) =>
          route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ detail: "Settings are temporarily unavailable." }),
          }),
        { times: 1 }
      )
      await threshold.fill("90")
      await threshold.press("Enter")
      await expect(page.getByRole("alert")).toHaveText("Settings are temporarily unavailable.")
      await expect(threshold).toHaveValue("90")
      await expect(toggle).toBeChecked()

      await threshold.press("Enter")
      await expect(page.getByRole("alert")).toHaveCount(0)
      await expect
        .poll(async () => (await (await request.get("/api/settings")).json()).auto_categorization.threshold)
        .toBe(0.9)

      await page.reload()
      await expect(toggle).toBeChecked()
      await expect(threshold).toHaveValue("90")

      await toggle.click()
      await expect(toggle).not.toBeChecked()
      await page.reload()
      await expect(toggle).not.toBeChecked()
      await expect(threshold).toHaveValue("90")
      await expectNoHorizontalOverflow(page)
    } finally {
      await request.dispose()
    }
  })

  test("manages the ingest token from the account section", async ({ page }) => {
    await page.goto("/settings")
    // Other specs give the shared user an ingest token, so this one starts from a user without one.
    const { request } = await loginAsIsolatedUser(page)
    await request.dispose()
    await page.goto("/settings")
    await expect(page.locator("main h1")).toHaveText("Settings")
    const sections = page.getByRole("navigation", { name: "Settings sections" })
    await expect(sections.getByRole("link", { name: "Account" })).toHaveAttribute("aria-current", "page")

    const label = page.getByText(/^(No token|Token ending in )/)
    const issued = page.getByLabel("New ingest token")
    await expect(label).toContainText("No token")
    await page.getByRole("button", { name: "Create", exact: true }).click()
    await expect(page.getByRole("status").filter({ hasText: "Ingest token created." })).toBeVisible()
    const token = await issued.inputValue()
    await expect(label).toContainText(`Token ending in ${token.slice(-6)}`)

    await page.getByRole("button", { name: "Revoke", exact: true }).click()
    await page.getByRole("dialog", { name: "Revoke the ingest token?" }).getByRole("button", { name: "Revoke" }).click()
    await expect(page.getByRole("status").filter({ hasText: "Ingest token revoked." })).toBeVisible()
    await expect(label).toContainText("No token")
    await expectNoHorizontalOverflow(page)
  })

  test("uses appearance and export controls from Settings", async ({ page }) => {
    await page.goto("/settings")
    const sections = page.getByRole("navigation", { name: "Settings sections" })
    await sections.getByRole("link", { name: "Appearance" }).click()
    await expect(page).toHaveURL("/settings/appearance")
    const theme = page.getByRole("radiogroup", { name: "Theme" })
    await theme.getByRole("radio", { name: "Dark" }).click()
    await expect(theme.getByRole("radio", { name: "Dark" })).toBeChecked()
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
    await page.reload()
    await expect(theme.getByRole("radio", { name: "Dark" })).toBeChecked()

    await sections.getByRole("link", { name: "Import and export" }).click()
    await expect(page).toHaveURL("/settings/data")
    await expect(page.getByRole("link", { name: "Download portable archive" })).toHaveAttribute(
      "href",
      "/api/export/portable.zip"
    )
    await expect(page.getByRole("link", { name: "Download transactions as CSV" })).toHaveAttribute(
      "href",
      "/api/export/csv"
    )
    await expectNoHorizontalOverflow(page)
  })

  test("adds, edits, and deletes balance snapshots", async ({ page }) => {
    await page.goto("/settings/snapshots")
    const unique = `${Date.now()}`
    const list = page.getByRole("list", { name: "Balance snapshots" })

    await page.getByRole("button", { name: "Add snapshot" }).click()
    const dialog = page.getByRole("dialog", { name: "Add snapshot" })
    await dialog.getByRole("button", { name: "Save" }).click()
    await expect(dialog.getByText("Select a date and time.")).toBeVisible()
    await expect(dialog.getByText("Enter a valid balance.")).toBeVisible()
    await dialog.getByLabel("As of").fill("2026-03-01T09:00")
    await dialog.getByLabel("Balance").fill("123.45")
    await dialog.getByLabel("Note").fill(`Mobile snapshot ${unique}`)
    await dialog.getByRole("button", { name: "Save" }).click()
    await expect(dialog).toBeHidden()

    const row = list.getByRole("listitem", { name: "Snapshot 1 Mar 2026, 09:00" })
    await expect(row).toContainText("123,45 €")
    await expectNoHorizontalOverflow(page)

    await row.click()
    const editDialog = page.getByRole("dialog", { name: "Edit snapshot" })
    await editDialog.getByLabel("Balance").fill("200")
    await editDialog.getByRole("button", { name: "Save" }).click()
    await expect(editDialog).toBeHidden()
    await expect(row).toContainText("200,00 €")

    await row.click()
    await editDialog.getByRole("button", { name: "Delete", exact: true }).click()
    await page
      .getByRole("dialog", { name: "Delete this balance snapshot?" })
      .getByRole("button", { name: "Delete" })
      .click()
    await expect(row).toHaveCount(0)
  })

  test("previews and imports a CSV file", async ({ page }) => {
    await page.goto("/settings/data")
    const csrfToken = await getCsrfToken(page.request)
    const csvCategory = `Mobile Import ${Date.now()}`
    const createCategoryResponse = await page.request.post("/api/categories", {
      headers: { "X-CSRF-Token": csrfToken },
      data: { name: csvCategory, type: "expense", order: 0 },
    })
    expect(createCategoryResponse.ok()).toBeTruthy()

    const csvTitle = `Mobile CSV ${Date.now()}`
    await page.getByLabel("CSV file").setInputFiles({
      name: "mobile-import.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        [
          "Date,Type,IsReimbursement,Amount,Category,Title",
          `${new Date().toISOString().slice(0, 10)},expense,0,12.50,${csvCategory},${csvTitle}`,
        ].join("\n")
      ),
    })
    const previewRow = page.getByRole("list", { name: "Preview" }).getByRole("listitem", { name: csvTitle })
    await expect(previewRow).toContainText("12,50 €")
    await expectNoHorizontalOverflow(page)

    await page.getByRole("button", { name: "Import 1 transaction" }).click()
    await expect(page.getByRole("status").filter({ hasText: "Imported 1 transaction." })).toBeVisible()
    const imported = await page.request.get(`/api/transactions?period=all&q=${encodeURIComponent(csvTitle)}`)
    expect(JSON.stringify(await imported.json())).toContain(csvTitle)
  })

  test("shows elevated maintenance and SQLite import controls", async ({ page }) => {
    await ensureElevatedAdmin(page)
    await expect(page.locator("main h1")).toHaveText("Admin")
    const sections = page.getByRole("navigation", { name: "Admin sections" })
    await expect(sections.getByRole("link", { name: "Health" })).toHaveAttribute("aria-current", "page")
    await expect(page.getByText("CPU temperature")).toBeVisible()

    await sections.getByRole("link", { name: "Maintenance" }).click()
    await expect(page).toHaveURL("/admin/maintenance")
    await expect(page.getByRole("link", { name: "Download database backup" })).toHaveAttribute(
      "href",
      "/api/admin/download-db"
    )
    await expect(page.getByRole("button", { name: "Run", exact: true })).toBeVisible()

    await page.getByRole("button", { name: "Rebuild", exact: true }).click()
    await page.getByRole("dialog", { name: "Rebuild monthly totals now?" }).getByRole("button", { name: "Rebuild" }).click()
    await expect(page.getByRole("status").filter({ hasText: "Monthly totals rebuilt." })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await page.getByRole("link", { name: "Open legacy SQLite import" }).click()
    await expect(page).toHaveURL("/admin/import")
    await expect(page.locator("main h1")).toHaveText("Legacy SQLite import")
    await expect(page.getByLabel("SQLite database file")).toBeAttached()
    await expect(page.getByText("Drop a .db file or choose one")).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  test("browses the Logs and System sections", async ({ page }) => {
    await ensureElevatedAdmin(page)
    const sections = page.getByRole("navigation", { name: "Admin sections" })

    await sections.getByRole("link", { name: "Logs" }).click()
    await expect(page).toHaveURL("/admin/logs")
    await page.getByRole("radiogroup", { name: "Log type" }).getByRole("radio", { name: "All" }).click()
    const entries = page.getByRole("list", { name: "Log entries" }).getByRole("listitem")
    await expect(entries.first()).toBeVisible()
    await page.getByLabel("Search logs").fill("no-such-log-event-xyz")
    await expect(page.getByText("No matching log entries.")).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await sections.getByRole("link", { name: "System" }).click()
    await expect(page).toHaveURL("/admin/system")
    await expect(page.getByRole("heading", { name: "System" })).toBeVisible()
    await expect(page.getByText("Version", { exact: true })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})
