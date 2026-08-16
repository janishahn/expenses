import { mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { ensureElevatedAdmin } from "./auth-helpers"
import { expect, test, type Page } from "./fixtures"
import { ensureCategory, getCsrfToken } from "./helpers"

const artifactDirectory = process.env.UI_POLISH_AUDIT_ARTIFACT_DIR
  ? resolve(
      "..",
      process.env.UI_POLISH_AUDIT_ARTIFACT_DIR,
      "repairs",
      "R-001",
      "desktop-chromium",
    )
  : null

async function useTheme(page: Page, theme: "light" | "dark") {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" })
  await page.addInitScript((selectedTheme) => {
    window.localStorage.setItem("ew.theme.preference", selectedTheme)
  }, theme)
}

test.describe("Focus management", () => {
  test("search and controlled dialogs return focus to their openers", async ({
    page,
  }) => {
    await useTheme(page, "light")
    await page.goto("/transactions")

    const searchTrigger = page.getByRole("button", {
      name: "Search transactions",
    })
    await searchTrigger.focus()
    await searchTrigger.press("Enter")
    const searchInput = page.getByRole("searchbox", {
      name: "Search transactions",
    })
    await expect(searchInput).toBeFocused()
    await searchInput.press("Escape")
    await expect(searchTrigger).toBeFocused()

    const addTrigger = page
      .getByTestId("app-shell-utility")
      .getByRole("button", { name: "Add transaction", exact: true })
    await addTrigger.focus()
    await addTrigger.press("Enter")
    const addDialog = page.getByRole("dialog", { name: "Add transaction" })
    await expect(addDialog).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(addDialog).toBeHidden()
    await expect(addTrigger).toBeFocused()

    await page.goto("/categories")
    const categoryTrigger = page.getByRole("button", { name: "Add category" }).first()
    await categoryTrigger.focus()
    await categoryTrigger.press("Enter")
    const categoryDialog = page.getByRole("dialog", { name: "Add category" })
    await expect(categoryDialog).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(categoryDialog).toBeHidden()
    await expect(categoryTrigger).toBeFocused()

    if (artifactDirectory) {
      mkdirSync(artifactDirectory, { recursive: true })
      await page.screenshot({
        path: resolve(artifactDirectory, "controlled-dialog-focus-return.png"),
        fullPage: true,
        animations: "disabled",
      })
    }
  })

  for (const theme of ["light", "dark"] as const) {
    test(`responsive drawer traps and returns focus in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 640, height: 400 })
      await useTheme(page, theme)
      await page.goto("/transactions")

      const menuTrigger = page.getByRole("button", { name: "Open menu" })
      await menuTrigger.focus()
      await menuTrigger.press("Enter")
      const menu = page.getByRole("complementary", { name: "Application menu" })
      await expect(menu).toBeVisible()
      await expect
        .poll(() =>
          page.evaluate(() =>
            Boolean(document.activeElement?.closest('[aria-label="Application menu"]'))
          )
        )
        .toBe(true)
      const closeButton = page.getByRole("button", { name: "Close menu" })
      await page.keyboard.press("Tab")
      await expect(closeButton).toBeFocused()
      await page.waitForTimeout(350)
      await expect(closeButton).toBeFocused()

      for (let index = 0; index < 24; index += 1) {
        await page.keyboard.press("Tab")
        expect(
          await page.evaluate(() =>
            Boolean(document.activeElement?.closest('[aria-label="Application menu"]'))
          )
        ).toBe(true)
      }

      if (artifactDirectory) {
        mkdirSync(resolve(artifactDirectory, theme), { recursive: true })
        await page.screenshot({
          path: resolve(artifactDirectory, theme, "drawer-focus-trap.png"),
          animations: "disabled",
        })
      }
      await page.keyboard.press("Escape")
      await expect(menu).toBeHidden()
      await expect(menuTrigger).toBeFocused()

      await menuTrigger.press("Enter")
      await expect(menu).toBeVisible()
      await page.mouse.click(636, 200)
      await expect(menu).toBeHidden()
      await expect(menuTrigger).toBeFocused()

      const addTrigger = page.getByRole("button", {
        name: "Add transaction",
        exact: true,
      })
      await addTrigger.focus()
      await addTrigger.press("Enter")
      const dialog = page.getByRole("dialog", { name: "Add transaction" })
      await expect(dialog).toBeVisible()
      await page.keyboard.press("Escape")
      await expect(dialog).toBeHidden()
      await expect(addTrigger).toBeFocused()
    })
  }

  test("admin log entries expose an explicit keyboard action", async ({ page }) => {
    await useTheme(page, "light")
    await ensureElevatedAdmin(page)
    await page.getByRole("button", { name: "All", exact: true }).click()
    const firstRow = page.locator("tbody tr").first()
    await expect(firstRow).toBeVisible()
    const inspectButton = firstRow.getByRole("button", { name: /^Inspect / })
    await expect(inspectButton).toBeVisible()
    await inspectButton.focus()
    await inspectButton.press("Enter")
    await expect(inspectButton).toHaveAttribute("aria-pressed", "true")
    await inspectButton.press("Space")
    await expect(inspectButton).toHaveAttribute("aria-pressed", "true")

    if (artifactDirectory) {
      mkdirSync(artifactDirectory, { recursive: true })
      await page.screenshot({
        path: resolve(artifactDirectory, "admin-log-keyboard-selection.png"),
        fullPage: true,
        animations: "disabled",
      })
    }
  })

  test("keyboard template reorder preserves focus on the moved handle", async ({
    page,
    request,
  }) => {
    await useTheme(page, "light")
    const token = await getCsrfToken(request)
    const suffix = Date.now()
    const categoryId = await ensureCategory(
      request,
      token,
      "expense",
      `Focus repair reorder ${suffix}`,
    )
    const names = [`Focus repair A ${suffix}`, `Focus repair B ${suffix}`]
    for (const name of names) {
      const response = await request.post("/api/templates", {
        headers: { "X-CSRF-Token": token },
        data: {
          name,
          type: "expense",
          category_id: categoryId,
          default_amount_cents: null,
          title: null,
          tags: [],
        },
      })
      expect(response.ok()).toBeTruthy()
    }

    await page.goto("/templates")
    const handle = page.getByRole("button", { name: `Reorder ${names[0]}` })
    const reorderResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/templates/reorder" &&
        response.request().method() === "POST"
    )
    await handle.focus()
    await handle.press("Space")
    await page.waitForTimeout(100)
    await handle.press("ArrowDown")
    await page.waitForTimeout(100)
    await handle.press("Space")
    await reorderResponse
    await expect(handle).toBeFocused()

    if (artifactDirectory) {
      mkdirSync(artifactDirectory, { recursive: true })
      await page.screenshot({
        path: resolve(artifactDirectory, "template-keyboard-reorder-focus.png"),
        animations: "disabled",
      })
    }
  })
})
