import { test, expect } from "./fixtures"
import { getCsrfToken } from "./helpers"

test.describe("Tags Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/tags")
  })

  test("should show tags list or empty state", async ({ page }) => {
    await page.waitForLoadState("networkidle")
    await expect(page.getByTestId("tag-library")).toBeVisible()
    await expect(page.locator("main")).toContainText(/uses in period|No tags yet/)
    await expect(page.getByRole("button", { name: "Add tag" }).first()).toBeVisible()
    await expect(page.getByRole("button", { name: "Merge tags" })).toBeVisible()
  })

  test("should open tag creation and merge as separate modal workflows", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Merge tags" }).click()
    const mergeDialog = page.getByRole("dialog", { name: "Merge tags" })
    await expect(mergeDialog).toBeVisible()
    await expect(mergeDialog.getByLabel("Source")).toBeVisible()
    await page.keyboard.press("Escape")

    await page.getByRole("button", { name: "Add tag" }).first().click()
    await expect(page.getByRole("dialog", { name: "Add tag" })).toBeVisible()
  })

  test("clears a failed create request when reopening the tag editor", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const tagName = `E2E Duplicate Tag ${Date.now()}`
    const createResponse = await request.post("/api/tags", {
      headers: { "X-CSRF-Token": token },
      data: { name: tagName, is_hidden_from_budget: false },
    })
    expect(createResponse.ok()).toBeTruthy()

    await page.getByRole("button", { name: "Add tag" }).first().click()
    let dialog = page.getByRole("dialog", { name: "Add tag" })
    await dialog.getByLabel("Name").fill(tagName)
    await dialog.getByRole("button", { name: "Add tag" }).click()
    await expect(dialog.locator(".text-semantic-red")).toBeVisible()

    await dialog.getByRole("button", { name: "Cancel" }).click()
    await page.getByRole("button", { name: "Add tag" }).first().click()
    dialog = page.getByRole("dialog", { name: "Add tag" })
    await expect(dialog.locator(".text-semantic-red")).toHaveCount(0)
  })

  test("should create tag and navigate to tag detail", async ({ page }) => {
    const tagName = `E2E Tag ${Date.now()}`
    await page.getByRole("button", { name: "Add tag" }).first().click()
    const dialog = page.getByRole("dialog", { name: "Add tag" })
    await dialog.getByLabel("Name").fill(tagName)
    await dialog.getByRole("button", { name: "Add tag" }).click()

    const card = page.getByRole("link", { name: new RegExp(tagName) }).first()
    await expect(card).toBeVisible()
    await card.click()

    await expect(page).toHaveURL(/\/tags\/\d+/)
    await expect(page.locator("main h1")).toContainText(tagName)
    await expect(page.getByTestId("tag-detail-metrics")).toBeVisible()
    await expect(page.getByTestId("tag-activity-ledger")).toBeVisible()
    await expect(page.getByTestId("tag-settings-inspector")).toBeVisible()
  })
})
