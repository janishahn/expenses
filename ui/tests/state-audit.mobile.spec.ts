import { expect, test } from "./fixtures"
import { loginAsIsolatedUser } from "./helpers"
import { useAuditTheme } from "./state-audit.helpers"

test.describe("Mobile state audit", () => {
  test("a failed add keeps the entered values and its actions reachable at short height", async ({
    page,
  }) => {
    await useAuditTheme(page, "light")
    await page.setViewportSize({ width: 393, height: 360 })
    await page.goto("/transactions")
    await page.getByRole("button", { name: "Add transaction", exact: true }).tap()
    const dialog = page.getByRole("dialog", { name: "Add transaction" })
    const submit = dialog.getByRole("button", { name: "Add transaction" })
    const title = `Audit mobile pending ${Date.now()}`

    let failNext = true
    await page.route("**/api/transactions", async (route) => {
      if (route.request().method() !== "POST" || !failNext) return route.continue()
      failNext = false
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"detail":"Audit mobile save unavailable"}',
      })
    })

    await dialog.getByLabel("Amount").fill("56.78")
    await dialog.getByLabel("Title").fill(title)
    await submit.scrollIntoViewIfNeeded()
    await submit.tap()
    await expect(submit).toBeDisabled()
    const failure = dialog.getByText("Audit mobile save unavailable")
    await failure.scrollIntoViewIfNeeded()
    await expect(failure).toBeVisible()
    await expect(dialog.getByLabel("Amount")).toHaveValue("56.78")
    await expect(dialog.getByLabel("Title")).toHaveValue(title)

    const cancel = dialog.getByRole("button", { name: "Cancel" })
    await cancel.scrollIntoViewIfNeeded()
    await expect(cancel).toBeVisible()
    await expect(submit).toBeEnabled()
    await submit.scrollIntoViewIfNeeded()
    await submit.tap()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole("status")).toContainText("Transaction added")
  })

  test("an ordinary member sees no Admin entry and /admin returns to the dashboard", async ({
    page,
  }) => {
    await useAuditTheme(page, "light")
    await page.goto("/")
    const member = await loginAsIsolatedUser(page)
    try {
      await page.goto("/settings")
      await page.getByRole("navigation", { name: "Tabs" }).getByRole("button", { name: "More" }).tap()
      const menu = page.getByRole("dialog", { name: "More" })
      await expect(menu.getByRole("link", { name: "Settings" })).toBeVisible()
      await expect(menu.getByRole("link", { name: "Admin" })).toHaveCount(0)
      await page.keyboard.press("Escape")
      await page.goto("/admin")
      await expect(page).toHaveURL("/")
      await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible()
    } finally {
      await member.request.dispose()
    }
  })

  // Playwright's WebKit keeps a failed page chunk failed for the tab, even across
  // reloads, so the reload after the server answers is covered on desktop only.
  // Safari fetches the chunk again on reload.
})
