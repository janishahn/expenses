import { mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { expect, test } from "./fixtures"
import { waitForEntrance } from "./helpers"

test("mobile More sheet and controlled overlays preserve modal focus", async ({ page }) => {
  const artifactDirectory = process.env.UI_POLISH_AUDIT_ARTIFACT_DIR
    ? resolve("..", process.env.UI_POLISH_AUDIT_ARTIFACT_DIR, "repairs", "R-001", "mobile-webkit")
    : null
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" })
  await page.addInitScript(() => {
    window.localStorage.setItem("ew.theme.preference", "light")
  })
  await page.goto("/transactions")

  const menuTrigger = page
    .getByRole("navigation", { name: "Tabs" })
    .getByRole("button", { name: "More" })
  await menuTrigger.tap()
  const menu = page.getByRole("dialog", { name: "More" })
  await expect(menu).toBeVisible()
  await waitForEntrance(menu)
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

  await menuTrigger.tap()
  await expect(menu).toBeVisible()
  await waitForEntrance(menu)
  await page.mouse.click(187, 40)
  await expect(menu).toBeHidden()
  await expect(menuTrigger).toBeFocused()

  const addTrigger = page.getByRole("button", { name: "Add transaction", exact: true })
  // WebKit does not focus a tapped button, so openers are focused first, as a keyboard user would.
  await addTrigger.focus()
  await addTrigger.press("Enter")
  const addDialog = page.getByRole("dialog", { name: "Add transaction" })
  await expect(addDialog).toBeVisible()
  await waitForEntrance(addDialog)
  await addDialog.getByRole("button", { name: "Close" }).tap()
  await expect(addDialog).toBeHidden()
  await expect(addTrigger).toBeFocused()

  const filtersTrigger = page.getByRole("button", { name: /^Filter/ })
  await filtersTrigger.focus()
  await filtersTrigger.press("Enter")
  const filtersSheet = page.getByRole("dialog", { name: "Filter" })
  await expect(filtersSheet).toBeVisible()
  await waitForEntrance(filtersSheet)
  await page.mouse.click(187, 40)
  await expect(filtersSheet).toBeHidden()
  await expect(filtersTrigger).toBeFocused()

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
      path: resolve(artifactDirectory, "mobile-focus-return.png"),
      fullPage: true,
      animations: "disabled",
    })
  }
})
