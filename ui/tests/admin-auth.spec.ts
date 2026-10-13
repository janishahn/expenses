import { expect, test, type Page } from "./fixtures"
import {
  ADMIN_USER,
  ORDINARY_USER,
  ensureBootstrap,
  ensureOrdinaryUser,
  loginWith,
} from "./auth-helpers"
import { createTransaction, ensureCategory, getCsrfToken } from "./helpers"

test.use({ storageState: { cookies: [], origins: [] } })

async function expectAppMenu(page: Page, items: string[]): Promise<void> {
  await page.goto("/")
  await page.getByRole("button", { name: "Expenses", exact: true }).click()
  await expect(page.getByRole("menu").getByRole("menuitem")).toHaveText(items)
  await page.keyboard.press("Escape")
}

async function signOutFromSettings(page: Page): Promise<void> {
  await page.goto("/settings")
  await page.getByRole("button", { name: "Sign out" }).click()
  await expect(page).toHaveURL(/\/login(?:\?|$)/)
}

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
    await expect(page.locator("main h1")).toHaveText("Dashboard")

    await expectAppMenu(page, ["Settings", "Sign out"])

    for (const path of ["/admin", "/admin/logs", "/admin/import"]) {
      await page.goto(path)
      await expect(page).toHaveURL("/")
      await expect(page.locator("main h1")).toHaveText("Dashboard")
    }
  })

  test("requires elevation for admin deep links and returns to the requested page", async ({
    page,
    request,
  }) => {
    await ensureBootstrap(request)

    await loginWith(page, ADMIN_USER)
    await expect(page).toHaveURL(/\/(\?|$)/)
    await expectAppMenu(page, ["Settings", "Admin", "Sign out"])

    await page.goto("/admin/import")
    await expect(page).toHaveURL(/\/admin\/elevate\?redirect=%2Fadmin%2Fimport/)
    const adminSections = page.getByRole("navigation", { name: "Admin sections" })
    await expect(adminSections.getByRole("link", { name: "Maintenance" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    await expect(page.getByRole("heading", { name: "Enter your password" })).toBeVisible()
    await expect(page.getByLabel("SQLite database file")).toHaveCount(0)

    await page.getByLabel("Password").fill("wrong-password")
    await page.getByRole("button", { name: "Unlock" }).click()
    await expect(page).toHaveURL(/\/admin\/elevate\?redirect=%2Fadmin%2Fimport/)
    await expect(page.getByRole("alert")).toHaveText("Invalid password")
    await expect(page.getByLabel("Password")).toHaveValue("")

    await page.getByLabel("Password").fill(ADMIN_USER.password)
    await page.getByRole("button", { name: "Unlock" }).click()
    await expect(page).toHaveURL("/admin/import")
    await expect(page.locator("main h1")).toHaveText("Legacy SQLite import")
    await expect(page.getByLabel("SQLite database file")).toBeAttached()

    await page.goto("/admin")
    await expect(page).toHaveURL("/admin")
    await expect(page.locator("main h1")).toHaveText("Health")
  })

  test("cancelling elevation returns to Settings", async ({ page, request }) => {
    await ensureBootstrap(request)
    await loginWith(page, ADMIN_USER)

    await page.goto("/admin/logs")
    await expect(page).toHaveURL(/\/admin\/elevate\?redirect=%2Fadmin%2Flogs/)
    await page.getByRole("link", { name: "Cancel" }).click()
    await expect(page).toHaveURL("/settings")
    await expect(page.locator("main h1")).toHaveText("Account")
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
    await expect(page.getByRole("listitem", { name: bootstrapOnlyTitle })).toBeVisible()

    await signOutFromSettings(page)

    await loginWith(page, ORDINARY_USER)
    await expectAppMenu(page, ["Settings", "Sign out"])

    await page.goto(`/transactions?period=all&q=${encodeURIComponent(bootstrapOnlyTitle)}`)
    await expect(page.getByRole("listitem", { name: bootstrapOnlyTitle })).toHaveCount(0)

    const memberCategoryName = `CrossFlow Member ${Date.now()}`
    await page.goto("/categories")
    await page.getByRole("button", { name: "Add category" }).first().click()
    const categoryDialog = page.getByRole("dialog", { name: "Add category" })
    await categoryDialog.getByRole("textbox", { name: "Name" }).fill(memberCategoryName)

    const createResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/categories") && response.request().method() === "POST"
    )
    await categoryDialog.getByRole("button", { name: "Add category" }).click()
    const createResponse = await createResponsePromise
    expect(createResponse.status()).toBe(200)
    await expect(
      page.getByRole("list", { name: "Categories" }).getByRole("listitem", { name: memberCategoryName, exact: true })
    ).toBeVisible()
  })

  test("switching from elevated admin to ordinary user relocks admin surfaces", async ({
    page,
    request,
  }) => {
    await ensureOrdinaryUser(request)

    await loginWith(page, ADMIN_USER)
    await page.goto("/admin")
    await expect(page).toHaveURL(/\/admin\/elevate\?redirect=/)

    await page.getByLabel("Password").fill(ADMIN_USER.password)
    await page.getByRole("button", { name: "Unlock" }).click()
    await expect(page).toHaveURL("/admin")
    await expect(page.locator("main h1")).toHaveText("Health")

    await signOutFromSettings(page)

    await loginWith(page, ORDINARY_USER)
    await expectAppMenu(page, ["Settings", "Sign out"])

    for (const path of ["/admin", "/admin/import"]) {
      await page.goto(path)
      await expect(page).toHaveURL("/")
      await expect(page.locator("main h1")).toHaveText("Dashboard")
    }
  })
})
