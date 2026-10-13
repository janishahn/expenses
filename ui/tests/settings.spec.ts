import { expect, test, type APIRequestContext, type Page } from "./fixtures"
import {
  ORDINARY_USER,
  ensureBootstrap,
  ensureOrdinaryUser,
  loginWith,
} from "./auth-helpers"
import { getCsrfToken, loginAsIsolatedUser } from "./helpers"

test.use({ storageState: { cookies: [], origins: [] } })

async function signInOrdinaryUser(
  page: Page,
  request: APIRequestContext,
  path: string
): Promise<void> {
  await ensureOrdinaryUser(request)
  await page.goto(path)
  await expect(page).toHaveURL(/\/login\?redirect=/)
  await loginWith(page, ORDINARY_USER)
  await expect(page).toHaveURL(path)
}

test.describe.serial("Settings and ordinary-user flows", () => {
  test("enables local categorization, trains, and saves a validated threshold after a failed save", async ({
    page,
    request,
  }) => {
    await ensureBootstrap(request)
    await page.goto("/settings")
    const { request: api, csrfToken } = await loginAsIsolatedUser(page)
    const headers = { "X-CSRF-Token": csrfToken }
    try {
      const categories: number[] = []
      for (const name of ["Bakery", "Transit"]) {
        const response = await api.post("/api/categories", {
          headers,
          data: { name, type: "expense", order: 0 },
        })
        expect(response.ok()).toBeTruthy()
        categories.push((await response.json()).id)
      }
      for (let i = 0; i < 90; i++) {
        const response = await api.post("/api/transactions", {
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

      await page.goto("/settings/categorization")
      const toggle = page.getByRole("switch", { name: "Categorize new expenses" })
      const threshold = page.getByLabel("Minimum confidence")
      const trainingStatus = page.getByRole("status").filter({ hasText: /Active|Training|Waiting/ })
      await expect(toggle).not.toBeChecked()
      await expect(threshold).toHaveValue("80")
      await expect(trainingStatus).toHaveCount(0)

      await toggle.click()
      await expect(toggle).toBeChecked()
      await expect(trainingStatus).toContainText("Active", { timeout: 30_000 })

      const response = await api.post("/api/transactions", {
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
      const detail = await api.get(`/api/transactions/${(await response.json()).id}`)
      expect((await detail.json()).category_id).toBe(categories[0])

      await threshold.fill("101")
      await threshold.press("Enter")
      await expect(page.getByRole("alert")).toHaveText("Enter a whole number from 0 to 100.")
      await threshold.press("Escape")
      await expect(threshold).toHaveValue("80")
      await expect(page.getByRole("alert")).toHaveCount(0)

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
        .poll(async () => (await (await api.get("/api/settings")).json()).auto_categorization.threshold)
        .toBe(0.9)

      await page.reload()
      await expect(toggle).toBeChecked()
      await expect(threshold).toHaveValue("90")

      await toggle.click()
      await expect(toggle).not.toBeChecked()
      await expect(trainingStatus).toHaveCount(0)
      await page.reload()
      await expect(toggle).not.toBeChecked()
      await expect(threshold).toHaveValue("90")
    } finally {
      await api.dispose()
    }
  })

  test("settings deep-link is guarded before protected content renders", async ({
    page,
    request,
  }) => {
    await ensureBootstrap(request)
    await page.goto("/settings")
    await expect(page).toHaveURL(/\/login\?redirect=/)
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible()
    await expect(page.getByRole("navigation", { name: "Settings sections" })).toHaveCount(0)
  })

  test("ordinary users see their account without server sections and sign out", async ({
    page,
    request,
  }) => {
    await signInOrdinaryUser(page, request, "/settings")

    await expect(page.locator("main h1")).toHaveText("Account")
    const sections = page.getByRole("navigation", { name: "Settings sections" })
    await expect(sections.getByRole("link", { name: "Account" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    await expect(sections.getByRole("link", { name: "Health" })).toHaveCount(0)
    await expect(sections.getByRole("link", { name: "Maintenance" })).toHaveCount(0)

    await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible()
    await expect(page.locator("main").getByText(ORDINARY_USER.username, { exact: true })).toBeVisible()

    await page.getByRole("link", { name: "Back to app" }).click()
    await expect(page).toHaveURL("/")

    await page.goto("/settings")
    await page.getByRole("button", { name: "Sign out" }).click()
    await expect(page).toHaveURL(/\/login(?:\?|$)/)
    await page.goto("/settings")
    await expect(page).toHaveURL(/\/login\?redirect=/)
  })

  test("creates, rotates, and revokes the ingest token", async ({ page, request }) => {
    await signInOrdinaryUser(page, request, "/settings")

    const label = page.getByText(/^(No token|Token ending in )/)
    const issued = page.getByLabel("New ingest token")
    await expect(label).toContainText("No token")
    await expect(page.getByRole("button", { name: "Revoke", exact: true })).toHaveCount(0)

    await page.getByRole("button", { name: "Create", exact: true }).click()
    await expect(page.getByRole("status").filter({ hasText: "Ingest token created." })).toBeVisible()
    await expect(issued).toBeVisible()
    const first = await issued.inputValue()
    expect(first.length).toBeGreaterThan(6)
    await expect(label).toContainText(`Token ending in ${first.slice(-6)}`)
    await expect(page.getByText("not used yet")).toBeVisible()
    await expect(page.getByRole("button", { name: "Copy token" })).toBeVisible()

    await page.getByRole("button", { name: "Rotate", exact: true }).click()
    await expect(page.getByRole("status").filter({ hasText: "Ingest token rotated." })).toBeVisible()
    await expect(issued).not.toHaveValue(first)
    const second = await issued.inputValue()
    await expect(label).toContainText(`Token ending in ${second.slice(-6)}`)

    await page.reload()
    await expect(label).toContainText(`Token ending in ${second.slice(-6)}`)
    await expect(issued).toHaveCount(0)

    await page.getByRole("button", { name: "Revoke", exact: true }).click()
    const confirm = page.getByRole("dialog", { name: "Revoke the ingest token?" })
    await confirm.getByRole("button", { name: "Cancel" }).click()
    await expect(label).toContainText(`Token ending in ${second.slice(-6)}`)

    await page.getByRole("button", { name: "Revoke", exact: true }).click()
    await confirm.getByRole("button", { name: "Revoke" }).click()
    await expect(page.getByRole("status").filter({ hasText: "Ingest token revoked." })).toBeVisible()
    await expect(label).toContainText("No token")
  })

  test("persists the theme choice across reloads", async ({ page, request }) => {
    await signInOrdinaryUser(page, request, "/settings")

    await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Appearance" }).click()
    await expect(page).toHaveURL("/settings/appearance")
    await expect(page.locator("main h1")).toHaveText("Appearance")

    const theme = page.getByRole("radiogroup", { name: "Theme" })
    await theme.getByRole("radio", { name: "Dark" }).click()
    await expect(theme.getByRole("radio", { name: "Dark" })).toBeChecked()
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")

    await page.reload()
    await expect(theme.getByRole("radio", { name: "Dark" })).toBeChecked()
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")

    await theme.getByRole("radio", { name: "Light" }).click()
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
  })

  test("adds, edits, and deletes balance snapshots", async ({ page, request }) => {
    await signInOrdinaryUser(page, request, "/settings/snapshots")
    const unique = `${Date.now()}`
    const list = page.getByRole("list", { name: "Balance snapshots" })

    await page.getByRole("button", { name: "Add snapshot" }).click()
    const dialog = page.getByRole("dialog", { name: "Add snapshot" })
    await dialog.getByRole("button", { name: "Save" }).click()
    await expect(dialog.getByText("Select a date and time.")).toBeVisible()
    await expect(dialog.getByText("Enter a valid balance.")).toBeVisible()

    await dialog.getByLabel("As of").fill("2026-03-01T09:00")
    await dialog.getByLabel("Balance").fill("123.45")
    await dialog.getByLabel("Note").fill(`Settings snapshot ${unique}`)
    await dialog.getByRole("button", { name: "Save" }).click()
    await expect(dialog).toBeHidden()

    const row = list.getByRole("listitem", { name: "Snapshot 1 Mar 2026, 09:00" })
    await expect(row).toContainText(`Settings snapshot ${unique}`)
    await expect(row).toContainText("123,45 €")

    await row.click()
    const editDialog = page.getByRole("dialog", { name: "Edit snapshot" })
    await expect(editDialog.getByLabel("Balance")).toHaveValue("123.45")
    await editDialog.getByLabel("Balance").fill("200")
    await editDialog.getByLabel("Note").fill(`Updated snapshot ${unique}`)
    await editDialog.getByRole("button", { name: "Save" }).click()
    await expect(editDialog).toBeHidden()
    await expect(row).toContainText(`Updated snapshot ${unique}`)
    await expect(row).toContainText("200,00 €")

    await row.hover()
    await row.getByRole("button", { name: "Delete snapshot 1 Mar 2026, 09:00" }).click()
    await page
      .getByRole("dialog", { name: "Delete this balance snapshot?" })
      .getByRole("button", { name: "Delete" })
      .click()
    await expect(page.getByText(`Updated snapshot ${unique}`)).toHaveCount(0)
  })

  test("exports data and imports a CSV file", async ({ page, request }) => {
    await signInOrdinaryUser(page, request, "/settings")
    await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Import and export" }).click()
    await expect(page).toHaveURL("/settings/data")

    await expect(page.getByRole("link", { name: "Download transactions as CSV" })).toHaveAttribute(
      "href",
      "/api/export/csv"
    )
    await expect(page.getByRole("link", { name: "Download portable archive" })).toHaveAttribute(
      "href",
      "/api/export/portable.zip"
    )

    const csrfToken = await getCsrfToken(page.request)
    const csvCategory = `Settings Import ${Date.now()}`
    const createCategoryResponse = await page.request.post("/api/categories", {
      headers: { "X-CSRF-Token": csrfToken },
      data: { name: csvCategory, type: "expense", order: 0 },
    })
    expect(createCategoryResponse.ok()).toBeTruthy()

    const csvTitle = `Settings CSV ${Date.now()}`
    const csvContent = [
      "Date,Type,IsReimbursement,Amount,Category,Title",
      `${new Date().toISOString().slice(0, 10)},expense,0,10.00,${csvCategory},${csvTitle}`,
    ].join("\n")

    await page.getByLabel("CSV file").setInputFiles({
      name: "settings-import.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csvContent),
    })
    const preview = page.getByRole("list", { name: "Preview" })
    const previewRow = preview.getByRole("listitem", { name: csvTitle })
    await expect(previewRow).toContainText(csvCategory)
    await expect(previewRow).toContainText("10,00 €")

    await page.getByRole("button", { name: "Import 1 transaction" }).click()
    await expect(page.getByRole("status").filter({ hasText: "Imported 1 transaction." })).toBeVisible()
    await expect(preview).toHaveCount(0)

    const imported = await page.request.get(`/api/transactions?period=all&q=${encodeURIComponent(csvTitle)}`)
    expect(JSON.stringify(await imported.json())).toContain(csvTitle)
  })

  test("shows CSV rows that cannot be imported as alerts", async ({ page, request }) => {
    await signInOrdinaryUser(page, request, "/settings/data")

    await page.getByLabel("CSV file").setInputFiles({
      name: "broken.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        [
          "Date,Type,IsReimbursement,Amount,Category,Title",
          "not-a-date,expense,0,10.00,Anything,Broken row",
        ].join("\n")
      ),
    })
    await expect(page.getByRole("alert").first()).toBeVisible()
    await expect(page.getByRole("button", { name: /^Import \d+ transaction/ })).toHaveCount(0)
  })

  test("ordinary users cannot open the admin importer", async ({ page, request }) => {
    await signInOrdinaryUser(page, request, "/settings")
    await page.goto("/admin/import")
    await expect(page).not.toHaveURL(/\/admin/)
    await expect(page.getByLabel("SQLite database file")).toHaveCount(0)
  })
})
