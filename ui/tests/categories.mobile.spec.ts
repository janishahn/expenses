import { expect, test, type APIRequestContext, type Page } from "./fixtures"
import { createCategory, createTransaction, getCsrfToken } from "./helpers"

async function fetchCategory(request: APIRequestContext, name: string) {
  const response = await request.get("/api/categories?period=all")
  expect(response.ok()).toBeTruthy()
  const { categories } = (await response.json()) as {
    categories: Array<{ id: number; name: string; icon: string | null; archived_at: string | null }>
  }
  return categories.find((category) => category.name === name)
}

function categoryRow(page: Page, name: string) {
  return page.getByRole("list", { name: "Categories" }).getByRole("listitem", { name, exact: true })
}

test.describe("Categories Page (mobile)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/categories")
    await expect(page.getByRole("heading", { name: "Categories", level: 1 })).toBeVisible()
  })

  test("creates a category and edits it in the peek that replaces the list", async ({
    page,
    request,
  }) => {
    const categoryName = `E2E Mobile Edit ${Date.now()}`
    const updatedName = `${categoryName} Updated`
    const addButton = page.getByRole("button", { name: "Add category" }).first()
    await expect(addButton).toHaveText("Add")
    await addButton.click()
    const dialog = page.getByRole("dialog", { name: "Add category" })
    await dialog.getByRole("textbox", { name: "Name" }).fill(categoryName)
    await dialog.getByRole("button", { name: "Add category" }).click()
    await expect(dialog).toBeHidden()

    await categoryRow(page, categoryName).click()
    const peek = page.getByRole("complementary", { name: categoryName })
    await expect(peek).toBeVisible()
    await expect(page.getByRole("heading", { name: "Categories", level: 1 })).toBeHidden()

    await peek.getByRole("button", { name: "Edit Name" }).click()
    await peek.getByRole("textbox", { name: "Name" }).fill(updatedName)
    await peek.getByRole("textbox", { name: "Name" }).press("Enter")
    await expect(page.getByRole("complementary", { name: updatedName })).toBeVisible()

    await peek.getByRole("button", { name: /^Icon/ }).click()
    const picker = page.getByRole("dialog", { name: "Icon" })
    await picker.getByRole("searchbox", { name: "Search icons" }).fill("pizza")
    await picker.getByRole("group", { name: "Matching icons" }).getByRole("button", { name: "Pizza", exact: true }).click()
    await expect(peek.getByRole("button", { name: /^Icon/ })).toContainText("Pizza")
    await expect.poll(async () => (await fetchCategory(request, updatedName))?.icon).toBe("pizza")

    await peek.getByRole("button", { name: "Categories" }).click()
    await expect(page.getByRole("heading", { name: "Categories", level: 1 })).toBeVisible()
    await expect(categoryRow(page, updatedName)).toBeVisible()
  })

  test("merges a category from the peek menu sheet", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const suffix = Date.now()
    const sourceName = `E2E Mobile Merge Source ${suffix}`
    const targetName = `E2E Mobile Merge Target ${suffix}`
    const sourceId = await createCategory(request, token, "expense", sourceName)
    const targetId = await createCategory(request, token, "expense", targetName)
    const today = new Date().toISOString().slice(0, 10)
    await createTransaction(request, token, {
      date: today,
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 777,
      category_id: sourceId,
      title: `Mobile merge ${suffix}`,
      tags: [],
    })

    await page.goto(`/categories?peek=${sourceId}`)
    await page
      .getByRole("complementary", { name: sourceName })
      .getByRole("button", { name: "More actions" })
      .click()
    await page.getByRole("dialog", { name: "More actions" }).getByRole("menuitem", { name: "Merge into…" }).click()

    const dialog = page.getByRole("dialog", { name: `Merge ${sourceName}` })
    await dialog.getByLabel("Into").selectOption(String(targetId))
    await expect(dialog).toContainText("Transactions")
    await dialog.getByRole("button", { name: "Merge", exact: true }).click()

    await expect(
      page.getByRole("status").filter({ hasText: `Merged ${sourceName} into ${targetName}.` }),
    ).toBeVisible()
    await expect(page.getByRole("complementary", { name: targetName })).toContainText("1 use")
    await expect.poll(async () => (await fetchCategory(request, sourceName))?.archived_at).not.toBeNull()
  })
})
