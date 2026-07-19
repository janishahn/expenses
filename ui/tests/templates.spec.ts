import { test, expect } from "./fixtures"
import { ensureCategory, getCsrfToken } from "./helpers"

test.describe("Templates Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/templates")
  })

  test("uses a compact sortable library with a modal editor", async ({ page }) => {
    await expect(page.getByTestId("template-library")).toBeVisible()
    await expect(page.getByRole("dialog", { name: "Add template" })).toBeHidden()
    await page.getByRole("button", { name: "Add template" }).first().click()
    await expect(page.getByRole("dialog", { name: "Add template" })).toBeVisible()
  })

  test("should create a template", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Tmpl Create")
    const templateName = `E2E Template ${Date.now()}`

    await page.reload()
    await page.getByRole("button", { name: "Add template" }).first().click()
    const dialog = page.getByRole("dialog", { name: "Add template" })
    await dialog.getByLabel("Name").fill(templateName)
    await dialog.getByLabel("Category").selectOption(String(categoryId))
    await dialog.getByLabel("Default amount (optional)").fill("4.25")
    await dialog.getByLabel("Title (optional)").fill("Test title")
    await dialog.getByLabel("Tags (comma-separated)").fill("daily, coffee")
    await dialog.getByRole("button", { name: "Add template" }).click()

    const row = page.getByTestId("template-row").filter({ hasText: templateName })
    await expect(row).toBeVisible()
    await expect(row).toContainText("daily")
    await expect(row).toContainText("coffee")
  })

  test("should edit a template", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Tmpl Edit")
    const originalName = `E2E Edit ${Date.now()}`

    await request.post("/api/templates", {
      headers: { "X-CSRF-Token": token },
      data: {
        name: originalName,
        type: "expense",
        category_id: categoryId,
        default_amount_cents: 500,
        title: "Original title",
        tags: ["original"],
      },
    })
    await page.reload()

    const row = page.getByTestId("template-row").filter({ hasText: originalName })
    await expect(row).toBeVisible()
    await row.getByRole("button", { name: `Edit ${originalName}` }).click()

    const dialog = page.getByRole("dialog", { name: "Edit template" })
    await expect(dialog.getByLabel("Name")).toHaveValue(originalName)
    const updatedName = `${originalName} Updated`
    await dialog.getByLabel("Name").fill(updatedName)
    await dialog.getByLabel("Default amount (optional)").fill("7.50")
    await dialog.getByRole("button", { name: "Save changes" }).click()

    const updatedRow = page.getByTestId("template-row").filter({ hasText: updatedName })
    await expect(updatedRow).toBeVisible()
  })

  test("should delete a template", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Tmpl Del")
    const templateName = `E2E Delete ${Date.now()}`

    await request.post("/api/templates", {
      headers: { "X-CSRF-Token": token },
      data: {
        name: templateName,
        type: "expense",
        category_id: categoryId,
        default_amount_cents: null,
        title: null,
        tags: [],
      },
    })
    await page.reload()

    const row = page.getByTestId("template-row").filter({ hasText: templateName })
    await expect(row).toBeVisible()
    const deleteButton = row.getByRole("button", { name: `Delete ${templateName}` })
    await expect(deleteButton).toHaveClass(
      /btn-inline-danger/
    )
    await expect(deleteButton.locator("svg")).toBeVisible()

    page.once("dialog", (dialog) => dialog.accept())
    await deleteButton.click()

    await expect(row).toBeHidden()
  })

  test("should reorder templates by dragging the dedicated handle", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Tmpl Sort")
    const firstName = `E2E Sort A ${Date.now()}`
    const secondName = `E2E Sort B ${Date.now()}`

    for (const name of [firstName, secondName]) {
      const response = await request.post("/api/templates", {
        headers: { "X-CSRF-Token": token },
        data: {
          name,
          type: "expense",
          category_id: categoryId,
          default_amount_cents: null,
          title: null,
          tags: [],
        },
      })
      expect(response.ok()).toBeTruthy()
    }
    await page.reload()

    const firstRow = page.getByTestId("template-row").filter({ hasText: firstName })
    const secondRow = page.getByTestId("template-row").filter({ hasText: secondName })
    await expect(firstRow).toBeVisible()
    await expect(secondRow).toBeVisible()
    const initialRowTexts = await page.getByTestId("template-row").allTextContents()
    expect(initialRowTexts.findIndex((text) => text.includes(firstName))).toBeLessThan(
      initialRowTexts.findIndex((text) => text.includes(secondName))
    )

    const reorderResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/templates/reorder" &&
        response.request().method() === "POST"
    )
    const handle = firstRow.getByRole("button", { name: `Reorder ${firstName}` })
    const handleBox = await handle.boundingBox()
    const targetBox = await secondRow.boundingBox()
    expect(handleBox).not.toBeNull()
    expect(targetBox).not.toBeNull()
    await page.mouse.move(
      handleBox!.x + handleBox!.width / 2,
      handleBox!.y + handleBox!.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(
      targetBox!.x + targetBox!.width / 2,
      targetBox!.y + targetBox!.height / 2,
      { steps: 8 }
    )
    await page.mouse.up()
    await reorderResponse

    const rows = page.getByTestId("template-row")
    const rowTexts = await rows.allTextContents()
    expect(rowTexts.findIndex((text) => text.includes(secondName))).toBeLessThan(
      rowTexts.findIndex((text) => text.includes(firstName))
    )
  })

})
