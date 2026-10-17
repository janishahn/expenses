import { request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test"
import { ADMIN_USER } from "./auth-helpers"
import { expect, test } from "./fixtures"
import { createCategory, getCsrfToken } from "./helpers"

test.describe.configure({ mode: "parallel" })

type StoredRule = {
  id: number
  name: string | null
  amount_cents: number
  category_id: number
  interval_count: number
  auto_post: boolean
  skip_weekends: boolean
  end_date: string | null
}

const unique = () => `${Date.now()}-${Math.floor(Math.random() * 100000)}`
const daysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)

// Auto-post rules are posted by the scheduler; an elevated admin session runs the same catch-up now.
async function runCatchUp(baseURL: string): Promise<void> {
  const admin = await playwrightRequest.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  })
  try {
    expect((await admin.post("/api/auth/login", { data: ADMIN_USER })).ok()).toBeTruthy()
    const headers = { "X-CSRF-Token": await getCsrfToken(admin) }
    const elevated = await admin.post("/api/auth/admin-elevation", {
      headers,
      data: { password: ADMIN_USER.password },
    })
    expect(elevated.ok()).toBeTruthy()
    expect((await admin.post("/api/admin/recurring-catch-up", { headers })).ok()).toBeTruthy()
  } finally {
    await admin.dispose()
  }
}

async function seedRule(
  request: APIRequestContext,
  overrides: Partial<Record<string, unknown>> = {},
) {
  const token = await getCsrfToken(request)
  const stamp = unique()
  const categoryName = `E2E Mobile ${stamp}`
  const categoryId = await createCategory(request, token, "expense", categoryName)
  const name = `E2E Mobile Rule ${stamp}`
  const response = await request.post("/api/recurring", {
    headers: { "X-CSRF-Token": token },
    data: {
      name,
      type: "expense",
      currency_code: "EUR",
      amount_cents: 4200,
      category_id: categoryId,
      anchor_date: daysAgo(0),
      interval_unit: "month",
      interval_count: 1,
      next_occurrence: daysAgo(0),
      end_date: null,
      auto_post: false,
      skip_weekends: false,
      month_day_policy: "snap_to_end",
      ...overrides,
    },
  })
  expect(response.ok()).toBeTruthy()
  return { id: ((await response.json()) as { id: number }).id, name, categoryId, categoryName }
}

async function fetchRule(request: APIRequestContext, id: number): Promise<StoredRule> {
  const payload = (await (await request.get("/api/recurring")).json()) as { rules: StoredRule[] }
  const rule = payload.rules.find((entry) => entry.id === id)
  expect(rule).toBeTruthy()
  return rule!
}

const headerAction = (page: Page) =>
  page.locator("main header").getByRole("button", { name: "Add rule" })

