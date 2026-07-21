import { test, expect, type APIRequestContext } from "./fixtures"
import { getCsrfToken } from "./helpers"

async function createCategory(
  request: APIRequestContext,
  csrfToken: string,
  name: string,
  type: "expense" | "income"
): Promise<number> {
  const response = await request.post("/api/categories", {
    headers: { "X-CSRF-Token": csrfToken },
    data: {
      name,
      type,
      order: 0,
    },
  })
  expect(response.ok()).toBeTruthy()
  const payload = (await response.json()) as { id: number }
  return payload.id
}

async function createMonthlyBudgetTemplate(
  request: APIRequestContext,
  csrfToken: string,
  categoryId: number
): Promise<void> {
  const response = await request.post("/api/budgets/templates", {
    headers: { "X-CSRF-Token": csrfToken },
    data: {
      frequency: "monthly",
      category_id: categoryId,
      amount_cents: 9000,
      starts_on: "2025-01-01",
      ends_on: null,
    },
  })
  expect(response.ok()).toBeTruthy()
}

test.describe("Categories Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/categories")
  })

  test("should open the category editor from the page action", async ({ page }) => {
    await expect(page.getByTestId("category-library")).toBeVisible()
    await expect(page.getByRole("dialog", { name: "Add category" })).toBeHidden()
    await page.getByRole("button", { name: "Add category" }).first().click()
    await expect(page.getByRole("dialog", { name: "Add category" })).toBeVisible()
  })

  test("clears a failed create request when reopening the category editor", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryName = `E2E Duplicate Category ${Date.now()}`
    await createCategory(request, token, categoryName, "expense")

    await page.getByRole("button", { name: "Add category" }).first().click()
    let dialog = page.getByRole("dialog", { name: "Add category" })
    await dialog.getByRole("textbox", { name: "Name" }).fill(categoryName)
    await dialog.getByRole("button", { name: "Add category" }).click()
    await expect(dialog.locator(".text-semantic-red")).toBeVisible()

    await dialog.getByRole("button", { name: "Cancel" }).click()
    await page.getByRole("button", { name: "Add category" }).first().click()
    dialog = page.getByRole("dialog", { name: "Add category" })
    await expect(dialog.locator(".text-semantic-red")).toHaveCount(0)
  })

  test("should create category with icon selected from picker", async ({ page }) => {
    const categoryName = `E2E Icon ${Date.now()}`
    await page.getByRole("button", { name: "Add category" }).first().click()
    const dialog = page.getByRole("dialog", { name: "Add category" })
    await dialog.getByRole("textbox", { name: "Name" }).fill(categoryName)
    await dialog.getByLabel("Type").selectOption("expense")

    const createForm = dialog.locator("form")
    const iconGrid = createForm.locator("text=Icon").locator("..").locator("div.grid")
    await expect(iconGrid).toBeVisible()
    const iconButton = iconGrid.locator("button").first()
    await iconButton.click()
    await expect(iconButton).toHaveClass(/border-accent/)

    await dialog.getByRole("button", { name: "Add category" }).click()
    await expect(page.locator("body")).toContainText(categoryName)
  })

  test("should create category from Search all icon picker mode", async ({ page }) => {
    const categoryName = `E2E Search Icon ${Date.now()}`
    await page.getByRole("button", { name: "Add category" }).first().click()
    const dialog = page.getByRole("dialog", { name: "Add category" })
    await dialog.getByRole("textbox", { name: "Name" }).fill(categoryName)
    await dialog.getByLabel("Type").selectOption("expense")

    const createForm = dialog.locator("form")
    await createForm.getByRole("button", { name: "Search all" }).click()
    await createForm.getByRole("textbox", { name: "Search all icons" }).fill("pizza")
    await createForm.getByRole("button", { name: "Pick icon pizza" }).click()
    await expect(createForm).toContainText("Selected: pizza")

    await dialog.getByRole("button", { name: "Add category" }).click()
    await expect(page.locator("body")).toContainText(categoryName)
  })

  test("should create, archive, and restore a category", async ({ page }) => {
    const categoryName = `E2E Category ${Date.now()}`
    await page.getByRole("button", { name: "Add category" }).first().click()
    const dialog = page.getByRole("dialog", { name: "Add category" })
    await dialog.getByRole("textbox", { name: "Name" }).fill(categoryName)
    await dialog.getByLabel("Type").selectOption("expense")
    await dialog.getByRole("button", { name: "Add category" }).click()

    const activeRow = page.locator(".divide-y > div", { hasText: categoryName })
      .filter({ has: page.getByRole("button", { name: `Archive ${categoryName}` }) })
    await expect(activeRow).toBeVisible()
    await activeRow.getByRole("button", { name: `Archive ${categoryName}` }).click()

    const archivedRow = page.locator(".divide-y > div", { hasText: categoryName })
      .filter({ has: page.getByRole("button", { name: "Restore" }) })
    await expect(archivedRow).toBeVisible()
    await archivedRow.getByRole("button", { name: "Restore" }).dispatchEvent("click")

    await expect(page.locator("body")).toContainText(categoryName)
  })

  test("should edit a category on desktop", async ({ page }) => {
    const categoryName = `E2E Edit ${Date.now()}`
    const updatedName = `${categoryName} Updated`
    await page.getByRole("button", { name: "Add category" }).first().click()
    const createDialog = page.getByRole("dialog", { name: "Add category" })
    await createDialog.getByRole("textbox", { name: "Name" }).fill(categoryName)
    await createDialog.getByLabel("Type").selectOption("expense")
    await createDialog.getByRole("button", { name: "Add category" }).click()

    const activeRow = page.locator(".divide-y > div", { hasText: categoryName })
      .filter({ has: page.getByRole("button", { name: `Archive ${categoryName}` }) })
    await expect(activeRow).toBeVisible()
    await activeRow.getByRole("button", { name: `Edit ${categoryName}` }).click()

    const editDialog = page.getByRole("dialog", { name: "Edit category" })
    await expect(editDialog).toBeVisible()
    await editDialog.getByRole("textbox", { name: "Name" }).fill(updatedName)
    await editDialog.getByRole("button", { name: "Save changes" }).click()

    await expect(page.locator("body")).toContainText(updatedName)
  })

  test("should merge categories via in-app confirmation and show success feedback", async ({
    page,
    request,
  }) => {
    const csrfToken = await getCsrfToken(request)
    const suffix = Date.now()
    const sourceName = `E2E Merge Source ${suffix}`
    const targetName = `E2E Merge Target ${suffix}`
    const sourceId = await createCategory(request, csrfToken, sourceName, "expense")
    const targetId = await createCategory(request, csrfToken, targetName, "expense")

    await page.reload()
    await page.getByRole("combobox", { name: "Source" }).selectOption(String(sourceId))
    await page.getByRole("combobox", { name: "Target" }).selectOption(String(targetId))

    await page.getByRole("button", { name: "Preview", exact: true }).click()
    await expect(page.getByText("Transactions: 0")).toBeVisible()

    await page.getByRole("button", { name: "Merge", exact: true }).click()
    await expect(page.getByText("Confirm category merge")).toBeVisible()
    await page.getByRole("button", { name: "Confirm merge" }).click()

    await expect(
      page.getByText("Categories merged. Source category was archived.")
    ).toBeVisible()

    const archivedRow = page
      .locator(".divide-y > div", { hasText: sourceName })
      .filter({ has: page.getByRole("button", { name: "Restore" }) })
    await expect(archivedRow).toBeVisible()
  })

  test("should clear a stale preview error after a successful merge", async ({
    page,
    request,
  }) => {
    const csrfToken = await getCsrfToken(request)
    const suffix = Date.now()
    const sourceName = `E2E Preview Error Source ${suffix}`
    const targetName = `E2E Preview Error Target ${suffix}`
    const sourceId = await createCategory(request, csrfToken, sourceName, "expense")
    const targetId = await createCategory(request, csrfToken, targetName, "expense")

    let previewAttemptCount = 0
    await page.route("**/api/categories/merge/preview", async (route) => {
      previewAttemptCount += 1
      if (previewAttemptCount === 1) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Temporary preview failure" }),
        })
        return
      }
      await route.continue()
    })

    await page.reload()
    await page.getByRole("combobox", { name: "Source" }).selectOption(String(sourceId))
    await page.getByRole("combobox", { name: "Target" }).selectOption(String(targetId))

    await page.getByRole("button", { name: "Preview", exact: true }).click()
    await expect(page.getByText("Merge failed")).toBeVisible()
    await expect(page.getByText("Temporary preview failure")).toBeVisible()

    await page.getByRole("button", { name: "Merge", exact: true }).click()
    await expect(page.getByText("Confirm category merge")).toBeVisible()
    await page.getByRole("button", { name: "Confirm merge" }).click()

    await expect(
      page.getByText("Categories merged. Source category was archived.")
    ).toBeVisible()
    await expect(page.getByText("Merge failed")).not.toBeVisible()
    await expect(page.getByText("Temporary preview failure")).not.toBeVisible()
  })

  test("should show guarded budget conflict error when merge is blocked", async ({
    page,
    request,
  }) => {
    const csrfToken = await getCsrfToken(request)
    const suffix = Date.now()
    const sourceName = `E2E Conflict Source ${suffix}`
    const targetName = `E2E Conflict Target ${suffix}`
    const sourceId = await createCategory(request, csrfToken, sourceName, "expense")
    const targetId = await createCategory(request, csrfToken, targetName, "expense")
    await createMonthlyBudgetTemplate(request, csrfToken, sourceId)
    await createMonthlyBudgetTemplate(request, csrfToken, targetId)

    await page.reload()
    await page.getByRole("combobox", { name: "Source" }).selectOption(String(sourceId))
    await page.getByRole("combobox", { name: "Target" }).selectOption(String(targetId))

    await page.getByRole("button", { name: "Preview", exact: true }).click()
    await expect(page.getByText("Budget templates: 1")).toBeVisible()

    await page.getByRole("button", { name: "Merge", exact: true }).click()
    await page.getByRole("button", { name: "Confirm merge" }).click()

    await expect(page.getByText("Guarded budget conflict")).toBeVisible()
    await expect(page.getByText(/overlapping budget scopes/i)).toBeVisible()

    const activeRow = page
      .locator(".divide-y > div", { hasText: sourceName })
      .filter({ has: page.getByRole("button", { name: `Archive ${sourceName}` }) })
    await expect(activeRow).toBeVisible()
  })

})
