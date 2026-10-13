import { mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { ensureElevatedAdmin } from "./auth-helpers"
import { expect, test, type Page } from "./fixtures"
import { createCategory, ensureCategory, getCsrfToken, loginAsIsolatedUser, waitForEntrance } from "./helpers"

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
  test("transaction search returns focus to its opener", async ({ page }) => {
    await useTheme(page, "light")
    await page.goto("/transactions")

    const searchTrigger = page.getByRole("button", { name: "Search", exact: true })
    await searchTrigger.focus()
    await searchTrigger.press("Enter")
    const searchInput = page.getByRole("searchbox", {
      name: "Search transactions",
    })
    await expect(searchInput).toBeFocused()
    await searchInput.press("Escape")
    await expect(searchTrigger).toBeFocused()
  })

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

  test("category dialog returns focus to its opener", async ({ page }) => {
    await useTheme(page, "light")
    await page.goto("/categories")
    const categoryTrigger = page.getByRole("button", { name: "Add category" }).first()
    await categoryTrigger.focus()
    await categoryTrigger.press("Enter")
    const categoryDialog = page.getByRole("dialog", { name: "Add category" })
    await expect(categoryDialog).toBeVisible()
    await waitForEntrance(categoryDialog)
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
    test(`responsive More sheet traps and returns focus in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 640, height: 400 })
      await useTheme(page, theme)
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
      await waitForEntrance(menu)
      await page.mouse.click(320, 20)
      await expect(menu).toBeHidden()
      await expect(menuTrigger).toBeFocused()
    })

    test(`responsive add dialog returns focus to its opener in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 640, height: 400 })
      await useTheme(page, theme)
      await page.goto("/transactions")

      const addTrigger = page.getByRole("button", {
        name: "Add transaction",
        exact: true,
      })
      await addTrigger.focus()
      await addTrigger.press("Enter")
      const dialog = page.getByRole("dialog", { name: "Add transaction" })
      await expect(dialog).toBeVisible()
      await waitForEntrance(dialog)
      await page.keyboard.press("Escape")
      await expect(dialog).toBeHidden()
      await expect(addTrigger).toBeFocused()
    })
  }

  test("admin log entries open from the keyboard", async ({ page }) => {
    await useTheme(page, "light")
    await ensureElevatedAdmin(page)
    await page.goto("/admin/logs")
    await page
      .getByRole("radiogroup", { name: "Log type" })
      .getByRole("radio", { name: "All" })
      .click()
    const entry = page
      .getByRole("list", { name: "Log entries" })
      .getByRole("listitem")
      .first()
    await expect(entry).toBeVisible()
    const name = (await entry.getAttribute("aria-label")) ?? ""
    const event = name.replace(/^\S+ /, "").replace(/ at .*$/, "")
    const peek = page.getByRole("complementary", { name: event, exact: true })

    await entry.focus()
    await entry.press("Enter")
    await expect(entry).toHaveAttribute("aria-current", "true")
    await expect(peek).toBeVisible()
    await entry.press("Escape")
    await expect(peek).toBeHidden()
    await expect(entry).not.toHaveAttribute("aria-current", "true")

    await entry.focus()
    await entry.press("Space")
    await expect(entry).toHaveAttribute("aria-current", "true")
    await expect(peek).toBeVisible()

    if (artifactDirectory) {
      mkdirSync(artifactDirectory, { recursive: true })
      await page.screenshot({
        path: resolve(artifactDirectory, "admin-log-keyboard-selection.png"),
        fullPage: true,
        animations: "disabled",
      })
    }
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

  test("deleting a row from its peek moves focus to the next row", async ({ page }) => {
    await useTheme(page, "light")
    await page.goto("/templates")
    const { request, csrfToken } = await loginAsIsolatedUser(page)
    try {
      const categoryId = await createCategory(request, csrfToken, "expense", "Focus delete")
      for (const name of ["Focus row A", "Focus row B", "Focus row C"]) {
        const response = await request.post("/api/templates", {
          headers: { "X-CSRF-Token": csrfToken },
          data: { name, type: "expense", category_id: categoryId, default_amount_cents: null, title: null, tags: [] },
        })
        expect(response.ok()).toBeTruthy()
      }
      await page.goto("/templates")
      const list = page.getByRole("list", { name: "Templates" })
      await list.getByRole("listitem", { name: "Focus row B" }).focus()
      await page.keyboard.press("Enter")
      const moreActions = page.getByRole("complementary", { name: "Focus row B" }).getByRole("button", { name: "More actions" })
      await moreActions.focus()
      await moreActions.press("Enter")
      await page.getByRole("menuitem", { name: "Delete template" }).press("Enter")
      const confirm = page.getByRole("dialog", { name: 'Delete template "Focus row B"?' })
      await waitForEntrance(confirm)
      await confirm.getByRole("button", { name: "Delete", exact: true }).press("Enter")
      await expect(list.getByRole("listitem", { name: "Focus row B" })).toHaveCount(0)
      await expect(list.getByRole("listitem", { name: "Focus row C" })).toBeFocused()
    } finally {
      await request.dispose()
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