test.describe("Recurring page (mobile)", () => {
  test("creates a recurring rule from the mobile dialog", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryName = `E2E Mobile Create ${unique()}`
    const categoryId = await createCategory(request, token, "expense", categoryName)
    const name = `Mobile recurring create ${unique()}`

    await page.goto("/recurring")
    await headerAction(page).click()
    const dialog = page.getByRole("dialog", { name: "Add rule" })
    await dialog.getByRole("textbox", { name: "Amount" }).fill("19,99")
    await dialog.getByRole("textbox", { name: "Name" }).fill(name)
    await dialog.getByRole("button", { name: /^Category / }).click()
    await page.getByRole("option", { name: categoryName }).click()
    await dialog.getByRole("button", { name: "Repeats Every month" }).click()
    await page.getByRole("spinbutton", { name: "Every" }).fill("2")
    await page.getByRole("button", { name: "Done" }).click()
    await expect(dialog.getByRole("button", { name: "Repeats Every 2 months" })).toBeVisible()
    await dialog.getByRole("button", { name: "Add rule" }).click()
    await expect(dialog).toBeHidden()

    const row = page.getByRole("listitem", { name })
    await expect(row).toBeVisible()
    await expect(row).toContainText(/19,99\s*€/)
    const payload = (await (await request.get("/api/recurring")).json()) as { rules: StoredRule[] }
    expect(payload.rules.find((rule) => rule.name === name)).toMatchObject({
      amount_cents: 1999,
      category_id: categoryId,
      interval_count: 2,
      auto_post: true,
    })
  })

  test("opens a rule as a full-page peek with Back and edits it inline", async ({
    page,
    request,
  }) => {
    const { id, name } = await seedRule(request)
    await page.goto("/recurring")

    await page.getByRole("listitem", { name }).click()
    await expect(page).toHaveURL(new RegExp(`peek=${id}`))
    const peek = page.getByRole("complementary", { name })
    await expect(peek).toBeVisible()
    await expect(peek.getByRole("button", { name: "Open full view" })).toBeHidden()
    await expect(page.getByRole("list", { name: "Recurring rules" })).toBeHidden()

    const renamed = `${name} renamed`
    await peek.getByRole("button", { name: "Edit Name" }).click()
    await peek.getByRole("textbox", { name: "Name" }).fill(renamed)
    await peek.getByRole("textbox", { name: "Name" }).press("Enter")
    await expect(peek.getByRole("button", { name: "Edit Name" })).toContainText(renamed)
    await peek.getByRole("button", { name: "Edit Amount" }).click()
    await peek.getByRole("textbox", { name: "Amount" }).fill("60,00")
    await peek.getByRole("textbox", { name: "Amount" }).press("Enter")
    await expect(peek.getByRole("button", { name: "Edit Amount" })).toContainText(/60,00\s*€/)
    await expect.poll(async () => (await fetchRule(request, id)).amount_cents).toBe(6000)
    expect((await fetchRule(request, id)).name).toBe(renamed)

    await peek.getByRole("button", { name: "Recurring", exact: true }).click()
    await expect(page).not.toHaveURL(/peek=/)
    await expect(page.getByRole("listitem", { name: renamed })).toBeVisible()
  })

  test("changes schedule, end date and switches from sheets and toggles", async ({
    page,
    request,
  }) => {
    const { id, name, categoryName } = await seedRule(request)
    const targetName = `E2E Mobile Target ${unique()}`
    const token = await getCsrfToken(request)
    const targetId = await createCategory(request, token, "expense", targetName)
    await page.goto(`/recurring?peek=${id}`)
    const peek = page.getByRole("complementary", { name })

    await peek.getByRole("button", { name: `Category ${categoryName}` }).click()
    await page.getByRole("option", { name: targetName }).click()
    await expect(peek.getByRole("button", { name: `Category ${targetName}` })).toBeVisible()
    await expect.poll(async () => (await fetchRule(request, id)).category_id).toBe(targetId)

    await peek.getByRole("button", { name: /^Repeats / }).click()
    await page.getByRole("spinbutton", { name: "Every" }).fill("3")
    await page.getByRole("button", { name: "Save" }).click()
    await expect(peek.getByRole("button", { name: /^Repeats Every 3 months on / })).toBeVisible()
    await expect.poll(async () => (await fetchRule(request, id)).interval_count).toBe(3)

    await peek.getByRole("button", { name: "Ends Never" }).click()
    await page.getByRole("textbox", { name: "Ends" }).fill("2099-12-31")
    await page.getByRole("button", { name: "Save" }).click()
    await expect(peek.getByRole("button", { name: "Ends 31 Dec 2099" })).toBeVisible()
    await expect.poll(async () => (await fetchRule(request, id)).end_date).toBe("2099-12-31")

    await peek.getByRole("switch", { name: "Post automatically" }).click()
    await peek.getByRole("switch", { name: "Skip weekends" }).click()
    await expect.poll(async () => (await fetchRule(request, id)).auto_post).toBe(true)
    await expect.poll(async () => (await fetchRule(request, id)).skip_weekends).toBe(true)
  })

  test("deletes a rule from the actions sheet after confirmation", async ({ page, request }) => {
    const { id, name } = await seedRule(request)
    await page.goto(`/recurring?peek=${id}`)
    const peek = page.getByRole("complementary", { name })
    const confirm = page.getByRole("dialog", { name: `Delete recurring rule "${name}"?` })

    await peek.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Delete rule" }).click()
    await confirm.getByRole("button", { name: "Cancel" }).click()
    await expect(confirm).toBeHidden()
    await expect(peek).toBeVisible()

    await peek.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Delete rule" }).click()
    const deleted = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/recurring/${id}` &&
        response.request().method() === "DELETE",
    )
    await confirm.getByRole("button", { name: "Delete", exact: true }).click()
    expect((await deleted).ok()).toBeTruthy()
    await expect(page.getByRole("listitem", { name })).toHaveCount(0)
    expect(
      ((await (await request.get("/api/recurring")).json()) as { rules: StoredRule[] }).rules.some(
        (rule) => rule.id === id,
      ),
    ).toBe(false)
  })

  test("switches to the Audit view and opens a rule from its true cost", async ({
    page,
    request,
  }) => {
    const { id, name } = await seedRule(request, { amount_cents: 1399 })
    await page.goto("/recurring")

    await page.getByRole("radiogroup", { name: "Recurring view" }).getByRole("radio", { name: "Audit" }).click()
    await expect(page).toHaveURL(/view=audit/)
    const row = page.getByRole("list", { name: "True cost" }).getByRole("listitem", { name })
    await expect(row).toContainText(/13,99\s*€/)
    await row.click()
    await expect(page.getByRole("complementary", { name })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`view=audit.*peek=${id}|peek=${id}.*view=audit`))
  })

  test("shows posted transactions in the peek and opens the compact history", async ({
    page,
    request,
    baseURL,
  }) => {
    const { id, name } = await seedRule(request, {
      amount_cents: 1234,
      auto_post: true,
      interval_unit: "week",
      anchor_date: daysAgo(36),
      next_occurrence: daysAgo(36),
    })
    await runCatchUp(baseURL!)
    await page.goto(`/recurring?peek=${id}`)

    const peek = page.getByRole("complementary", { name })
    await expect(peek.getByRole("list", { name: "Posted" }).getByRole("listitem")).toHaveCount(3)
    await peek.getByRole("button", { name: "All 6" }).click()
    await expect(page).toHaveURL(new RegExp(`/recurring/${id}/occurrences$`))

    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible()
    await expect(page.getByRole("main")).toContainText(/Posted\s*6\s*74,04\s*€ in total/)
    const posted = page.getByRole("list", { name: "Posted transactions" })
    await expect(posted.getByRole("listitem")).toHaveCount(6)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)

    await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Recurring" }).click()
    await expect(page).toHaveURL("/recurring")
  })

  test("deletes the rule from the history page actions", async ({ page, request }) => {
    const { id, name } = await seedRule(request)
    await page.goto(`/recurring/${id}/occurrences`)
    await expect(page.getByText("No occurrences posted yet.")).toBeVisible()

    await page.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Delete rule" }).click()
    await page
      .getByRole("dialog", { name: `Delete recurring rule "${name}"?` })
      .getByRole("button", { name: "Delete", exact: true })
      .click()
    await expect(page).toHaveURL("/recurring")
    await expect(page.getByRole("listitem", { name })).toHaveCount(0)
  })
})
