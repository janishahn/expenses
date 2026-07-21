import { expect, test } from "./fixtures"

test.describe("Categories Page (mobile)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/categories")
  })

  test("edits a category in the mobile modal", async ({ page }) => {
    const categoryName = `E2E Mobile Edit ${Date.now()}`
    const updatedName = `${categoryName} Updated`
    await page.getByRole("button", { name: "Add category" }).first().click()
    const createDialog = page.getByRole("dialog", { name: "Add category" })
    await createDialog.getByRole("textbox", { name: "Name" }).fill(categoryName)
    await createDialog.getByLabel("Type").selectOption("expense")
    const categoriesRefresh = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/categories" &&
        response.request().method() === "GET" &&
        response.status() === 200
    )
    await createDialog.getByRole("button", { name: "Add category" }).click()
    await categoriesRefresh

    const activeRow = page
      .locator(".divide-y > div", { hasText: categoryName })
      .filter({ has: page.getByRole("button", { name: `Archive ${categoryName}` }) })
    await expect(activeRow).toBeVisible()

    await activeRow.getByRole("button", { name: `Edit ${categoryName}` }).click()

    const modal = page.getByRole("dialog", { name: "Edit category" })
    await expect(modal).toBeVisible()
    await modal.getByRole("textbox", { name: "Name" }).fill(updatedName)
    await modal.getByRole("button", { name: "Save changes" }).click()
    await expect(modal).not.toBeVisible()

    await expect(page.locator("body")).toContainText(updatedName)
  })
})
