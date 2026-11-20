import { test, expect, type APIRequestContext, type Page } from "./fixtures"
import { createCategory, createUncategorizedExpense, getCsrfToken } from "./helpers"

type StoredRule = {
  id: number
  name: string
  enabled: boolean
  priority: number
  match_type: string
  match_value: string
  transaction_type: string | null
  min_amount_cents: number | null
  max_amount_cents: number | null
  set_category_id: number | null
  add_tags: string[]
}

async function listRules(request: APIRequestContext): Promise<StoredRule[]> {
  const response = await request.get("/api/rules")
  expect(response.ok()).toBeTruthy()
  return ((await response.json()) as { rules: StoredRule[] }).rules
}

async function createRule(
  request: APIRequestContext,
  token: string,
  data: Partial<StoredRule> & { name: string; match_value: string },
): Promise<number> {
  const response = await request.post("/api/rules", {
    headers: { "X-CSRF-Token": token },
    data: {
      enabled: true,
      priority: 100,
      match_type: "contains",
      transaction_type: null,
      min_amount_cents: null,
      max_amount_cents: null,
      set_category_id: null,
      add_tags: [],
      budget_exclude_tag_id: null,
      ...data,
    },
  })
  expect(response.ok()).toBeTruthy()
  return ((await response.json()) as { id: number }).id
}

async function createTag(request: APIRequestContext, token: string, name: string) {
  const response = await request.post("/api/tags", {
    headers: { "X-CSRF-Token": token },
    data: { name, is_hidden_from_budget: false },
  })
  expect(response.ok()).toBeTruthy()
}

async function ruleByName(request: APIRequestContext, name: string): Promise<StoredRule> {
  const rule = (await listRules(request)).find((entry) => entry.name === name)
  expect(rule).toBeDefined()
  return rule!
}

async function chooseOption(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label }).fill(option)
  await page.getByRole("option", { name: option, exact: true }).click()
}

function ruleRow(page: Page, name: string) {
  return page.getByRole("listitem", { name, exact: true })
}

test.describe("Rules Page", () => {
  test("creates a rule with a preview and applies it to new transactions", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const stamp = Date.now()
    const targetName = `E2E Rule Target ${stamp}`
    const targetId = await createCategory(request, token, "expense", targetName)
    const match = `acme-stream-${stamp}`
    await createUncategorizedExpense(request, token, `${match} existing`)
    await createTag(request, token, `streaming-${stamp}`)

    const ruleName = `E2E Rule ${stamp}`
    await page.goto("/rules")
    await page.getByRole("button", { name: "Add rule" }).first().click()
    const dialog = page.getByRole("dialog", { name: "Add rule" })
    await dialog.getByRole("textbox", { name: "Name" }).fill(ruleName)
    await dialog.getByRole("textbox", { name: "Title text" }).fill(match)
    await expect(dialog).toContainText("Matches 1 recent transaction")

    await dialog.getByRole("button", { name: "Set category none" }).click()
    await chooseOption(page, "Category", targetName)
    await dialog.getByRole("button", { name: "Add tags", exact: true }).click()
    await chooseOption(page, "Add tags", `streaming-${stamp}`)
    await page.keyboard.press("Escape")
    await expect(dialog.getByRole("button", { name: `Add tags streaming-${stamp}` })).toBeVisible()
    await dialog.getByRole("button", { name: "Add rule" }).click()

    await expect(dialog).toBeHidden()
    const row = ruleRow(page, ruleName)
    await expect(row).toBeVisible()
    await expect(row).toContainText(`contains “${match}”`)
    await expect(row).toContainText(targetName)

    const stored = await ruleByName(request, ruleName)
    expect(stored).toMatchObject({
      enabled: true,
      priority: 100,
      match_type: "contains",
      match_value: match,
      set_category_id: targetId,
      add_tags: [`streaming-${stamp}`],
    })

    // Rules set a category only on transactions filed under Uncategorized.
    const txnId = await createUncategorizedExpense(request, token, `${match} new`, 2500)
    const response = await request.get(`/api/transactions/${txnId}`)
    expect(response.ok()).toBeTruthy()
    const payload = (await response.json()) as { category_id: number; tags: string[] }
    expect(payload.category_id).toBe(targetId)
    expect(payload.tags).toContain(`streaming-${stamp}`)
  })

  test("deletes a rule after confirmation", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const ruleName = `E2E Delete ${Date.now()}`
    const id = await createRule(request, token, { name: ruleName, match_value: "delete-me" })

    await page.goto(`/rules?peek=${id}`)
    const peek = page.getByRole("complementary", { name: ruleName })
    await peek.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Delete rule" }).click()
    const confirm = page.getByRole("dialog", { name: `Delete rule "${ruleName}"?` })
    await expect(confirm).toBeVisible()
    await confirm.getByRole("button", { name: "Delete", exact: true }).click()

    await expect(ruleRow(page, ruleName)).toBeHidden()
    await expect(page).not.toHaveURL(/peek=/)
    expect((await listRules(request)).some((rule) => rule.id === id)).toBe(false)
  })
})
