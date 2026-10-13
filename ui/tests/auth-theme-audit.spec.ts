import AxeBuilder from "@axe-core/playwright"
import { expect, freshInstanceTest as test, type Page } from "./fixtures"

const CANVAS = { light: "rgb(234, 234, 231)", dark: "rgb(17, 16, 14)" }

async function checkInBothThemes(page: Page, state: string) {
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((selectedTheme) => {
      const key = "ew.theme.preference"
      const oldValue = window.localStorage.getItem(key)
      window.localStorage.setItem(key, selectedTheme)
      window.dispatchEvent(
        new StorageEvent("storage", {
          key,
          oldValue,
          newValue: selectedTheme,
          storageArea: window.localStorage,
        }),
      )
    }, theme)
    await expect.poll(() => page.locator("html").getAttribute("data-theme")).toBe(theme)

    const layout = await page.evaluate(() => ({
      background: getComputedStyle(document.body).backgroundColor,
      overflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }))
    expect(layout.background, `${state} canvas in ${theme}`).toBe(CANVAS[theme])
    expect(layout.overflow, `${state} overflow in ${theme}`).toBeLessThanOrEqual(1)

    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .disableRules(["color-contrast"])
      .analyze()
    expect(accessibility.violations, `${state} accessibility in ${theme}`).toEqual([])
  }
}

test("setup, login, validation, signup, and success states follow the theme without overflow", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" })

  await page.goto("/")
  await expect(page).toHaveURL(/\/setup(?:\?|$)/)
  await expect(page.getByRole("heading", { name: "Create the admin account" })).toBeVisible()
  await checkInBothThemes(page, "setup")

  await page.getByLabel("Username").fill("audit-admin")
  await page.getByLabel("Password").fill("hunter22")
  await page.getByRole("button", { name: "Create account" }).click()
  await expect(page.getByTestId("app-shell-root")).toBeVisible()
  await page.getByRole("button", { name: "Expenses", exact: true }).click()
  await page.getByRole("menuitem", { name: "Sign out" }).click()
  await expect(page).toHaveURL(/\/login(?:\?|$)/)
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible()
  await checkInBothThemes(page, "login")

  await page.getByLabel("Username").fill("audit-admin")
  await page.getByLabel("Password").fill("wrong-password")
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page.getByRole("alert")).toBeVisible()
  await checkInBothThemes(page, "login error")

  await page.getByRole("link", { name: "Create account" }).click()
  await expect(page).toHaveURL(/\/signup(?:\?|$)/)
  await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible()
  await checkInBothThemes(page, "signup")

  await page.getByLabel("Username").fill("audit-user")
  await page.getByLabel("Password").fill("hunter22")
  await page.getByRole("button", { name: "Create account" }).click()
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole("status")).toHaveText("Account created. Sign in to continue.")
  await checkInBothThemes(page, "login after signup")
})
