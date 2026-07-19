import { expect, test } from "./fixtures"
import { ensureCategory, getCsrfToken } from "./helpers"

test.describe("Organization surfaces (mobile)", () => {
  test("creates a tag and updates it from the detail surface", async ({ page }) => {
    const tagName = `Mobile tag ${Date.now()}`
    await page.goto("/tags")
    await page.getByRole("button", { name: "Add tag" }).first().click()
    const dialog = page.getByRole("dialog", { name: "Add tag" })
    await dialog.getByLabel("Name").fill(tagName)
    await dialog.getByRole("button", { name: "Add tag" }).click()

    await page.getByRole("link", { name: new RegExp(tagName) }).first().click()
    await expect(page).toHaveURL(/\/tags\/\d+/)
    await expect(page.getByTestId("tag-settings-inspector")).toBeVisible()

    const updatedName = `${tagName} updated`
    await page.getByLabel("Name").fill(updatedName)
    await page.getByRole("button", { name: "Save changes" }).click()
    await expect(page.getByRole("heading", { name: updatedName })).toBeVisible()
  })

  test("creates and edits a transaction template", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(
      request,
      token,
      "expense",
      "Mobile template"
    )
    const name = `Mobile template ${Date.now()}`

    await page.goto("/templates")
    await page.getByRole("button", { name: "Add template" }).first().click()
    const addDialog = page.getByRole("dialog", { name: "Add template" })
    await addDialog.getByLabel("Name").fill(name)
    await addDialog.getByLabel("Category").selectOption(String(categoryId))
    await addDialog.getByLabel("Default amount (optional)").fill("4.25")
    await addDialog.getByRole("button", { name: "Add template" }).click()

    const row = page.getByTestId("template-row").filter({ hasText: name })
    await expect(row).toBeVisible()
    await row.getByRole("button", { name: `Edit ${name}` }).click()
    const editDialog = page.getByRole("dialog", { name: "Edit template" })
    await editDialog.getByLabel("Name").fill(`${name} updated`)
    await editDialog.getByRole("button", { name: "Save changes" }).click()
    await expect(
      page.getByTestId("template-row").filter({ hasText: `${name} updated` })
    ).toBeVisible()
  })

  test("creates and toggles a categorization rule", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    await ensureCategory(request, token, "expense", "Mobile rule")
    const name = `Mobile rule ${Date.now()}`

    await page.goto("/rules")
    await page.getByRole("button", { name: "Add rule" }).first().click()
    const dialog = page.getByRole("dialog", { name: "Add rule" })
    await dialog.getByLabel("Name").fill(name)
    await dialog.getByLabel("Title text").fill("mobile-rule")
    await dialog.getByRole("button", { name: "Add rule" }).click()

    const card = page.getByTestId("automation-rule").filter({ hasText: name })
    const toggle = card.getByRole("switch")
    await expect(toggle).toBeVisible()
    const initialState = await toggle.getAttribute("aria-checked")
    await toggle.click()
    await expect(toggle).toHaveAttribute(
      "aria-checked",
      initialState === "true" ? "false" : "true"
    )
  })
})
