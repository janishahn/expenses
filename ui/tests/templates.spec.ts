import type { APIRequestContext, Page } from "@playwright/test"
import { test, expect } from "./fixtures"
import { createCategory, getCsrfToken } from "./helpers"

test.describe.configure({ mode: "parallel" })

type StoredTemplate = {
  id: number
  name: string
  type: "income" | "expense"
  category_id: number
  default_amount_cents: number | null
  title: string | null
  tags: string[]
}

const unique = () => `${Date.now()}-${Math.floor(Math.random() * 100000)}`

async function createTag(request: APIRequestContext, token: string, name: string) {
  const response = await request.post("/api/tags", {
    headers: { "X-CSRF-Token": token },
    data: { name, is_hidden_from_budget: false },
  })
  expect(response.ok()).toBeTruthy()
}

async function fetchTemplates(request: APIRequestContext): Promise<StoredTemplate[]> {
  const response = await request.get("/api/templates")
  expect(response.ok()).toBeTruthy()
  return ((await response.json()) as { templates: StoredTemplate[] }).templates
}

const templateList = (page: Page) => page.getByRole("list", { name: "Templates" })
const addTemplate = (page: Page) =>
  page.locator("main header").getByRole("button", { name: "Add template" })

async function seedCategory(request: APIRequestContext, label: string) {
  const token = await getCsrfToken(request)
  const categoryName = `E2E ${label} ${unique()}`
  const categoryId = await createCategory(request, token, "expense", categoryName)
  return { token, categoryId, categoryName }
}

test.describe("Templates page", () => {
  test("creates a template from the Add template dialog with category, amount, title and tags", async ({
    page,
    request,
  }) => {
    const { token, categoryId, categoryName } = await seedCategory(request, "Create")
    const suffix = unique()
    const tags = [`daily-${suffix}`, `coffee-${suffix}`]
    for (const tag of tags) await createTag(request, token, tag)
    const name = `E2E Template ${suffix}`

    await page.goto("/templates")
    await addTemplate(page).click()
    const dialog = page.getByRole("dialog", { name: "Add template" })
    await expect(dialog).toBeVisible()
    await dialog.getByRole("textbox", { name: "Default amount" }).fill("4,25")
    await dialog.getByRole("textbox", { name: "Name" }).fill(name)
    await dialog.getByRole("textbox", { name: "Transaction title" }).fill("Morning coffee")

    await dialog.getByRole("button", { name: /^Category / }).click()
    await page.getByRole("option", { name: categoryName }).click()
    await expect(dialog.getByRole("button", { name: `Category ${categoryName}` })).toBeVisible()

    await dialog.getByRole("button", { name: "Tags", exact: true }).click()
    for (const tag of tags) await page.getByRole("option", { name: tag }).click()
    await page.keyboard.press("Escape")
    await expect(dialog.getByRole("button", { name: `Tags ${tags.join(", ")}` })).toBeVisible()

    await dialog.getByRole("button", { name: "Add template" }).click()
    await expect(dialog).toBeHidden()

    const row = templateList(page).getByRole("listitem", { name })
    await expect(row).toBeVisible()
    await expect(row).toContainText(/4,25\s*€/)
    await expect(row).toContainText("Morning coffee")
    await expect(row).toContainText(tags[0])
    await expect(row).toContainText(tags[1])

    const stored = (await fetchTemplates(request)).find((template) => template.name === name)
    expect(stored).toMatchObject({
      type: "expense",
      category_id: categoryId,
      default_amount_cents: 425,
      title: "Morning coffee",
      tags,
    })
  })
})
