import { expect, test } from "./fixtures"
import { createCategory, getCsrfToken } from "./helpers"

test.describe("Organization surfaces (mobile)", () => {
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
})
