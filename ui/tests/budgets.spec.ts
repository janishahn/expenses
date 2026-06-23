import { test, expect } from "@playwright/test"
import { ensureCategory, getCsrfToken } from "./helpers"

test.describe("Budgets Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/budgets")
  })

  test("should use one shared month selector and a sticky desktop editor", async ({
    page,
  }) => {
    await page.goto("/budgets")
    await page.waitForLoadState("networkidle")

    await expect(page.locator('input[type="month"]')).toHaveCount(1)
    await expect(
      page.getByRole("button", { name: "Manage recurring budgets" }).first(),
    ).toBeVisible()

    const editorPosition = await page
      .getByRole("button", { name: "Save month budget" })
      .evaluate((node) => {
        const form = node.closest("form")
        return form ? getComputedStyle(form).position : null
      })
    expect(editorPosition).toBe("sticky")
  })

  test("should create a month budget", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Budget")

    await page.goto("/budgets")
    await page.getByLabel("Category").selectOption(String(categoryId))
    await page.getByLabel("Amount").fill("321.00")
    await page.getByRole("button", { name: "Save month budget" }).click()

    const row = page.locator("div.rounded-lg", { hasText: "321,00" }).first()
    await expect(page.locator("body")).toContainText("321,00")
    const removeButton = row.getByRole("button", { name: "Remove month budget" })
    await expect(removeButton).toBeVisible()
    await expect(removeButton).toHaveClass(/btn-inline-danger/)
    await expect(removeButton.locator("svg")).toBeVisible()
  })

  test("should expand budget burn-down chart", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E BurnDown")

    await request.post("/api/budgets/templates", {
      headers: { "X-CSRF-Token": token },
      data: {
        frequency: "monthly",
        category_id: categoryId,
        amount_cents: 40_000,
        starts_on: `${new Date().toISOString().slice(0, 7)}-01`,
        ends_on: null,
      },
    })
    await request.post("/api/transactions", {
      headers: { "X-CSRF-Token": token },
      data: {
        date: new Date().toISOString().slice(0, 10),
        occurred_at: new Date().toISOString(),
        type: "expense",
        amount_cents: 4_500,
        category_id: categoryId,
        title: `E2E Burndown Day ${Date.now()}`,
        tags: [],
      },
    })

    await page.goto("/budgets")
    await page.getByRole("button", { name: "Show chart" }).first().click()
    await expect(page.locator("text=Top spending days")).toBeVisible()
    await expect(page.locator("text=Best / Worst day")).toBeVisible()
    await expect(page.locator("body")).toContainText("Budget")
  })
})
