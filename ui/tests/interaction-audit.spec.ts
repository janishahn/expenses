import { expect, test } from "./fixtures"

test.describe("Desktop interaction audit", () => {
  test("the More sheet and add dialog stay inside the viewport and reachable at a 200% zoom-equivalent size", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 640, height: 400 })
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" })
    await page.addInitScript(() => {
      window.localStorage.setItem("ew.theme.preference", "light")
    })
    await page.goto("/transactions")

    await page
      .getByRole("navigation", { name: "Tabs" })
      .getByRole("button", { name: "More" })
      .click()
    const sheet = page.getByRole("dialog", { name: "More" })
    await expect(sheet).toBeVisible()
    const lastEntry = sheet.getByRole("menuitem", { name: "Sign out" })
    await lastEntry.scrollIntoViewIfNeeded()
    await expect(lastEntry).toBeInViewport()
    const sheetBox = await sheet.boundingBox()
    expect(sheetBox).not.toBeNull()
    expect(sheetBox!.y).toBeGreaterThanOrEqual(0)
    expect(sheetBox!.y + sheetBox!.height).toBeLessThanOrEqual(400)
    await page.keyboard.press("Escape")
    await expect(sheet).toBeHidden()

    await page.getByRole("button", { name: "Add transaction", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Add transaction" })
    await expect(dialog).toBeVisible()
    const dialogBox = await dialog.boundingBox()
    expect(dialogBox).not.toBeNull()
    expect(dialogBox!.y).toBeGreaterThanOrEqual(0)
    expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(400)
    for (const name of ["Close", "Add transaction"]) {
      const control = dialog.getByRole("button", { name, exact: true })
      await control.scrollIntoViewIfNeeded()
      await expect(control).toBeInViewport()
    }
  })
})
