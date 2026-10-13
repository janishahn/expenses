import { expect, freshInstanceTest as test } from "./fixtures"
import { ADMIN_USER } from "./auth-helpers"

test.describe.serial("Authentication surfaces (mobile)", () => {
  test("renders the first-run setup surface without overflow and bootstraps the instance", async ({
    page,
  }) => {
    await page.goto("/")
    await expect(page).toHaveURL(/\/setup(?:\?|$)/)
    await expect(page.getByRole("heading", { name: "Create the admin account" })).toBeVisible()
    await page.getByLabel("Username").fill(ADMIN_USER.username)
    await page.getByLabel("Password").fill(ADMIN_USER.password)

    const width = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }))
    expect(width.scroll).toBeLessThanOrEqual(width.client)

    await page.getByRole("button", { name: "Create account" }).click()
    await expect(page).toHaveURL(/\/(?:\?|$)/)
    await expect(page.getByTestId("app-shell-root")).toBeVisible()
  })

  test("signs up and logs in from the mobile auth surfaces", async ({ page }) => {
    const username = `mobile-user-${Date.now()}`
    await page.goto("/signup")
    await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible()
    await page.getByLabel("Username").fill(username)
    await page.getByLabel("Password").fill("hunter22")
    await page.getByRole("button", { name: "Create account" }).click()
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole("status")).toHaveText("Account created. Sign in to continue.")

    await page.getByLabel("Username").fill(username)
    await page.getByLabel("Password").fill("hunter22")
    await page.getByRole("button", { name: "Sign in" }).click()
    await expect(page).toHaveURL(/\/(?:\?|$)/)
    await expect(page.getByTestId("app-shell-root")).toBeVisible()
  })

  test("logs out from mobile settings and guards deep links until the next login", async ({
    page,
  }) => {
    await page.goto("/")
    await expect(page).toHaveURL(/\/login(?:\?|$)/)
    await page.getByLabel("Username").fill(ADMIN_USER.username)
    await page.getByLabel("Password").fill(ADMIN_USER.password)
    await page.getByRole("button", { name: "Sign in" }).click()
    await expect(page.getByTestId("app-shell-root")).toBeVisible()

    await page.getByRole("navigation", { name: "Tabs" }).getByRole("button", { name: "More" }).click()
    await page.getByRole("dialog", { name: "More" }).getByRole("link", { name: "Settings" }).click()
    await expect(page.locator("main h1")).toHaveText("Settings")

    await page.getByRole("button", { name: "Sign out" }).click()
    await expect(page).toHaveURL(/\/login(?:\?|$)/)
    await expect(page.getByTestId("app-shell-root")).toHaveCount(0)

    await page.goto("/transactions")
    await expect(page).toHaveURL(/\/login\?redirect=/)
    await expect(page.getByTestId("app-shell-root")).toHaveCount(0)

    await page.getByLabel("Username").fill(ADMIN_USER.username)
    await page.getByLabel("Password").fill("wrong-password")
    await page.getByRole("button", { name: "Sign in" }).click()
    await expect(page.getByRole("alert")).toHaveText("Invalid username or password")

    await page.getByLabel("Password").fill(ADMIN_USER.password)
    await page.getByRole("button", { name: "Sign in" }).click()
    await expect(page).toHaveURL(/\/transactions(?:\?|$)/)
    await expect(page.getByTestId("app-shell-root")).toBeVisible()
  })
})
