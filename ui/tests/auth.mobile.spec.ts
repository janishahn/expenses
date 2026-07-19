import { expect, test } from "./fixtures"
import { ADMIN_USER, ensureBootstrap } from "./auth-helpers"

test.use({ storageState: { cookies: [], origins: [] } })

test.describe.serial("Authentication surfaces (mobile)", () => {
  test("renders the first-run setup surface without overflow", async ({ page }) => {
    await page.goto("/setup")
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

  test("signs up and logs in from the mobile auth surfaces", async ({ page, request }) => {
    await ensureBootstrap(request)
    await request.post("/api/auth/logout", {
      headers: {
        "X-CSRF-Token": ((await (await request.get("/api/csrf")).json()) as {
          token: string
        }).token,
      },
    })

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
})
