import { test, expect, type APIRequestContext, type Page } from "./fixtures"
import { createCategory, createTransaction, getCsrfToken } from "./helpers"

type StoredCategory = {
  id: number
  name: string
  type: string
  icon: string | null
  order: number | null
  archived_at: string | null
}

async function fetchCategory(
  request: APIRequestContext,
  name: string,
): Promise<StoredCategory | undefined> {
  const response = await request.get("/api/categories?period=all")
  expect(response.ok()).toBeTruthy()
  const { categories } = (await response.json()) as { categories: StoredCategory[] }
  return categories.find((category) => category.name === name)
}

async function createMonthlyBudgetTemplate(
  request: APIRequestContext,
  csrfToken: string,
  categoryId: number,
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

function categoryRow(page: Page, name: string) {
  return page.getByRole("list", { name: "Categories" }).getByRole("listitem", { name, exact: true })
}

test.describe("Categories Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/categories")
    await expect(page.getByRole("heading", { name: "Categories", level: 1 })).toBeVisible()
  })

  test("creates, renames, archives with Undo and restores a category", async ({
    page,
    request,
  }) => {
    const createdName = `E2E Category ${Date.now()}`
    const categoryName = `${createdName} Renamed`
    await page.getByRole("button", { name: "Add category" }).first().click()
    const dialog = page.getByRole("dialog", { name: "Add category" })
    await dialog.getByRole("textbox", { name: "Name" }).fill(createdName)
    await dialog.getByRole("button", { name: "Add category" }).click()

    await categoryRow(page, createdName).click()
    const created = page.getByRole("complementary", { name: createdName })
    await created.getByRole("button", { name: "Edit Name" }).click()
    await created.getByRole("textbox", { name: "Name" }).fill(categoryName)
    await created.getByRole("textbox", { name: "Name" }).press("Enter")
    await expect(categoryRow(page, categoryName)).toBeVisible()
    await expect.poll(async () => (await fetchCategory(request, categoryName))?.type).toBe("expense")
    expect(await fetchCategory(request, createdName)).toBeUndefined()

    const peek = page.getByRole("complementary", { name: categoryName })
    await peek.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Archive" }).click()
    await expect(page.getByRole("menu")).toBeHidden()

    const toast = page.getByRole("status").filter({ hasText: `Archived ${categoryName}.` })
    await expect(toast).toBeVisible()
    await expect.poll(async () => (await fetchCategory(request, categoryName))?.archived_at).not.toBeNull()
    await expect(peek.getByText("Archived", { exact: true })).toBeVisible()

    await toast.getByRole("button", { name: "Undo" }).click()
    await expect.poll(async () => (await fetchCategory(request, categoryName))?.archived_at).toBeNull()
    await expect(peek.getByText("Archived", { exact: true })).toBeHidden()

    await peek.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Archive" }).click()
    await expect(page.getByRole("menu")).toBeHidden()
    await expect(peek.getByText("Archived", { exact: true })).toBeVisible()
    await peek.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Restore" }).click()
    await expect.poll(async () => (await fetchCategory(request, categoryName))?.archived_at).toBeNull()
  })

  test("blocks a merge with overlapping budgets and merges into another category", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const suffix = Date.now()
    const sourceName = `E2E Merge Source ${suffix}`
    const conflictName = `E2E Merge Conflict ${suffix}`
    const targetName = `E2E Merge Target ${suffix}`
    const sourceId = await createCategory(request, token, "expense", sourceName)
    const conflictId = await createCategory(request, token, "expense", conflictName)
    const targetId = await createCategory(request, token, "expense", targetName)
    await createMonthlyBudgetTemplate(request, token, sourceId)
    await createMonthlyBudgetTemplate(request, token, conflictId)
    const today = new Date().toISOString().slice(0, 10)
    await createTransaction(request, token, {
      date: today,
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 999,
      category_id: sourceId,
      title: `Merge me ${suffix}`,
      tags: [],
    })

    await page.goto(`/categories?peek=${sourceId}`)
    const peek = page.getByRole("complementary", { name: sourceName })
    await peek.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Merge into…" }).click()

    const dialog = page.getByRole("dialog", { name: `Merge ${sourceName}` })
    await expect(dialog).toContainText(`${sourceName} is archived after the merge.`)
    await expect(dialog.getByRole("button", { name: "Merge", exact: true })).toBeDisabled()

    await dialog.getByLabel("Into").selectOption(String(conflictId))
    await expect(dialog).toContainText("1 plan, 0 adjustments")
    await dialog.getByRole("button", { name: "Merge", exact: true }).click()
    await expect(dialog.getByRole("alert")).toContainText(/both have a budget for the same period/i)
    expect((await fetchCategory(request, sourceName))?.archived_at).toBeNull()

    await dialog.getByLabel("Into").selectOption(String(targetId))
    await dialog.getByRole("button", { name: "Merge", exact: true }).click()
    await expect(
      page.getByRole("status").filter({ hasText: `Merged ${sourceName} into ${targetName}.` }),
    ).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole("complementary", { name: targetName })).toContainText("1 use")
    await expect.poll(async () => (await fetchCategory(request, sourceName))?.archived_at).not.toBeNull()
  })
})
