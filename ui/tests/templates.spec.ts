import type { APIRequestContext, Page } from "@playwright/test"
import { test, expect } from "./fixtures"
import { createCategory, getCsrfToken, loginAsIsolatedUser } from "./helpers"

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

async function seedTemplate(
  request: APIRequestContext,
  token: string,
  categoryId: number,
  overrides: Partial<Omit<StoredTemplate, "id">> = {},
): Promise<{ id: number; name: string }> {
  const name = overrides.name ?? `E2E Template ${unique()}`
  const response = await request.post("/api/templates", {
    headers: { "X-CSRF-Token": token },
    data: {
      name,
      type: "expense",
      category_id: categoryId,
      default_amount_cents: 500,
      title: null,
      tags: [],
      ...overrides,
    },
  })
  expect(response.ok()).toBeTruthy()
  return { id: ((await response.json()) as { id: number }).id, name }
}

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

async function fetchTemplate(request: APIRequestContext, id: number) {
  const template = (await fetchTemplates(request)).find((entry) => entry.id === id)
  expect(template).toBeTruthy()
  return template!
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

  test("creates an income template with a variable amount", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const incomeName = `E2E Income ${unique()}`
    const incomeId = await createCategory(request, token, "income", incomeName)
    const name = `E2E Variable ${unique()}`

    await page.goto("/templates")
    await addTemplate(page).click()
    const dialog = page.getByRole("dialog", { name: "Add template" })
    await dialog.getByRole("radio", { name: "Income" }).click()
    await dialog.getByRole("textbox", { name: "Name" }).fill(name)
    await dialog.getByRole("button", { name: /^Category / }).click()
    await page.getByRole("option", { name: incomeName }).click()
    await dialog.getByRole("button", { name: "Add template" }).click()

    const row = templateList(page).getByRole("listitem", { name })
    await expect(row).toContainText("Variable")
    const stored = (await fetchTemplates(request)).find((template) => template.name === name)
    expect(stored).toMatchObject({
      type: "income",
      category_id: incomeId,
      default_amount_cents: null,
    })
  })

  test("requires a name and a valid default amount before adding", async ({ page, request }) => {
    await seedCategory(request, "Validation")
    await page.goto("/templates")
    await addTemplate(page).click()
    const dialog = page.getByRole("dialog", { name: "Add template" })

    await dialog.getByRole("button", { name: "Add template" }).click()
    await expect(dialog.getByRole("alert")).toHaveText("Name is required.")

    await dialog.getByRole("textbox", { name: "Name" }).fill(`E2E Invalid ${unique()}`)
    await dialog.getByRole("textbox", { name: "Default amount" }).fill("abc")
    await dialog.getByRole("button", { name: "Add template" }).click()
    await expect(dialog.getByRole("alert")).toHaveText("Default amount must be a valid number.")
    await expect(dialog).toBeVisible()
  })

  test("edits the name, amount, title and category from the peek", async ({ page, request }) => {
    const { token, categoryId, categoryName } = await seedCategory(request, "Edit")
    const targetName = `E2E Target ${unique()}`
    const targetId = await createCategory(request, token, "expense", targetName)
    const { id, name } = await seedTemplate(request, token, categoryId, {
      title: "Original title",
    })
    await page.goto("/templates")

    await templateList(page).getByRole("listitem", { name }).click()
    await expect(page).toHaveURL(new RegExp(`peek=${id}`))
    const peek = page.getByRole("complementary", { name })
    await expect(peek.getByRole("button", { name: `Category ${categoryName}` })).toBeVisible()
    await expect(peek.getByRole("button", { name: "Amount" })).toContainText(/5,00\s*€/)

    const renamed = `${name} Updated`
    await peek.getByRole("button", { name: "Edit Name" }).click()
    await peek.getByRole("textbox", { name: "Name" }).fill(renamed)
    await peek.getByRole("textbox", { name: "Name" }).press("Enter")
    await expect(page.getByRole("complementary", { name: renamed })).toBeVisible()
    await expect(templateList(page).getByRole("listitem", { name: renamed })).toBeVisible()

    await peek.getByRole("button", { name: /^Amount / }).click()
    await page.getByRole("textbox", { name: "Default amount" }).fill("7,50")
    await page.getByRole("button", { name: "Save" }).click()
    await expect(peek.getByRole("button", { name: /^Amount / })).toContainText(/7,50\s*€/)

    await peek.getByRole("button", { name: /^Title / }).click()
    await page.getByRole("textbox", { name: "Transaction title" }).fill("New title")
    await page.getByRole("button", { name: "Save" }).click()
    await expect(peek.getByRole("button", { name: /^Title / })).toContainText("New title")

    await peek.getByRole("button", { name: /^Category / }).click()
    await page.getByRole("option", { name: targetName }).click()
    await expect(peek.getByRole("button", { name: `Category ${targetName}` })).toBeVisible()

    await expect
      .poll(() => fetchTemplate(request, id))
      .toMatchObject({
        name: renamed,
        default_amount_cents: 750,
        title: "New title",
        category_id: targetId,
      })
  })

  test("makes the amount variable by clearing it and rejects an invalid amount", async ({
    page,
    request,
  }) => {
    const { token, categoryId } = await seedCategory(request, "Variable")
    const { id, name } = await seedTemplate(request, token, categoryId)
    await page.goto(`/templates?peek=${id}`)
    const peek = page.getByRole("complementary", { name })

    await peek.getByRole("button", { name: /^Amount / }).click()
    await page.getByRole("textbox", { name: "Default amount" }).fill("abc")
    await page.getByRole("button", { name: "Save" }).click()
    await expect(page.getByRole("dialog", { name: "Default amount" })).toContainText(
      "Default amount must be a valid number.",
    )
    expect((await fetchTemplate(request, id)).default_amount_cents).toBe(500)

    await page.getByRole("textbox", { name: "Default amount" }).fill("")
    await page.getByRole("button", { name: "Save" }).click()
    await expect(peek.getByRole("button", { name: /^Amount / })).toContainText("Variable")
    await expect(templateList(page).getByRole("listitem", { name })).toContainText("Variable")
    await expect.poll(async () => (await fetchTemplate(request, id)).default_amount_cents).toBeNull()
  })

  test("switches the type and adds and removes tags from the peek", async ({ page, request }) => {
    const { token, categoryId } = await seedCategory(request, "Tags")
    await createCategory(request, token, "income", `E2E Income ${unique()}`)
    const suffix = unique()
    const [first, second] = [`alpha-${suffix}`, `beta-${suffix}`]
    await createTag(request, token, first)
    await createTag(request, token, second)
    const { id, name } = await seedTemplate(request, token, categoryId, { tags: [first] })
    await page.goto(`/templates?peek=${id}`)
    const peek = page.getByRole("complementary", { name })

    await peek.getByRole("button", { name: "Add tag" }).click()
    await page.getByRole("option", { name: second }).click()
    await page.keyboard.press("Escape")
    await expect(peek.getByRole("button", { name: `Remove ${second}` })).toBeVisible()
    await expect.poll(async () => (await fetchTemplate(request, id)).tags).toEqual([first, second])

    await peek.getByRole("button", { name: `Remove ${first}` }).click()
    await expect(peek.getByRole("button", { name: `Remove ${first}` })).toHaveCount(0)
    await expect.poll(async () => (await fetchTemplate(request, id)).tags).toEqual([second])

    await peek.getByRole("button", { name: "Type Expense" }).click()
    await page.getByRole("menuitemcheckbox", { name: "Income" }).click()
    await expect(peek.getByRole("button", { name: "Type Income" })).toBeVisible()
    // The template moves to the first income category.
    await expect.poll(async () => (await fetchTemplate(request, id)).type).toBe("income")
    expect((await fetchTemplate(request, id)).category_id).not.toBe(categoryId)
  })

  test("keeps the entered name and explains a failed save", async ({ page, request }) => {
    const { token, categoryId } = await seedCategory(request, "Failure")
    const { id, name } = await seedTemplate(request, token, categoryId)
    await page.goto(`/templates?peek=${id}`)
    const peek = page.getByRole("complementary", { name })

    await peek.getByRole("button", { name: "Edit Name" }).click()
    await peek.getByRole("textbox", { name: "Name" }).fill("   ")
    await peek.getByRole("textbox", { name: "Name" }).press("Enter")
    await expect(peek.getByRole("alert")).toHaveText("Name is required.")
    await peek.getByRole("textbox", { name: "Name" }).press("Escape")

    await page.route(
      `**/api/templates/${id}`,
      (route) =>
        route.request().method() === "PUT"
          ? route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({ detail: "Templates are temporarily unavailable." }),
            })
          : route.fallback(),
      { times: 1 },
    )
    await peek.getByRole("button", { name: "Edit Name" }).click()
    await peek.getByRole("textbox", { name: "Name" }).fill(`${name} changed`)
    await peek.getByRole("textbox", { name: "Name" }).press("Enter")
    await expect(peek.getByRole("alert")).toHaveText("Templates are temporarily unavailable.")
    await expect(peek.getByRole("textbox", { name: "Name" })).toHaveValue(`${name} changed`)
    expect((await fetchTemplate(request, id)).name).toBe(name)

    await peek.getByRole("textbox", { name: "Name" }).press("Enter")
    await expect(page.getByRole("complementary", { name: `${name} changed` })).toBeVisible()
    await expect.poll(async () => (await fetchTemplate(request, id)).name).toBe(`${name} changed`)
  })

  test("requires confirmation before deleting a template", async ({ page, request }) => {
    const { token, categoryId } = await seedCategory(request, "Delete")
    const { id, name } = await seedTemplate(request, token, categoryId)
    await page.goto(`/templates?peek=${id}`)
    const peek = page.getByRole("complementary", { name })
    const confirm = page.getByRole("dialog", { name: `Delete template "${name}"?` })

    await peek.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Delete template" }).click()
    await confirm.getByRole("button", { name: "Cancel" }).click()
    await expect(confirm).toBeHidden()
    await expect(templateList(page).getByRole("listitem", { name })).toBeVisible()
    await fetchTemplate(request, id)

    await peek.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Delete template" }).click()
    const deleted = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/templates/${id}` &&
        response.request().method() === "DELETE",
    )
    await confirm.getByRole("button", { name: "Delete", exact: true }).click()
    expect((await deleted).ok()).toBeTruthy()
    await expect(templateList(page).getByRole("listitem", { name })).toHaveCount(0)
    await expect(peek).toBeHidden()
    expect((await fetchTemplates(request)).some((template) => template.id === id)).toBe(false)
  })

  test("reorders templates by dragging the grip", async ({ page }) => {
    await page.goto("/templates")
    const { request, csrfToken } = await loginAsIsolatedUser(page)
    try {
      const categoryId = await createCategory(request, csrfToken, "expense", "Drag category")
      const first = await seedTemplate(request, csrfToken, categoryId, { name: "Sort A" })
      const second = await seedTemplate(request, csrfToken, categoryId, { name: "Sort B" })
      await page.goto("/templates")

      const firstRow = templateList(page).getByRole("listitem", { name: first.name })
      const secondRow = templateList(page).getByRole("listitem", { name: second.name })
      await expect(firstRow).toBeVisible()
      await expect(secondRow).toBeVisible()
      expect((await fetchTemplates(request)).map((template) => template.name)).toEqual([
        "Sort A",
        "Sort B",
      ])

      const reordered = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/templates/reorder" &&
          response.request().method() === "POST" &&
          response.ok(),
      )
      const handleBox = await firstRow
        .getByRole("button", { name: `Reorder ${first.name}` })
        .boundingBox()
      const targetBox = await secondRow.boundingBox()
      expect(handleBox).not.toBeNull()
      expect(targetBox).not.toBeNull()
      await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2)
      await page.mouse.down()
      await page.mouse.move(
        targetBox!.x + targetBox!.width / 2,
        targetBox!.y + targetBox!.height / 2,
        { steps: 8 },
      )
      await page.mouse.up()
      await reordered

      await expect
        .poll(async () => (await fetchTemplates(request)).map((template) => template.name))
        .toEqual(["Sort B", "Sort A"])
      await page.reload()
      await expect(templateList(page).getByRole("listitem")).toHaveText([/Sort B/, /Sort A/])
    } finally {
      await request.dispose()
    }
  })

  test("reorders templates with the keyboard from the grip", async ({ page }) => {
    await page.goto("/templates")
    const { request, csrfToken } = await loginAsIsolatedUser(page)
    try {
      const categoryId = await createCategory(request, csrfToken, "expense", "Key category")
      await seedTemplate(request, csrfToken, categoryId, { name: "Key A" })
      await seedTemplate(request, csrfToken, categoryId, { name: "Key B" })
      await page.goto("/templates")

      const grip = templateList(page).getByRole("button", { name: "Reorder Key B" })
      await expect(grip).toBeVisible()
      await grip.focus()
      const reordered = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/templates/reorder" &&
          response.request().method() === "POST" &&
          response.ok(),
      )
      await page.keyboard.press("Space")
      await page.waitForTimeout(250)
      await page.keyboard.press("ArrowUp")
      await page.waitForTimeout(250)
      await page.keyboard.press("Space")
      await reordered

      await expect
        .poll(async () => (await fetchTemplates(request)).map((template) => template.name))
        .toEqual(["Key B", "Key A"])
      await expect(grip).toBeFocused()
    } finally {
      await request.dispose()
    }
  })

  test("shows an empty state with an Add template action for a new account", async ({ page }) => {
    await page.goto("/templates")
    const { request } = await loginAsIsolatedUser(page)
    try {
      await page.goto("/templates")
      await expect(page.getByText("No templates yet.")).toBeVisible()
      await page.getByRole("main").getByRole("button", { name: "Add template" }).last().click()
      await expect(page.getByRole("dialog", { name: "Add template" })).toBeVisible()
    } finally {
      await request.dispose()
    }
  })
})
