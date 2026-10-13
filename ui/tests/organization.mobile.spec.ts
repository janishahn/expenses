import { expect, test, type APIRequestContext, type Page } from "./fixtures"
import { createCategory, createTransaction, getCsrfToken } from "./helpers"

type StoredTag = {
  id: number
  name: string
  is_hidden_from_filters: boolean
  archived_at: string | null
  auto_attach_period: { start: string; end: string } | null
}

async function fetchTag(request: APIRequestContext, name: string) {
  const response = await request.get("/api/tags?period=all&include_archived=1")
  expect(response.ok()).toBeTruthy()
  const { tags } = (await response.json()) as { tags: StoredTag[] }
  return tags.find((tag) => tag.name === name)
}

async function openRow(page: Page, listName: string, name: string) {
  await page.getByRole("list", { name: listName }).getByRole("listitem", { name, exact: true }).click()
}

test.describe("Organization surfaces (mobile)", () => {
  test("creates a tag with an auto-add range and manages it from the peek and the tag page", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const stamp = Date.now()
    const tagName = `Mobile tag ${stamp}`
    await page.goto("/tags")
    const addButton = page.getByRole("button", { name: "Add tag" }).first()
    await addButton.click()
    const dialog = page.getByRole("dialog", { name: "Add tag" })
    await dialog.getByRole("textbox", { name: "Name" }).fill(tagName)
    await dialog.getByRole("button", { name: "Auto-add off" }).click()
    const range = page.getByRole("dialog", { name: "Auto-add" })
    await range.getByRole("button", { name: "Save" }).click()
    await expect(range.getByRole("alert")).toHaveText("Choose a start and an end date.")
    await range.getByLabel("From").fill("2026-08-17")
    await range.getByLabel("Until").fill("2026-08-10")
    await range.getByRole("button", { name: "Save" }).click()
    await expect(range.getByRole("alert")).toHaveText("The end must not be before the start.")
    await range.getByLabel("Until").fill("2026-08-24")
    await range.getByRole("button", { name: "Save" }).click()
    await expect(dialog.getByRole("button", { name: /^Auto-add 17/ })).toBeVisible()
    await dialog.getByRole("button", { name: "Add tag" }).click()
    await expect(dialog).toBeHidden()

    const categoryId = await createCategory(request, token, "expense", `Mobile tag category ${stamp}`)
    await createTransaction(request, token, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 4200,
      category_id: categoryId,
      title: `Mobile tag seed ${stamp}`,
      tags: [tagName],
    })
    expect((await fetchTag(request, tagName))?.auto_attach_period).toEqual({
      start: "2026-08-17",
      end: "2026-08-24",
    })

    await page.reload()
    await openRow(page, "Tags", tagName)
    const peek = page.getByRole("complementary", { name: tagName })
    await expect(peek).toContainText("42,00")
    await expect(peek).toContainText("spent")
    await expect(page.getByRole("heading", { name: "Tags", level: 1 })).toBeHidden()

    const filterSwitch = peek.getByRole("switch", { name: "Show in filter menus" })
    await expect(filterSwitch).toBeChecked()
    await filterSwitch.click()
    await expect(filterSwitch).not.toBeChecked()
    await expect.poll(async () => (await fetchTag(request, tagName))?.is_hidden_from_filters).toBe(true)

    await peek.getByRole("button", { name: "Edit Name" }).click()
    const updatedName = `${tagName} updated`
    await peek.getByRole("textbox", { name: "Name" }).fill(updatedName)
    await peek.getByRole("textbox", { name: "Name" }).press("Enter")
    await expect(page.getByRole("complementary", { name: updatedName })).toBeVisible()

    const renamed = page.getByRole("complementary", { name: updatedName })
    await renamed.getByRole("button", { name: "All 1" }).click()
    await expect(page).toHaveURL(/\/tags\/\d+/)
    await expect(page.getByRole("heading", { name: updatedName, level: 1 })).toBeVisible()
    await expect(page.getByRole("listitem", { name: `Mobile tag seed ${stamp}` })).toContainText("42,00")
    await page.goBack()

    await expect(page.getByRole("complementary", { name: updatedName })).toBeVisible()
    await page.getByRole("complementary", { name: updatedName }).getByRole("button", { name: "More actions" }).click()
    await page.getByRole("dialog", { name: "More actions" }).getByRole("menuitem", { name: "Archive" }).click()
    await expect(page.getByRole("status").filter({ hasText: `Archived ${updatedName}.` })).toBeVisible()
    await expect.poll(async () => (await fetchTag(request, updatedName))?.archived_at).not.toBeNull()
  })

  test("creates a transaction template and edits it in its peek", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryName = `Mobile template category ${Date.now()}`
    await createCategory(request, token, "expense", categoryName)
    const name = `Mobile template ${Date.now()}`

    await page.goto("/templates")
    await page.getByRole("button", { name: "Add template" }).first().click()
    const addDialog = page.getByRole("dialog", { name: "Add template" })
    await addDialog.getByRole("textbox", { name: "Name" }).fill(name)
    await addDialog.getByRole("textbox", { name: "Default amount" }).fill("4.25")
    await addDialog.getByRole("button", { name: /^Category / }).click()
    await page.getByRole("combobox", { name: "Category" }).fill(categoryName)
    await page.getByRole("option", { name: categoryName, exact: true }).click()
    await addDialog.getByRole("button", { name: "Add template" }).click()
    await expect(addDialog).toBeHidden()

    const list = page.getByRole("list", { name: "Templates" })
    const row = list.getByRole("listitem", { name, exact: true })
    await expect(row).toContainText("4,25")
    await row.click()
    const peek = page.getByRole("complementary", { name })
    await expect(peek.getByRole("button", { name: /^Category/ })).toContainText(categoryName)

    const updatedName = `${name} updated`
    await peek.getByRole("button", { name: "Edit Name" }).click()
    await peek.getByRole("textbox", { name: "Name" }).fill(updatedName)
    await peek.getByRole("textbox", { name: "Name" }).press("Enter")
    await peek.getByRole("button", { name: /^Amount/ }).click()
    const amountSheet = page.getByRole("dialog", { name: "Default amount" })
    await amountSheet.getByRole("textbox", { name: "Default amount" }).fill("7.50")
    await amountSheet.getByRole("button", { name: "Save" }).click()

    await page.getByRole("complementary", { name: updatedName }).getByRole("button", { name: "Templates" }).click()
    const updatedRow = list.getByRole("listitem", { name: updatedName, exact: true })
    await expect(updatedRow).toContainText("7,50")
    const response = await request.get("/api/templates")
    const { templates } = (await response.json()) as {
      templates: Array<{ name: string; default_amount_cents: number | null }>
    }
    expect(templates.find((template) => template.name === updatedName)?.default_amount_cents).toBe(750)
  })

  test("creates a categorization rule and toggles it in its peek", async ({ page, request }) => {
    const name = `Mobile rule ${Date.now()}`

    await page.goto("/rules")
    await page.getByRole("button", { name: "Add rule" }).first().click()
    const dialog = page.getByRole("dialog", { name: "Add rule" })
    await dialog.getByRole("textbox", { name: "Name" }).fill(name)
    await dialog.getByRole("textbox", { name: "Title text" }).fill("mobile-rule")
    await dialog.getByRole("button", { name: "Add rule" }).click()
    await expect(dialog).toBeHidden()

    await openRow(page, "Rules", name)
    const peek = page.getByRole("complementary", { name })
    const toggle = peek.getByRole("switch", { name: "Enabled" })
    await expect(toggle).toBeChecked()
    await toggle.click()
    await expect(toggle).not.toBeChecked()
    await expect
      .poll(async () => {
        const { rules } = (await (await request.get("/api/rules")).json()) as {
          rules: Array<{ name: string; enabled: boolean }>
        }
        return rules.find((rule) => rule.name === name)?.enabled
      })
      .toBe(false)

    await peek.getByRole("button", { name: "Rules" }).click()
    await expect(page.getByRole("listitem", { name, exact: true })).toContainText("Off")
  })
})
