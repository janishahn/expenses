import { expect, test, type Page } from "./fixtures"
import { ensureCategory, getCsrfToken, waitForEntrance } from "./helpers"

async function useTheme(page: Page, theme: "light" | "dark") {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" })
  await page.addInitScript((selectedTheme) => {
    window.localStorage.setItem("ew.theme.preference", selectedTheme)
  }, theme)
}

test.describe("Focus management", () => {
  test("controlled dialogs return focus to their openers", async ({ page }) => {
    await useTheme(page, "light")
    await page.goto("/transactions")

    const addTrigger = page.getByRole("button", { name: "Add transaction", exact: true })
    await addTrigger.focus()
    await addTrigger.press("Enter")
    const addDialog = page.getByRole("dialog", { name: "Add transaction" })
    await expect(addDialog).toBeVisible()
    await waitForEntrance(addDialog)
    await page.keyboard.press("Escape")
    await expect(addDialog).toBeHidden()
    await expect(addTrigger).toBeFocused()
  })

  test("responsive More sheet traps and returns focus", async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 400 })
    await useTheme(page, "light")
    await page.goto("/transactions")

    const menuTrigger = page
      .getByRole("navigation", { name: "Tabs" })
      .getByRole("button", { name: "More" })
    await menuTrigger.focus()
    await menuTrigger.press("Enter")
    const menu = page.getByRole("dialog", { name: "More" })
    await expect(menu).toBeVisible()
    await expect
      .poll(() =>
        page.evaluate(() => Boolean(document.activeElement?.closest("[role='dialog']")))
      )
      .toBe(true)

    for (let index = 0; index < 24; index += 1) {
      await page.keyboard.press("Tab")
      expect(
        await page.evaluate(() => Boolean(document.activeElement?.closest("[role='dialog']")))
      ).toBe(true)
    }

    await page.keyboard.press("Escape")
    await expect(menu).toBeHidden()
    await expect(menuTrigger).toBeFocused()

    await menuTrigger.press("Enter")
    await expect(menu).toBeVisible()
    await waitForEntrance(menu)
    await page.mouse.click(320, 20)
    await expect(menu).toBeHidden()
    await expect(menuTrigger).toBeFocused()
  })

  test("a confirm opened from a menu returns focus to the menu button", async ({ page, request }) => {
    await useTheme(page, "light")
    const token = await getCsrfToken(request)
    const suffix = Date.now()
    const categoryId = await ensureCategory(request, token, "expense", `Focus confirm ${suffix}`)
    const name = `Focus confirm template ${suffix}`
    const response = await request.post("/api/templates", {
      headers: { "X-CSRF-Token": token },
      data: { name, type: "expense", category_id: categoryId, default_amount_cents: null, title: null, tags: [] },
    })
    expect(response.ok()).toBeTruthy()
    const { id } = (await response.json()) as { id: number }

    await page.goto(`/templates?peek=${id}`)
    const moreActions = page.getByRole("complementary").getByRole("button", { name: "More actions" })
    await moreActions.focus()
    await moreActions.press("Enter")
    await page.getByRole("menuitem", { name: "Delete template" }).press("Enter")
    const confirm = page.getByRole("dialog", { name: `Delete template "${name}"?` })
    await waitForEntrance(confirm)
    await page.keyboard.press("Escape")
    await expect(confirm).toBeHidden()
    await expect(moreActions).toBeFocused()
  })
})
