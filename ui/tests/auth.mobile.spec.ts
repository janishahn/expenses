import { expect, freshInstanceTest as test } from "./fixtures"
import { ADMIN_USER } from "./auth-helpers"

test.describe.serial("Authentication surfaces (mobile)", () => {
  test("renders the first-run setup surface without overflow and bootstraps the instance", async ({
    page,
  }) => {
    await page.goto("/")
    await expect(page).toHaveURL(/\/setup(?:\?|$)/)
    await expect(page.getByTestId("setup-form")).toBeVisible()
    await page.getByTestId("auth-username").fill(ADMIN_USER.username)
    await page.getByTestId("auth-password").fill(ADMIN_USER.password)

    const width = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }))
    expect(width.scroll).toBeLessThanOrEqual(width.client)

    await page.getByTestId("auth-submit").click()
    await expect(page).toHaveURL(/\/(?:\?|$)/)
    await expect(page.getByTestId("app-shell-root")).toBeVisible()
  })

  test("signs up and logs in from the mobile auth surfaces", async ({ page }) => {
    const username = `mobile-user-${Date.now()}`
    await page.goto("/signup")
    await page.getByTestId("auth-username").fill(username)
    await page.getByTestId("auth-password").fill("hunter22")
    await page.getByTestId("auth-submit").click()
    await expect(page).toHaveURL(/\/login/)

    await page.getByTestId("auth-username").fill(username)
    await page.getByTestId("auth-password").fill("hunter22")
    await page.getByTestId("auth-submit").click()
    await expect(page).toHaveURL(/\/(?:\?|$)/)
    await expect(page.getByTestId("app-shell-root")).toBeVisible()
  })

  test("logs out from mobile settings and guards deep links until the next login", async ({
    page,
  }) => {
    await page.goto("/")
    await expect(page).toHaveURL(/\/login(?:\?|$)/)
    await page.getByTestId("auth-username").fill(ADMIN_USER.username)
    await page.getByTestId("auth-password").fill(ADMIN_USER.password)
    await page.getByTestId("auth-submit").click()
    await expect(page.getByTestId("app-shell-root")).toBeVisible()

    await page.getByRole("button", { name: "Open menu" }).click()
    const sidebar = page.getByRole("complementary", { name: "Application menu" })
    await expect(sidebar).toBeVisible()
    const settingsLink = sidebar.getByRole("link", { name: "Settings" })
    await settingsLink.scrollIntoViewIfNeeded()
    await settingsLink.click()
    await expect(page.getByTestId("settings-page")).toBeVisible()

    await page.getByTestId("auth-logout").click()
    await expect(page).toHaveURL(/\/login(?:\?|$)/)
    await expect(page.getByTestId("app-shell-root")).toHaveCount(0)

    await page.goto("/transactions")
    await expect(page).toHaveURL(/\/login\?redirect=/)
    await expect(page.getByTestId("app-shell-root")).toHaveCount(0)

    await page.getByTestId("auth-username").fill(ADMIN_USER.username)
    await page.getByTestId("auth-password").fill(ADMIN_USER.password)
    await page.getByTestId("auth-submit").click()
    await expect(page).toHaveURL(/\/transactions(?:\?|$)/)
    await expect(page.getByTestId("app-shell-root")).toBeVisible()
  })
})
