import { expect, test } from "@playwright/test"

test.describe("Categories Page (mobile)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/categories")
  })

  test("edits a category in the mobile modal", async ({ page }) => {
    const categoryName = `E2E Mobile Edit ${Date.now()}`
    const updatedName = `${categoryName} Updated`
    await page.getByRole("textbox", { name: "Name" }).fill(categoryName)
    await page.getByLabel("Type").selectOption("expense")
    await page.getByRole("button", { name: "Create category" }).click()

    const activeRow = page
      .locator(".divide-y > div", { hasText: categoryName })
      .filter({ has: page.getByRole("button", { name: "Archive" }) })
    await expect(activeRow).toBeVisible()

    const editButtons = activeRow.getByRole("button", { name: "Edit" })
    const firstVisible = await editButtons.first().isVisible()
    await (firstVisible ? editButtons.first() : editButtons.nth(1)).click()

    const modal = page.getByRole("dialog", { name: "Edit category" })
    await expect(modal).toBeVisible()
    await modal.getByRole("textbox", { name: "Name" }).fill(updatedName)
    await modal.getByRole("button", { name: "Save changes" }).click()
    await expect(modal).not.toBeVisible()

    await expect(page.locator("body")).toContainText(updatedName)
  })
})
