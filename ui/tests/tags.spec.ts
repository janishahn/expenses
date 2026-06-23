import { test, expect } from "@playwright/test"

test.describe("Tags Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/tags")
  })

  test("should show tags list or empty state", async ({ page }) => {
    await page.waitForLoadState("networkidle")
    await expect(page.locator("main")).toContainText(/uses in period|No tags yet/)
  })

  test("should create tag and navigate to tag detail", async ({ page }) => {
    const tagName = `E2E Tag ${Date.now()}`
    await page.getByLabel("Name").fill(tagName)
    await page.getByRole("button", { name: "Create tag" }).click()

    const card = page.getByRole("link", { name: new RegExp(tagName) }).first()
    await expect(card).toBeVisible()
    await card.click()

    await expect(page).toHaveURL(/\/tags\/\d+/)
    await expect(page.locator("main h1")).toContainText(tagName)
  })
})
