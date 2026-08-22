import { expect, test } from "./fixtures"
import { ensureCategory, getCsrfToken } from "./helpers"

test.describe("Organization surfaces (mobile)", () => {
  test("creates a tag and updates it from the detail surface", async ({ page }) => {
    const tagName = `Mobile tag ${Date.now()}`
    await page.goto("/tags")
    await page.getByRole("button", { name: "Add tag" }).first().click()
    const dialog = page.getByRole("dialog", { name: "Add tag" })
    await dialog.getByLabel("Name").fill(tagName)
    await dialog
      .locator("label", { hasText: "Automatically add during a date range" })
      .getByRole("switch")
      .click()
    await dialog.getByLabel("Start date").fill("2026-08-10")
    await dialog.getByLabel("End date").fill("2026-08-17")
    await dialog.getByRole("button", { name: "Add tag" }).click()

    await page.getByRole("link", { name: new RegExp(tagName) }).first().click()
    await expect(page).toHaveURL(/\/tags\/\d+/)
    const settings = page.getByTestId("tag-settings-inspector")
    await expect(settings).toBeVisible()
    await expect(settings).toContainText("10.08.2026–17.08.2026")
    await expect(page.getByLabel("Name")).toHaveCount(0)

    const archiveAction = settings.getByRole("button", { name: "Archive" })
    const editAction = settings.getByRole("button", { name: "Edit tag" })
    await expect(archiveAction).toHaveText("")
    await expect(editAction).toHaveText("")
    const [archiveBox, editBox] = await Promise.all([
      archiveAction.boundingBox(),
      editAction.boundingBox(),
    ])
    expect(archiveBox).not.toBeNull()
    expect(editBox).not.toBeNull()
    expect(Math.abs(archiveBox!.y - editBox!.y)).toBeLessThanOrEqual(1)

    await editAction.click()
    const editDialog = page.getByRole("dialog", { name: "Edit tag" })
    await expect(editDialog.getByLabel("Start date")).toHaveValue("2026-08-10")
    await expect(editDialog.getByLabel("End date")).toHaveValue("2026-08-17")
    const datePadding = await editDialog.getByLabel("Start date").evaluate((input) => {
      const style = window.getComputedStyle(input)
      return [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft]
    })
    expect(datePadding).toEqual(["0px", "0px", "0px", "0px"])
    const datePanel = editDialog.getByLabel("Start date").locator("xpath=../..")
    const dateFieldBounds = await datePanel.evaluate((panel) => {
      const panelBounds = panel.getBoundingClientRect()
      return Array.from(panel.querySelectorAll('input[type="date"]')).map((input) => {
        const inputBounds = input.getBoundingClientRect()
        return {
          inputLeft: inputBounds.left,
          inputRight: inputBounds.right,
          panelLeft: panelBounds.left,
          panelRight: panelBounds.right,
        }
      })
    })
    expect(dateFieldBounds).toHaveLength(2)
    for (const bounds of dateFieldBounds) {
      expect(bounds.inputLeft).toBeGreaterThanOrEqual(bounds.panelLeft - 1)
      expect(bounds.inputRight).toBeLessThanOrEqual(bounds.panelRight + 1)
    }

    const updatedName = `${tagName} updated`
    await editDialog.getByLabel("Name").fill(updatedName)
    await editDialog
      .locator("label", { hasText: "Hide from filter menus" })
      .getByRole("switch")
      .click()
    await editDialog.getByRole("button", { name: "Save" }).click()
    await expect(page.getByRole("heading", { name: updatedName })).toBeVisible()
    await expect(settings).toContainText("Hidden from filter menus")

    await archiveAction.click()
    await expect(settings.getByRole("button", { name: "Restore" })).toBeVisible()
    await expect(settings).toContainText("Lifecycle")
    await expect(settings).toContainText(/Archived \d{2}\.\d{2}\.\d{4}/)

    await page.goto("/tags?period=all")
    const archivedLibrary = page.getByTestId("archived-tag-library")
    await expect(archivedLibrary).toContainText(updatedName)
    await archivedLibrary.getByRole("link", { name: new RegExp(updatedName) }).click()
    await settings.getByRole("button", { name: "Restore" }).click()
    await expect(settings.getByRole("button", { name: "Archive" })).toBeVisible()
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
