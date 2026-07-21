import type { APIRequestContext } from "@playwright/test"
import { test, expect } from "./fixtures"
import { getCsrfToken } from "./helpers"

async function createExpenseCategory(
  request: APIRequestContext,
  csrfToken: string,
  name: string,
): Promise<number> {
  const response = await request.post("/api/categories", {
    headers: { "X-CSRF-Token": csrfToken },
    data: { name, type: "expense", order: 0 },
  })
  expect(response.ok()).toBeTruthy()
  return ((await response.json()) as { id: number }).id
}

test.describe("Budgets Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/budgets")
  })

  test("uses one period-based workspace and one budget editor", async ({
    page,
  }) => {
    await expect(page.getByRole("group", { name: "Budget view" })).toHaveCount(0)
    await expect(page.getByLabel("Budget month")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Monthly budgets" })).toBeVisible()
    await expect(page.getByRole("heading", { name: /Annual budgets/ })).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Manage recurring budgets" }),
    ).toHaveCount(0)

    await page.getByRole("button", { name: "Add budget" }).click()
    const dialog = page.getByRole("dialog", { name: "Add budget" })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel("Repeats")).toHaveValue("monthly")
    await expect(dialog.getByRole("button", { name: "Save budget" })).toBeVisible()
    await expect(dialog.getByText("Advanced timing")).toBeVisible()
  })

  test("creates a usual monthly budget that remains in the next month", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryName = `E2E Monthly Budget ${Date.now()}`
    const categoryId = await createExpenseCategory(request, token, categoryName)

    await page.reload()

    await page.getByRole("button", { name: "Add budget" }).click()
    const dialog = page.getByRole("dialog", { name: "Add budget" })
    await dialog.getByLabel("Category").selectOption(String(categoryId))
    await dialog.getByLabel("Amount").fill("321.00")
    await dialog.getByRole("button", { name: "Save budget" }).click()

    let row = page.getByTestId("budget-plan-card").filter({ hasText: categoryName })
    await expect(row).toContainText("321,00 € per month")
    await expect(row.getByRole("progressbar")).toBeVisible()
    await expect(row.getByTestId("category-icon")).toBeVisible()

    await page.getByRole("button", { name: "Next month" }).click()
    row = page.getByTestId("budget-plan-card").filter({ hasText: categoryName })
    await expect(row).toContainText("321,00 € per month")
  })

  test("applies a row edit to only the selected month by default", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryName = `E2E Month Adjustment ${Date.now()}`
    const categoryId = await createExpenseCategory(request, token, categoryName)
    await page.reload()
    await page.getByRole("button", { name: "Add budget" }).click()
    const createDialog = page.getByRole("dialog", { name: "Add budget" })
    await createDialog.getByLabel("Category").selectOption(String(categoryId))
    await createDialog.getByLabel("Amount").fill("300.00")
    await createDialog.getByRole("button", { name: "Save budget" }).click()

    let row = page.getByTestId("budget-plan-card").filter({ hasText: categoryName })
    await row.getByRole("button", { name: "Edit" }).click()
    const dialog = page.getByRole("dialog", { name: `Edit ${categoryName}` })
    await expect(dialog.getByRole("radio", { name: /Only / })).toBeChecked()
    await dialog.getByRole("textbox", { name: /Amount/ }).fill("450.00")
    await dialog.getByRole("button", { name: "Save change" }).click()

    row = page.getByTestId("budget-plan-card").filter({ hasText: categoryName })
    await expect(row).toContainText("450,00 €")
    await expect(row).toContainText("Adjusted this month · usually 300,00 €")

    await page.getByRole("button", { name: "Next month" }).click()
    row = page.getByTestId("budget-plan-card").filter({ hasText: categoryName })
    await expect(row).toContainText("300,00 € per month")
    await expect(row).not.toContainText("Adjusted this month")
  })

  test("keeps existing templates and month overrides intact and resettable", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryName = `E2E Existing Budget ${Date.now()}`
    const categoryId = await createExpenseCategory(request, token, categoryName)
    const oneOffCategoryName = `E2E Existing One-Off ${Date.now()}`
    const oneOffCategoryId = await createExpenseCategory(
      request,
      token,
      oneOffCategoryName,
    )
    const currentMonth = new Date().toISOString().slice(0, 7)
    const [year, month] = currentMonth.split("-").map(Number)
    expect(
      (
        await request.post("/api/budgets/templates", {
          headers: { "X-CSRF-Token": token },
          data: {
            frequency: "monthly",
            category_id: categoryId,
            amount_cents: 50_000,
            starts_on: `${currentMonth}-01`,
            ends_on: null,
          },
        })
      ).ok(),
    ).toBeTruthy()
    expect(
      (
        await request.post("/api/budgets/overrides", {
          headers: { "X-CSRF-Token": token },
          data: {
            year,
            month,
            category_id: categoryId,
            amount_cents: 70_000,
          },
        })
      ).ok(),
    ).toBeTruthy()
    expect(
      (
        await request.post("/api/budgets/overrides", {
          headers: { "X-CSRF-Token": token },
          data: {
            year,
            month,
            category_id: oneOffCategoryId,
            amount_cents: 22_000,
          },
        })
      ).ok(),
    ).toBeTruthy()

    await page.reload()
    let row = page.getByTestId("budget-plan-card").filter({ hasText: categoryName })
    await expect(row).toContainText("700,00 €")
    await expect(row).toContainText("usually 500,00 €")
    const oneOffRow = page
      .getByTestId("budget-plan-card")
      .filter({ hasText: oneOffCategoryName })
    await expect(oneOffRow).toContainText("220,00 €")
    await expect(oneOffRow).toContainText(`Only ${new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" })}`)
    await row.getByRole("button", { name: /Reset to 500,00/ }).click()

    row = page.getByTestId("budget-plan-card").filter({ hasText: categoryName })
    await expect(row).toContainText("500,00 € per month")
    await expect(row).not.toContainText("Adjusted this month")
  })

  test("shows existing yearly budgets and creates annual budgets in place", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const currentYear = new Date().getFullYear()
    const existingCategoryName = `E2E Existing Annual ${Date.now()}`
    const existingCategoryId = await createExpenseCategory(
      request,
      token,
      existingCategoryName,
    )
    const categoryName = `E2E Annual Budget ${Date.now()}`
    const categoryId = await createExpenseCategory(request, token, categoryName)
    const existingResponse = await request.post("/api/budgets/templates", {
      headers: { "X-CSRF-Token": token },
      data: {
        frequency: "yearly",
        category_id: existingCategoryId,
        amount_cents: 480_000,
        starts_on: `${currentYear}-01-01`,
        ends_on: null,
      },
    })
    expect(existingResponse.ok()).toBeTruthy()

    await page.reload()

    const existingRow = page
      .getByTestId("budget-year-plan-card")
      .filter({ hasText: existingCategoryName })
    await expect(existingRow).toContainText(/4\s800,00 € per year/)

    await page.getByRole("button", { name: "Add annual" }).click()
    const dialog = page.getByRole("dialog", { name: "Add annual budget" })
    await expect(dialog.getByLabel("Repeats")).toHaveValue("yearly")
    await dialog.getByLabel("Category").selectOption(String(categoryId))
    await dialog.getByLabel("Amount").fill("6000")
    await dialog.getByRole("button", { name: "Save budget" }).click()

    const row = page
      .getByTestId("budget-year-plan-card")
      .filter({ hasText: categoryName })
    await expect(row).toContainText(/6\s000,00 € per year/)
    await expect(row.getByRole("progressbar")).toBeVisible()
  })

  test("does not assign a pace before a future budget month starts", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await createExpenseCategory(
      request,
      token,
      `E2E Future Budget ${Date.now()}`,
    )
    const templateResponse = await request.post("/api/budgets/templates", {
      headers: { "X-CSRF-Token": token },
      data: {
        frequency: "monthly",
        category_id: categoryId,
        amount_cents: 50_000,
        starts_on: "2099-12-01",
        ends_on: null,
      },
    })
    expect(templateResponse.ok()).toBeTruthy()

    await page.goto("/budgets?month=2099-12")
    const pace = page.getByTestId("budget-summary-pace")
    await expect(pace).toContainText("Pacing has not started for December 2099")
    await expect(pace).not.toContainText("Under pace")
  })

  test("expands budget burn-down details", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryName = `E2E Burndown ${Date.now()}`
    const categoryId = await createExpenseCategory(request, token, categoryName)

    await page.reload()

    await page.getByRole("button", { name: "Add budget" }).click()
    const dialog = page.getByRole("dialog", { name: "Add budget" })
    await dialog.getByLabel("Category").selectOption(String(categoryId))
    await dialog.getByLabel("Amount").fill("400.00")
    await dialog.getByRole("button", { name: "Save budget" }).click()
    await request.post("/api/transactions", {
      headers: { "X-CSRF-Token": token },
      data: {
        date: new Date().toISOString().slice(0, 10),
        occurred_at: new Date().toISOString(),
        type: "expense",
        amount_cents: 50_000,
        category_id: categoryId,
        title: `E2E Burndown Day ${Date.now()}`,
        tags: [],
      },
    })

    await page.reload()
    const row = page.getByTestId("budget-plan-card").filter({ hasText: categoryName })
    await expect(row.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100")
    await expect(row.getByRole("progressbar")).toHaveAttribute(
      "aria-valuetext",
      "125% used",
    )
    await row.getByRole("button", { name: "View details" }).click()
    await expect(row.getByText("Top spending days")).toBeVisible()
    await expect(row.getByText("Best / worst day")).toBeVisible()
  })
})
