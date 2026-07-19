import { expect, test } from "./fixtures"
import {
  ADMIN_USER,
  ORDINARY_USER,
  ensureBootstrap,
  ensureOrdinaryUser,
  loginWith,
} from "./auth-helpers"
import { createTransaction, ensureCategory, getCsrfToken } from "./helpers"

test.use({ storageState: { cookies: [], origins: [] } })

test.describe.serial("Admin navigation and elevation guards", () => {
  test("hides admin navigation for ordinary users and blocks admin deep-links", async ({
    page,
    request,
  }) => {
    await ensureOrdinaryUser(request)

    await page.goto("/admin")
    await expect(page).toHaveURL(/\/login\?redirect=/)

    await loginWith(page, ORDINARY_USER)
    await expect(page).toHaveURL(/\/(\?|$)/)

    await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0)

    await page.goto("/admin")
    await expect(page).not.toHaveURL(/\/admin/)
    await expect(page.locator("main h1")).not.toContainText("Admin")
  })

  test("requires elevation for admin deep links and returns to the requested page", async ({
    page,
    request,
  }) => {
    await ensureBootstrap(request)

    await loginWith(page, ADMIN_USER)
    await expect(page).toHaveURL(/\/(\?|$)/)

    await page.goto("/admin/import")
    await expect(page).toHaveURL(/\/admin\/elevate\?redirect=%2Fadmin%2Fimport/)
    await expect(page.getByTestId("admin-elevation-form")).toBeVisible()

    await page.getByTestId("admin-elevation-password").fill("wrong-password")
    await page.getByTestId("admin-elevation-submit").click()
    await expect(page).toHaveURL(/\/admin\/elevate\?redirect=%2Fadmin%2Fimport/)
    await expect(page.getByTestId("admin-elevation-error")).toHaveText("Invalid password")

    await page.getByTestId("admin-elevation-password").fill(ADMIN_USER.password)
    await page.getByTestId("admin-elevation-submit").click()
    await expect(page).toHaveURL("/admin/import")

    await expect(page.locator("main h1")).toContainText("SQLite Import")
    await expect(page.getByRole("button", { name: "Preview CSV" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Import CSV" })).toHaveCount(0)

    await page.goto("/admin")
    await expect(page).toHaveURL("/admin")
    await expect(page.locator("main h1")).toContainText("Admin")
    await expect(page.getByText("Appearance")).toHaveCount(0)
    await expect(page.getByText("Balance Snapshots")).toHaveCount(0)
  })

  test("same-browser user switching resets data scope and first mutation succeeds", async ({
    page,
    request,
  }) => {
    await ensureBootstrap(request)

    const csrfToken = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, csrfToken, "expense", "CrossFlow Bootstrap")
    const bootstrapOnlyTitle = `CrossFlow Bootstrap ${Date.now()}`
    await createTransaction(request, csrfToken, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 777,
      category_id: categoryId,
      title: bootstrapOnlyTitle,
      tags: [],
    })

    await ensureOrdinaryUser(request)

    await loginWith(page, ADMIN_USER)
    await page.goto(`/transactions?period=all&q=${encodeURIComponent(bootstrapOnlyTitle)}`)
    await expect(page.locator("div.surface-card").filter({ hasText: bootstrapOnlyTitle }).first()).toBeVisible()

    await page.goto("/settings")
    await expect(page.getByTestId("settings-page")).toBeVisible()
    await page.getByTestId("auth-logout").click()
    await expect(page).toHaveURL(/\/login(?:\?|$)/)

    await loginWith(page, ORDINARY_USER)
    await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0)

    await page.goto(`/transactions?period=all&q=${encodeURIComponent(bootstrapOnlyTitle)}`)
    await expect(page.locator("div.surface-card").filter({ hasText: bootstrapOnlyTitle })).toHaveCount(0)

    const memberCategoryName = `CrossFlow Member ${Date.now()}`
    await page.goto("/categories")
    await page.getByRole("button", { name: "Add category" }).first().click()
    const categoryDialog = page.getByRole("dialog", { name: "Add category" })
    await categoryDialog.getByRole("textbox", { name: "Name" }).fill(memberCategoryName)
    await categoryDialog.getByLabel("Type").selectOption("expense")

    const createResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/categories") &&
        response.request().method() === "POST"
    )
    await categoryDialog.getByRole("button", { name: "Add category" }).click()
    const createResponse = await createResponsePromise
    expect(createResponse.status()).toBe(200)
    await expect(page.locator("body")).toContainText(memberCategoryName)
  })

  test("switching from elevated admin to ordinary user relocks admin surfaces", async ({
    page,
    request,
  }) => {
    await ensureOrdinaryUser(request)

    await loginWith(page, ADMIN_USER)
    await page.goto("/admin")
    await expect(page).toHaveURL(/\/admin\/elevate\?redirect=/)

    await page.getByTestId("admin-elevation-password").fill(ADMIN_USER.password)
    await page.getByTestId("admin-elevation-submit").click()
    await expect(page).toHaveURL("/admin")
    await expect(page.locator("main h1")).toContainText("Admin")

    await page.goto("/settings")
    await expect(page.getByTestId("settings-page")).toBeVisible()
    await page.getByTestId("auth-logout").click()
    await expect(page).toHaveURL(/\/login(?:\?|$)/)

    await loginWith(page, ORDINARY_USER)
    await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0)

    await page.goto("/admin")
    await expect(page).not.toHaveURL(/\/admin/)
    await expect(page.locator("main h1")).not.toContainText("Admin")

    await page.goto("/admin/import")
    await expect(page).not.toHaveURL(/\/admin/)
    await expect(page.locator("main h1")).not.toContainText("SQLite Import")
  })
})
