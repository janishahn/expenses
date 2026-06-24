import { expect, test } from "@playwright/test"
import {
  ORDINARY_USER,
  ensureOrdinaryUser,
  loginWith,
} from "./auth-helpers"
import { getCsrfToken } from "./helpers"

test.use({ storageState: { cookies: [], origins: [] } })

test.describe.serial("Settings and ordinary-user import flows", () => {
  test("settings deep-link is guarded before protected content renders", async ({ page }) => {
    await page.goto("/settings")
    await expect(page).toHaveURL(/\/(setup|login)\?redirect=/)
    await expect(page.getByTestId("settings-page")).toHaveCount(0)
    if (page.url().includes("/setup")) {
      await expect(page.getByTestId("setup-form")).toBeVisible()
    } else {
      await expect(page.getByTestId("login-form")).toBeVisible()
    }
  })

  test("ordinary users can use settings, balance anchors, theme, and CSV import", async ({
    page,
    request,
  }) => {
    await ensureOrdinaryUser(request)

    await page.goto("/settings")
    await expect(page).toHaveURL(/\/login\?redirect=/)

    await loginWith(page, ORDINARY_USER)
    await expect(page).toHaveURL(/\/settings(?:\?|$)/)
    await expect(page.getByTestId("settings-page")).toBeVisible()
    await expect(page.getByTestId("auth-username")).toContainText(ORDINARY_USER.username)
    await expect(page.getByTestId("auth-logout")).toBeVisible()

    await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0)
    await expect(page.getByText("Database Backups")).toHaveCount(0)
    await expect(page.getByText("Pi Health")).toHaveCount(0)
    await expect(page.getByRole("link", { name: "Download portable archive" })).toHaveAttribute(
      "href",
      "/api/export/portable.zip"
    )

    const themeControl = page.getByTestId("settings-theme-control")
    await expect(themeControl).toBeVisible()
    await themeControl.getByRole("button", { name: "Dark" }).click()
    await page.reload()
    await expect(page.getByTestId("settings-theme-control")).toBeVisible()
    await expect(
      page.getByTestId("settings-theme-control").getByRole("button", { name: "Dark" })
    ).toHaveAttribute("aria-pressed", "true")

    const uniqueTag = `${Date.now()}`
    await page.getByLabel("As of").fill("2026-03-01T09:00")
    await page.getByLabel("Balance").fill("123.45")
    await page.getByLabel("Note (optional)").fill(`Settings snapshot ${uniqueTag}`)
    await page.getByRole("button", { name: "Save snapshot" }).click()
    await expect(page.getByText(`Settings snapshot ${uniqueTag}`)).toBeVisible()

    const row = page.locator("tr", { hasText: `Settings snapshot ${uniqueTag}` }).first()
    await row.getByRole("button", { name: "Edit" }).click()
    await page.getByLabel("Note (optional)").fill(`Updated snapshot ${uniqueTag}`)
    await page.getByRole("button", { name: "Update snapshot" }).click()
    await expect(page.getByText(`Updated snapshot ${uniqueTag}`)).toBeVisible()

    page.once("dialog", (dialog) => void dialog.accept())
    await page
      .locator("tr", { hasText: `Updated snapshot ${uniqueTag}` })
      .first()
      .getByRole("button", { name: "Delete" })
      .click()
    await expect(page.getByText(`Updated snapshot ${uniqueTag}`)).toHaveCount(0)

    const csrfToken = await getCsrfToken(page.request)
    const csvCategory = `Settings Import ${Date.now()}`
    const createCategoryResponse = await page.request.post("/api/categories", {
      headers: { "X-CSRF-Token": csrfToken },
      data: {
        name: csvCategory,
        type: "expense",
        order: 0,
      },
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
    await page.getByRole("button", { name: "Preview CSV" }).click()
    await expect(page.locator("body")).toContainText(csvTitle)

    await page.getByRole("button", { name: "Import CSV" }).click()
    await expect(page.locator("body")).toContainText(/Imported \d+ transaction\(s\)\./)

    await page.goto("/admin/import")
    await expect(page).not.toHaveURL(/\/admin/)
    await expect(page.locator("main h1")).not.toContainText("SQLite Import")
  })
})
