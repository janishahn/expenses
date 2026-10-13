import { mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { expect, test } from "./fixtures"

test("mobile More sheet and controlled overlays preserve modal focus", async ({
  browserName,
  page,
}) => {
  const artifactDirectory = process.env.UI_POLISH_AUDIT_ARTIFACT_DIR
    ? resolve(
        "..",
        process.env.UI_POLISH_AUDIT_ARTIFACT_DIR,
        "repairs",
        "R-001",
        browserName === "webkit" ? "mobile-webkit" : "mobile-chromium-fallback",
      )
    : null
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" })
  await page.addInitScript(() => {
    window.localStorage.setItem("ew.theme.preference", "light")
  })
  await page.goto("/transactions")

  if (browserName === "webkit") {
    const menuTrigger = page
      .getByRole("navigation", { name: "Tabs" })
      .getByRole("button", { name: "More" })
    await menuTrigger.tap()
    const menu = page.getByRole("dialog", { name: "More" })
    await expect(menu).toBeVisible()
    await page.mouse.click(187, 40)
    await expect(menu).toBeHidden()

    await page.getByRole("button", { name: "Add transaction", exact: true }).tap()
    const addDialog = page.getByRole("dialog", { name: "Add transaction" })
    await expect(addDialog).toBeVisible()
    await addDialog.getByRole("button", { name: "Close" }).tap()
    await expect(addDialog).toBeHidden()

    await page.getByRole("button", { name: /^Filter/ }).tap()
    const filtersSheet = page.getByRole("dialog", { name: "Filter" })
    await expect(filtersSheet).toBeVisible()
    await page.mouse.click(187, 40)
    await expect(filtersSheet).toBeHidden()

    await page.goto("/categories")
    await page.getByRole("button", { name: "Add category" }).first().tap()
    const categoryDialog = page.getByRole("dialog", { name: "Add category" })
    await expect(categoryDialog).toBeVisible()
    await categoryDialog.getByRole("button", { name: "Close category editor" }).tap()
    await expect(categoryDialog).toBeHidden()

    if (artifactDirectory) {
      mkdirSync(artifactDirectory, { recursive: true })
      await page.screenshot({
        path: resolve(artifactDirectory, "mobile-overlay-touch-dismissal.png"),
        fullPage: true,
        animations: "disabled",
      })
    }
    return
  }

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
  await page.mouse.click(187, 40)
  await expect(menu).toBeHidden()
  await expect(menuTrigger).toBeFocused()

  const addTrigger = page.getByRole("button", {
    name: "Add transaction",
    exact: true,
  })
  await addTrigger.focus()
  await addTrigger.press("Enter")
  const addDialog = page.getByRole("dialog", { name: "Add transaction" })
  await expect(addDialog).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(addDialog).toBeHidden()
  await expect(addTrigger).toBeFocused()
  await page.locator('[data-slot="dialog-overlay"]').waitFor({ state: "detached" })
  await page.waitForTimeout(500)

  const filtersTrigger = page.getByRole("button", { name: /^Filter/ })
  await filtersTrigger.focus()
  await filtersTrigger.press("Enter")
  const filtersSheet = page.getByRole("dialog", { name: "Filter" })
  await expect(filtersSheet).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(filtersSheet).toBeHidden()
  await expect(filtersTrigger).toBeFocused()

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
      path: resolve(artifactDirectory, "mobile-focus-return.png"),
      fullPage: true,
      animations: "disabled",
    })
  }
})
