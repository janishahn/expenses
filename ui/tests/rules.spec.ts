import { test, expect, type APIRequestContext, type Page } from "./fixtures"
import {
  createCategory,
  createTransaction,
  createUncategorizedExpense,
  getCsrfToken,
} from "./helpers"

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

async function seedExpense(
  request: APIRequestContext,
  token: string,
  categoryId: number,
  title: string,
  amountCents: number,
) {
  const today = new Date().toISOString().slice(0, 10)
  return createTransaction(request, token, {
    date: today,
    occurred_at: new Date().toISOString(),
    type: "expense",
    amount_cents: amountCents,
    category_id: categoryId,
    title,
    tags: [],
  })
}

async function chooseOption(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label }).fill(option)
  await page.getByRole("option", { name: option, exact: true }).click()
}

function ruleRow(page: Page, name: string) {
  return page.getByRole("listitem", { name, exact: true })
}

test.describe("Rules Page", () => {
  test("opens and cancels the add rule dialog from the page action", async ({ page }) => {
    await page.goto("/rules")
    await expect(page.getByRole("heading", { name: "Rules", level: 1 })).toBeVisible()
    await page.getByRole("button", { name: "Add rule" }).first().click()
    const dialog = page.getByRole("dialog", { name: "Add rule" })
    await expect(dialog).toBeVisible()
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(dialog).toBeHidden()
  })

  test("asks for a name and a match text before creating a rule", async ({ page }) => {
    await page.goto("/rules")
    await page.getByRole("button", { name: "Add rule" }).first().click()
    const dialog = page.getByRole("dialog", { name: "Add rule" })
    await dialog.getByRole("button", { name: "Add rule" }).click()
    await expect(dialog.getByRole("alert")).toHaveText("Enter a rule name.")

    await dialog.getByRole("textbox", { name: "Name" }).fill(`E2E Missing ${Date.now()}`)
    await dialog.getByRole("button", { name: "Add rule" }).click()
    await expect(dialog.getByRole("alert")).toHaveText("Enter a match value.")
  })

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

  test("creates a disabled income-only rule with an amount range and priority", async ({
    page,
    request,
  }) => {
    const stamp = Date.now()
    const ruleName = `E2E Options ${stamp}`
    await page.goto("/rules")
    await page.getByRole("button", { name: "Add rule" }).first().click()
    const dialog = page.getByRole("dialog", { name: "Add rule" })
    await dialog.getByRole("textbox", { name: "Name" }).fill(ruleName)
    await dialog.getByRole("textbox", { name: "Title text" }).fill(`salary-${stamp}`)
    await dialog.getByRole("radio", { name: "Income" }).click()

    await dialog.getByRole("button", { name: "Match contains" }).click()
    await page.getByRole("menuitemcheckbox", { name: "Starts with" }).click()
    await expect(dialog.getByRole("button", { name: "Match starts with" })).toBeVisible()

    await dialog.getByRole("button", { name: "Amount condition" }).click()
    const amountPopover = page.getByRole("dialog", { name: "Amount" })
    await amountPopover.getByRole("textbox", { name: "At least" }).fill("10")
    await amountPopover.getByRole("textbox", { name: "At most" }).fill("2000")
    await amountPopover.getByRole("button", { name: "Done" }).click()

    await dialog.getByRole("button", { name: "Priority 100" }).click()
    const priorityPopover = page.getByRole("dialog", { name: "Priority" })
    await priorityPopover.getByRole("textbox", { name: "Priority" }).fill("7")
    await priorityPopover.getByRole("button", { name: "Done" }).click()

    const enabled = dialog.getByRole("button", { name: "Enabled" })
    await expect(enabled).toHaveAttribute("aria-pressed", "true")
    await enabled.click()
    await expect(enabled).toHaveAttribute("aria-pressed", "false")
    await dialog.getByRole("button", { name: "Add rule" }).click()

    const row = ruleRow(page, ruleName)
    await expect(row).toBeVisible()
    await expect(row).toContainText("Off")
    await expect(row).toContainText("income only")

    expect(await ruleByName(request, ruleName)).toMatchObject({
      enabled: false,
      priority: 7,
      match_type: "starts_with",
      match_value: `salary-${stamp}`,
      transaction_type: "income",
      min_amount_cents: 1000,
      max_amount_cents: 200000,
    })
  })

  test("toggles a rule off and on from its peek", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const ruleName = `E2E Toggle ${Date.now()}`
    const id = await createRule(request, token, { name: ruleName, match_value: "toggle-test" })

    await page.goto("/rules")
    await ruleRow(page, ruleName).click()
    await expect(page).toHaveURL(new RegExp(`peek=${id}`))
    const peek = page.getByRole("complementary", { name: ruleName })
    const toggle = peek.getByRole("switch", { name: "Enabled" })
    await expect(toggle).toBeChecked()

    await toggle.click()
    await expect(toggle).not.toBeChecked()
    await expect(ruleRow(page, ruleName)).toContainText("Off")
    await expect.poll(async () => (await ruleByName(request, ruleName)).enabled).toBe(false)

    await toggle.click()
    await expect(toggle).toBeChecked()
    await expect.poll(async () => (await ruleByName(request, ruleName)).enabled).toBe(true)
  })

  test("edits a rule inline from its peek", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const stamp = Date.now()
    const ruleName = `E2E Edit ${stamp}`
    const categoryName = `E2E Edit Category ${stamp}`
    const categoryId = await createCategory(request, token, "expense", categoryName)
    await createTag(request, token, `edit-tag-${stamp}`)
    const id = await createRule(request, token, { name: ruleName, match_value: `edit-${stamp}` })

    await page.goto(`/rules?peek=${id}`)
    const peek = page.getByRole("complementary", { name: ruleName })

    const newName = `${ruleName} renamed`
    await peek.getByRole("button", { name: "Edit Name" }).click()
    await peek.getByRole("textbox", { name: "Name" }).fill(newName)
    await peek.getByRole("textbox", { name: "Name" }).press("Enter")
    await expect(page.getByRole("complementary", { name: newName })).toBeVisible()
    await expect.poll(async () => (await ruleByName(request, newName)).id).toBe(id)

    const renamed = page.getByRole("complementary", { name: newName })
    await renamed.getByRole("button", { name: /^Priority/ }).click()
    const priorityPopover = page.getByRole("dialog", { name: "Priority" })
    await priorityPopover.getByRole("textbox", { name: "Priority" }).fill("5")
    await priorityPopover.getByRole("button", { name: "Done" }).click()

    await renamed.getByRole("button", { name: /^Title/ }).click()
    const titlePopover = page.getByRole("dialog", { name: "Title" })
    await titlePopover.getByLabel("Match").selectOption("equals")
    await titlePopover.getByRole("textbox", { name: "Title text" }).fill(`exact-${stamp}`)
    await titlePopover.getByRole("button", { name: "Done" }).click()
    await expect(renamed.getByRole("button", { name: /^Title/ })).toContainText(`equals “exact-${stamp}”`)

    await renamed.getByRole("button", { name: /^Amount/ }).click()
    const amountPopover = page.getByRole("dialog", { name: "Amount" })
    await amountPopover.getByRole("textbox", { name: "At most" }).fill("30")
    await amountPopover.getByRole("button", { name: "Done" }).click()

    await renamed.getByRole("button", { name: /^Type/ }).click()
    await page.getByRole("menuitemcheckbox", { name: "Expense" }).click()

    await renamed.getByRole("button", { name: /^Category/ }).click()
    await chooseOption(page, "Category", categoryName)
    await renamed.getByRole("button", { name: "Add tag" }).click()
    await chooseOption(page, "Add tags", `edit-tag-${stamp}`)
    await page.keyboard.press("Escape")
    await expect(renamed.getByText(`edit-tag-${stamp}`)).toBeVisible()

    await expect
      .poll(async () => ruleByName(request, newName))
      .toMatchObject({
        priority: 5,
        match_type: "equals",
        match_value: `exact-${stamp}`,
        min_amount_cents: null,
        max_amount_cents: 3000,
        transaction_type: "expense",
        set_category_id: categoryId,
        add_tags: [`edit-tag-${stamp}`],
      })
    const row = ruleRow(page, newName)
    await expect(row).toContainText(`equals “exact-${stamp}”`)
    await expect(row).toContainText(categoryName)
  })

  test("keeps the entered name and shows the error when a save fails", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const ruleName = `E2E Failing ${Date.now()}`
    const id = await createRule(request, token, { name: ruleName, match_value: "failing" })
    await page.route(`**/api/rules/${id}`, async (route) => {
      if (route.request().method() === "PUT") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Temporary save failure" }),
        })
        return
      }
      await route.continue()
    })

    await page.goto(`/rules?peek=${id}`)
    const peek = page.getByRole("complementary", { name: ruleName })
    await peek.getByRole("button", { name: "Edit Name" }).click()
    await peek.getByRole("textbox", { name: "Name" }).fill("Will not save")
    await peek.getByRole("textbox", { name: "Name" }).press("Enter")

    await expect(peek.getByRole("alert")).toHaveText("Temporary save failure")
    await expect(peek.getByRole("textbox", { name: "Name" })).toHaveValue("Will not save")
    expect((await listRules(request)).some((rule) => rule.name === "Will not save")).toBe(false)
  })

  test("keeps a switched value and shows the error when its save fails", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const ruleName = `E2E Failing switch ${Date.now()}`
    const id = await createRule(request, token, { name: ruleName, match_value: "failing-switch" })
    await page.route(`**/api/rules/${id}`, async (route) => {
      if (route.request().method() === "PUT") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Temporary save failure" }),
        })
        return
      }
      await route.continue()
    })

    await page.goto(`/rules?peek=${id}`)
    const peek = page.getByRole("complementary", { name: ruleName })
    const enabled = peek.getByRole("switch", { name: "Enabled" })
    await expect(enabled).toBeChecked()
    await enabled.click()

    await expect(peek.getByRole("alert")).toHaveText("Temporary save failure")
    await expect(enabled).not.toBeChecked()
    expect((await listRules(request)).find((rule) => rule.name === ruleName)?.enabled).toBe(true)
  })

  test("clears a failed save's error when a later save of the same field succeeds", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const ruleName = `E2E Recovered switch ${Date.now()}`
    const id = await createRule(request, token, { name: ruleName, match_value: "recovered-switch" })
    let puts = 0
    await page.route(`**/api/rules/${id}`, async (route) => {
      if (route.request().method() === "PUT" && puts++ === 0) {
        // The second change queues while the first save is still running.
        await new Promise((resolve) => setTimeout(resolve, 300))
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Temporary save failure" }),
        })
        return
      }
      await route.continue()
    })

    await page.goto(`/rules?peek=${id}`)
    const peek = page.getByRole("complementary", { name: ruleName })
    const enabled = peek.getByRole("switch", { name: "Enabled" })
    await expect(enabled).toBeChecked()
    const saved = page.waitForResponse(
      (response) => response.url().endsWith(`/api/rules/${id}`) && response.request().method() === "PUT" && response.ok()
    )
    await enabled.click()
    await expect(enabled).not.toBeChecked()
    await enabled.click()
    await saved

    await expect(enabled).toBeChecked()
    await expect(peek.getByRole("alert")).toHaveCount(0)
  })

  test("lists the recent transactions a rule matches in its peek", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const stamp = Date.now()
    const sourceId = await createCategory(request, token, "expense", `E2E Match Source ${stamp}`)
    const targetName = `E2E Match Target ${stamp}`
    const targetId = await createCategory(request, token, "expense", targetName)
    const match = `matchlist-${stamp}`
    await seedExpense(request, token, sourceId, `${match} lunch`, 1234)
    const ruleName = `E2E Matches ${stamp}`
    const id = await createRule(request, token, {
      name: ruleName,
      match_value: match,
      set_category_id: targetId,
    })

    await page.goto(`/rules?peek=${id}`)
    const peek = page.getByRole("complementary", { name: ruleName })
    await expect(peek.getByText("1 recent")).toBeVisible()
    const matches = peek.getByRole("list", { name: "Matches" })
    const item = matches.getByRole("listitem", { name: `${match} lunch` })
    await expect(item).toContainText("12,34")
    await expect(item).toContainText(targetName)
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
