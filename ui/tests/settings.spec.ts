import { expect, test, type APIRequestContext, type Page } from "./fixtures"
import { ORDINARY_USER, ensureOrdinaryUser, loginWith } from "./auth-helpers"
import { getCsrfToken } from "./helpers"

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
    // The clipboard is stubbed, so both outcomes are deterministic.
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: () => Promise.resolve() },
      })
    })
    await page.getByRole("button", { name: "Copy token" }).click()
    await expect(page.getByRole("status").filter({ hasText: "Token copied." })).toBeVisible()
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error("denied")) },
      })
    })
    await page.getByRole("button", { name: "Copy token" }).click()
    await expect(page.getByRole("status").filter({ hasText: "Could not copy the token. Copy it from the field." })).toBeVisible()
    await expect(issued).toBeFocused()
    await expect(issued).toHaveValue(first)
    expect(await issued.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([
      0,
      first.length,
    ])

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
})
