import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test, type Page } from "./fixtures"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const auditArtifactRoot = process.env.UI_POLISH_AUDIT_ARTIFACT_DIR
  ? resolve(repoRoot, process.env.UI_POLISH_AUDIT_ARTIFACT_DIR)
  : null

function persistIn(directory: string | null, name: string, payload: unknown) {
  if (!directory) return
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    resolve(directory, `${name}.json`),
    `${JSON.stringify(payload, null, 2)}\n`,
  )
}

async function activeElement(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null
    if (!element) return null
    return {
      tag: element.tagName.toLowerCase(),
      text: element.textContent?.trim().replace(/\s+/g, " ").slice(0, 100) ?? "",
      ariaLabel: element.getAttribute("aria-label"),
      role: element.getAttribute("role"),
      testId: element.getAttribute("data-testid"),
      insideDialog: Boolean(element.closest('[role="dialog"]')),
      hiddenAncestor: Boolean(element.closest('[aria-hidden="true"]')),
    }
  })
}

test.describe("Desktop interaction audit evidence", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`records 200 percent reflow drawer and dialog keyboard behavior in ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 640, height: 400 })
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" })
      await page.addInitScript((selectedTheme) => {
        window.localStorage.setItem("ew.theme.preference", selectedTheme)
      }, theme)
      const directory = auditArtifactRoot
        ? resolve(
            auditArtifactRoot,
            "desktop-200-percent-reflow",
            theme,
          )
        : null
      if (directory) mkdirSync(directory, { recursive: true })
      await page.goto("/transactions")

      const menuTrigger = page.getByRole("button", { name: "Open menu" })
      await menuTrigger.focus()
      await menuTrigger.click()
      const menu = page.getByRole("complementary", { name: "Application menu" })
      await expect(menu).toBeVisible()
      await page.waitForTimeout(300)
      if (directory) {
        await page.screenshot({
          path: resolve(directory, "interactive-drawer-focus.png"),
        })
      }
      const lastMenuLink = menu.getByRole("link", { name: "Admin" })
      await lastMenuLink.scrollIntoViewIfNeeded()
      await expect(lastMenuLink).toBeVisible()
      if (directory) {
        await page.screenshot({
          path: resolve(directory, "interactive-drawer-end.png"),
        })
      }
      const menuAfterOpen = await activeElement(page)
      const menuTabs = []
      for (let index = 0; index < 6; index += 1) {
        await page.keyboard.press("Tab")
        menuTabs.push(await activeElement(page))
      }
      await page.keyboard.press("Escape")
      await expect(menu).toBeHidden()
      const menuAfterEscape = await activeElement(page)

      const addTrigger = page.getByRole("button", {
        name: "Add transaction",
        exact: true,
      })
      await addTrigger.focus()
      await addTrigger.click()
      const dialog = page.getByRole("dialog", { name: "Add transaction" })
      await expect(dialog).toBeVisible()
      const dialogAfterOpen = await activeElement(page)
      await page.keyboard.press("Escape")
      await expect(dialog).toBeHidden()
      const dialogAfterEscape = await activeElement(page)

      persistIn(directory, "interactive-focus-behavior", {
        viewport: page.viewportSize(),
        menu: {
          afterOpen: menuAfterOpen,
          tabs: menuTabs,
          afterEscape: menuAfterEscape,
        },
        dialog: {
          afterOpen: dialogAfterOpen,
          afterEscape: dialogAfterEscape,
        },
      })
    })
  }
})
