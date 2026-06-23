import { test, expect } from "@playwright/test"
import { ensureCategory, getCsrfToken } from "./helpers"

test.describe("Templates Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/templates")
  })

  test("should create a template", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Tmpl Create")
    const templateName = `E2E Template ${Date.now()}`

    const response = await request.post("/api/templates", {
      headers: { "X-CSRF-Token": token },
      data: {
        name: templateName,
        type: "expense",
        category_id: categoryId,
        default_amount_cents: 425,
        title: "Test title",
        tags: ["daily", "coffee"],
      },
    })
    expect(response.ok()).toBeTruthy()

    await page.reload()

    const row = page.locator("div.divide-y > div", { hasText: templateName }).first()
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

    const row = page.locator("div.divide-y > div", { hasText: originalName }).first()
    await expect(row).toBeVisible()
    await row.getByRole("button", { name: "Edit", exact: true }).click()

    await expect(page.getByLabel("Name")).toHaveValue(originalName)
    const updatedName = `${originalName} Updated`
    await page.getByLabel("Name").fill(updatedName)
    await page.getByLabel("Default amount").fill("7.50")
    await page.getByRole("button", { name: "Save template" }).click()

    const updatedRow = page
      .locator("div.divide-y > div", { hasText: updatedName })
      .first()
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

    const row = page.locator("div.divide-y > div", { hasText: templateName }).first()
    await expect(row).toBeVisible()
    const deleteButton = row.getByRole("button", { name: "Delete", exact: true })
    await expect(deleteButton).toHaveClass(
      /btn-inline-danger/
    )
    await expect(deleteButton.locator("svg")).toBeVisible()

    page.once("dialog", (dialog) => dialog.accept())
    await deleteButton.click()

    await expect(row).toBeHidden()
  })

})
