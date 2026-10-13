import { request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test"
import { ADMIN_USER } from "./auth-helpers"
import { test, expect } from "./fixtures"
import { createCategory, getCsrfToken, loginAsIsolatedUser } from "./helpers"

test.describe.configure({ mode: "parallel" })

type StoredRule = {
  id: number
  name: string | null
  type: "income" | "expense"
  currency_code: string
  amount_cents: number
  category_id: number
  interval_unit: string
  interval_count: number
  end_date: string | null
  auto_post: boolean
  skip_weekends: boolean
}

const today = () => new Date().toISOString().slice(0, 10)
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
    const catchUp = await admin.post("/api/admin/recurring-catch-up", { headers })
    expect(catchUp.ok()).toBeTruthy()
  } finally {
    await admin.dispose()
  }
}

async function seedRule(
  request: APIRequestContext,
  token: string,
  categoryId: number,
  overrides: Partial<Record<string, unknown>> = {},
): Promise<{ id: number; name: string }> {
  const name = `E2E Rule ${Date.now()}-${Math.floor(Math.random() * 100000)}`
  const response = await request.post("/api/recurring", {
    headers: { "X-CSRF-Token": token },
    data: {
      name,
      type: "expense",
      currency_code: "EUR",
      amount_cents: 4200,
      category_id: categoryId,
      anchor_date: today(),
      interval_unit: "month",
      interval_count: 1,
      next_occurrence: today(),
      end_date: null,
      auto_post: false,
      skip_weekends: false,
      month_day_policy: "snap_to_end",
      ...overrides,
    },
  })
  expect(response.ok()).toBeTruthy()
  const created = (await response.json()) as { id: number }
  return { id: created.id, name: (overrides.name as string | undefined) ?? name }
}

async function fetchRule(request: APIRequestContext, id: number): Promise<StoredRule> {
  const response = await request.get("/api/recurring")
  expect(response.ok()).toBeTruthy()
  const payload = (await response.json()) as { rules: StoredRule[] }
  const rule = payload.rules.find((entry) => entry.id === id)
  expect(rule).toBeTruthy()
  return rule!
}

async function seedExpenseCategory(request: APIRequestContext, label: string) {
  const token = await getCsrfToken(request)
  const categoryName = `E2E ${label} ${Date.now()}-${Math.floor(Math.random() * 100000)}`
  const categoryId = await createCategory(request, token, "expense", categoryName)
  return { token, categoryId, categoryName }
}

const addRule = (page: Page) =>
  page.locator("main header").getByRole("button", { name: "Add rule" })

test.describe("Recurring page", () => {
  test("switches between Commitments and Audit with the URL-backed view control", async ({
    page,
    request,
  }) => {
    const { token, categoryId } = await seedExpenseCategory(request, "Views")
    const { name } = await seedRule(request, token, categoryId)
    await page.goto("/recurring")

    const views = page.getByRole("radiogroup", { name: "Recurring view" })
    await expect(views.getByRole("radio", { name: "Commitments" })).toBeChecked()
    await expect(page.getByRole("list", { name: "Recurring rules" })).toBeVisible()
    await expect(page.getByRole("list", { name: "True cost" })).toHaveCount(0)

    await views.getByRole("radio", { name: "Audit" }).click()
    await expect(page).toHaveURL(/view=audit/)
    await expect(views.getByRole("radio", { name: "Audit" })).toBeChecked()
    await expect(page.getByRole("list", { name: "True cost" })).toBeVisible()
    await expect(page.getByRole("listitem", { name })).toBeVisible()

    await views.getByRole("radio", { name: "Commitments" }).click()
    await expect(page).not.toHaveURL(/view=audit/)
    await expect(page.getByRole("list", { name: "Recurring rules" })).toBeVisible()
  })

  test("shows exact monthly totals, coverage and the Audit figures", async ({ page }) => {
    await page.goto("/recurring")
    const { request, csrfToken } = await loginAsIsolatedUser(page)
    try {
      const expenseId = await createCategory(request, csrfToken, "expense", "Stats expense")
      const incomeId = await createCategory(request, csrfToken, "income", "Stats income")
      await seedRule(request, csrfToken, expenseId, { name: "Gym", amount_cents: 2000 })
      await seedRule(request, csrfToken, expenseId, { name: "Phone", amount_cents: 1000 })
      await seedRule(request, csrfToken, incomeId, {
        name: "Salary",
        type: "income",
        amount_cents: 10000,
      })

      await page.goto("/recurring")
      await expect(page.getByText("Expenses per month", { exact: true })).toBeVisible()
      const strip = page.locator("main")
      await expect(strip).toContainText(/Income per month\s*\+\s*100,00\s*€\s*1 rule/)
      await expect(strip).toContainText(/Expenses per month\s*30,00\s*€\s*2 rules/)
      await expect(strip).toContainText(/Covered\s*333 %\s*\+\s*70\s*€ left per month/)

      const rows = page.getByRole("list", { name: "Recurring rules" })
      await expect(rows.getByRole("listitem", { name: "Gym" })).toContainText(/20,00\s*€/)
      await expect(rows.getByRole("listitem", { name: "Salary" })).toContainText(/100,00\s*€/)

      await page.getByRole("radio", { name: "Audit" }).click()
      await expect(strip).toContainText(/Per month\s*30,00\s*€\s*2 expense rules/)
      await expect(strip).toContainText(/Per year\s*360,00\s*€/)
      await expect(strip).toContainText(/Over 5 years\s*1\s800\s*€/)
      const audit = page.getByRole("list", { name: "True cost" })
      await expect(audit.getByRole("listitem", { name: "Gym" })).toContainText(/20,00\s*€/)
      await expect(audit.getByRole("listitem", { name: "Gym" })).toContainText(/240\s*€/)
      await expect(audit.getByRole("listitem", { name: "Gym" })).toContainText(/1\s200\s*€/)

      await page
        .getByRole("region", { name: "Annual mix" })
        .getByRole("button", { name: "Chart options" })
        .click()
      await page.getByRole("menuitemcheckbox", { name: "Show as table" }).click()
      const table = page.getByRole("table", { name: "Annual cost by category" })
      await expect(table).toContainText("Stats expense")
      await expect(table).toContainText(/360,00\s*€/)
      await expect(table).toContainText("100 %")
    } finally {
      await request.dispose()
    }
  })

  test("creates a rule from the Add rule dialog with schedule and preview", async ({
    page,
    request,
  }) => {
    const { categoryName } = await seedExpenseCategory(request, "Create")
    const name = `E2E Create ${Date.now()}`
    await page.goto("/recurring")

    await addRule(page).click()
    const dialog = page.getByRole("dialog", { name: "Add rule" })
    await expect(dialog).toBeVisible()
    await dialog.getByRole("textbox", { name: "Amount" }).fill("42,50")
    await dialog.getByRole("textbox", { name: "Name" }).fill(name)

    await dialog.getByRole("button", { name: /^Category / }).click()
    await page.getByRole("option", { name: categoryName }).click()
    await expect(dialog.getByRole("button", { name: `Category ${categoryName}` })).toBeVisible()

    await dialog.getByRole("button", { name: "Repeats Every month" }).click()
    await page.getByRole("spinbutton", { name: "Every" }).fill("2")
    await page.getByRole("button", { name: "Done" }).click()
    await expect(dialog.getByRole("button", { name: "Repeats Every 2 months" })).toBeVisible()
    await expect(dialog).toContainText(/^.*Next \d{1,2} \w{3}/s)

    await dialog.getByRole("button", { name: "Add rule" }).click()
    await expect(dialog).toBeHidden()

    const row = page.getByRole("listitem", { name })
    await expect(row).toBeVisible()
    await expect(row).toContainText(/42,50\s*€/)
    await expect(row).toContainText("Every 2 months")

    const stored = (await (await request.get("/api/recurring")).json()) as {
      rules: StoredRule[]
    }
    const created = stored.rules.find((rule) => rule.name === name)
    expect(created).toMatchObject({
      type: "expense",
      amount_cents: 4250,
      currency_code: "EUR",
      interval_unit: "month",
      interval_count: 2,
      auto_post: true,
      skip_weekends: false,
    })
  })

  test("toggles Post automatically and Skip weekends in the Add rule dialog", async ({
    page,
  }) => {
    await page.goto("/recurring")
    await addRule(page).click()
    const dialog = page.getByRole("dialog", { name: "Add rule" })

    const post = dialog.getByRole("button", { name: "Post automatically" })
    const weekends = dialog.getByRole("button", { name: "Skip weekends" })
    await expect(post).toHaveAttribute("aria-pressed", "true")
    await expect(weekends).toHaveAttribute("aria-pressed", "false")

    await post.click()
    await weekends.click()
    await expect(post).toHaveAttribute("aria-pressed", "false")
    await expect(weekends).toHaveAttribute("aria-pressed", "true")
  })

  test("validates the amount before adding a rule", async ({ page }) => {
    await page.goto("/recurring")
    await addRule(page).click()
    const dialog = page.getByRole("dialog", { name: "Add rule" })

    await dialog.getByRole("textbox", { name: "Amount" }).fill("abc")
    await dialog.getByRole("button", { name: "Add rule" }).click()
    await expect(dialog.getByRole("alert")).toHaveText("Enter a valid amount.")
    await expect(dialog).toBeVisible()

    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(dialog).toBeHidden()
  })

  test("edits the name and amount inline and shows the cost figures", async ({
    page,
    request,
  }) => {
    const { token, categoryId } = await seedExpenseCategory(request, "Inline")
    const { id, name } = await seedRule(request, token, categoryId)
    await page.goto(`/recurring?peek=${id}`)
    const peek = page.getByRole("complementary", { name })

    await expect(peek.getByRole("button", { name: "Edit Amount" })).toContainText(/42,00\s*€/)
    await expect(peek.getByRole("button", { name: "Edit Amount" })).toContainText("every month")
    const cost = peek.locator("section").filter({ hasText: "Cost" })
    await expect(cost).toContainText(/Per day\s*1,38\s*€/)
    await expect(cost).toContainText(/Per year\s*504,00\s*€/)
    await expect(cost).toContainText(/5 years\s*2\s520,00\s*€/)

    const renamed = `${name} renamed`
    await peek.getByRole("button", { name: "Edit Name" }).click()
    await peek.getByRole("textbox", { name: "Name" }).fill(renamed)
    await peek.getByRole("textbox", { name: "Name" }).press("Enter")
    await expect(page.getByRole("complementary", { name: renamed })).toBeVisible()
    await expect(page.getByRole("listitem", { name: renamed })).toBeVisible()
    expect((await fetchRule(request, id)).name).toBe(renamed)

    await peek.getByRole("button", { name: "Edit Amount" }).click()
    await peek.getByRole("textbox", { name: "Amount" }).fill("60,00")
    await peek.getByRole("textbox", { name: "Amount" }).press("Enter")
    await expect(peek.getByRole("button", { name: "Edit Amount" })).toContainText(/60,00\s*€/)
    await expect(cost).toContainText(/Per year\s*720,00\s*€/)
    await expect.poll(async () => (await fetchRule(request, id)).amount_cents).toBe(6000)

    await peek.getByRole("button", { name: "Edit Name" }).click()
    await peek.getByRole("textbox", { name: "Name" }).fill("Discarded")
    await peek.getByRole("textbox", { name: "Name" }).press("Escape")
    await expect(peek.getByRole("button", { name: "Edit Name" })).toContainText(renamed)
    expect((await fetchRule(request, id)).name).toBe(renamed)
  })

  test("changes type, category, schedule, end date and currency from the peek properties", async ({
    page,
    request,
  }) => {
    const { token, categoryId } = await seedExpenseCategory(request, "Props")
    const targetName = `E2E Target ${Date.now()}`
    const targetId = await createCategory(request, token, "expense", targetName)
    const { id, name } = await seedRule(request, token, categoryId)
    await page.goto(`/recurring?peek=${id}`)
    const peek = page.getByRole("complementary", { name })

    await peek.getByRole("button", { name: /^Category / }).click()
    await page.getByRole("option", { name: targetName }).click()
    await expect(peek.getByRole("button", { name: `Category ${targetName}` })).toBeVisible()
    await expect.poll(async () => (await fetchRule(request, id)).category_id).toBe(targetId)

    await peek.getByRole("button", { name: /^Repeats / }).click()
    await page.getByRole("spinbutton", { name: "Every" }).fill("3")
    await page.getByRole("combobox", { name: "Unit" }).selectOption("week")
    await page.getByRole("button", { name: "Save" }).click()
    await expect(peek.getByRole("button", { name: /^Repeats Every 3 weeks on / })).toBeVisible()
    await expect
      .poll(async () => {
        const rule = await fetchRule(request, id)
        return `${rule.interval_count} ${rule.interval_unit}`
      })
      .toBe("3 week")

    await peek.getByRole("button", { name: "Ends Never" }).click()
    const endDate = "2099-12-31"
    await page.getByRole("textbox", { name: "Ends" }).fill(endDate)
    await page.getByRole("button", { name: "Save" }).click()
    await expect(peek.getByRole("button", { name: "Ends 31 Dec 2099" })).toBeVisible()
    await expect.poll(async () => (await fetchRule(request, id)).end_date).toBe(endDate)

    await peek.getByRole("button", { name: "Ends 31 Dec 2099" }).click()
    await page.getByRole("button", { name: "No end" }).click()
    await expect(peek.getByRole("button", { name: "Ends Never" })).toBeVisible()
    await expect.poll(async () => (await fetchRule(request, id)).end_date).toBeNull()

    await peek.getByRole("button", { name: "Currency Euro (€)" }).click()
    await page.getByRole("menuitemcheckbox", { name: "US dollar ($)" }).click()
    await expect(peek.getByRole("button", { name: "Currency US dollar ($)" })).toBeVisible()
    await expect.poll(async () => (await fetchRule(request, id)).currency_code).toBe("USD")
  })

  test("switches a rule to income and toggles automatic posting and weekends", async ({
    page,
    request,
  }) => {
    const { token, categoryId } = await seedExpenseCategory(request, "Switches")
    await createCategory(request, token, "income", `E2E Income ${Date.now()}`)
    const { id, name } = await seedRule(request, token, categoryId, { auto_post: false })
    await page.goto(`/recurring?peek=${id}`)
    const peek = page.getByRole("complementary", { name })

    const post = peek.getByRole("switch", { name: "Post automatically" })
    await expect(post).not.toBeChecked()
    await post.click()
    await expect(post).toBeChecked()
    await expect(peek).toContainText("Automatically")
    await expect.poll(async () => (await fetchRule(request, id)).auto_post).toBe(true)

    const weekends = peek.getByRole("switch", { name: "Skip weekends" })
    await weekends.click()
    await expect(weekends).toBeChecked()
    await expect(peek).toContainText("Moved to Monday")
    await expect.poll(async () => (await fetchRule(request, id)).skip_weekends).toBe(true)

    await peek.getByRole("button", { name: "Type Expense" }).click()
    await page.getByRole("menuitemcheckbox", { name: "Income" }).click()
    await expect(peek.getByRole("button", { name: "Type Income" })).toBeVisible()
    await expect.poll(async () => (await fetchRule(request, id)).type).toBe("income")
    await expect(peek.locator("section").filter({ hasText: "Cost" })).toHaveCount(0)
  })

  test("keeps the entered amount and explains a failed save", async ({ page, request }) => {
    const { token, categoryId } = await seedExpenseCategory(request, "Failure")
    const { id, name } = await seedRule(request, token, categoryId)
    await page.goto(`/recurring?peek=${id}`)
    const peek = page.getByRole("complementary", { name })

    await peek.getByRole("button", { name: "Edit Amount" }).click()
    const amount = peek.getByRole("textbox", { name: "Amount" })
    await amount.fill("abc")
    await amount.press("Enter")
    await expect(peek.getByRole("alert")).toHaveText("Enter a valid amount.")
    await expect(amount).toHaveValue("abc")
    await amount.press("Escape")
    await expect(peek.getByRole("alert")).toHaveCount(0)

    await page.route(
      `**/api/recurring/${id}`,
      (route) =>
        route.request().method() === "PUT"
          ? route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({ detail: "Recurring rules are temporarily unavailable." }),
            })
          : route.fallback(),
      { times: 1 },
    )
    await peek.getByRole("button", { name: "Edit Amount" }).click()
    await peek.getByRole("textbox", { name: "Amount" }).fill("77,00")
    await peek.getByRole("textbox", { name: "Amount" }).press("Enter")
    await expect(peek.getByRole("alert")).toHaveText(
      "Recurring rules are temporarily unavailable.",
    )
    await expect(peek.getByRole("textbox", { name: "Amount" })).toHaveValue("77,00")
    expect((await fetchRule(request, id)).amount_cents).toBe(4200)

    await peek.getByRole("textbox", { name: "Amount" }).press("Enter")
    await expect(peek.getByRole("button", { name: "Edit Amount" })).toContainText(/77,00\s*€/)
    await expect.poll(async () => (await fetchRule(request, id)).amount_cents).toBe(7700)
  })

  test("lists posted occurrences in the peek and opens the full history", async ({
    page,
    request,
    baseURL,
  }) => {
    const { token, categoryId } = await seedExpenseCategory(request, "Posted")
    const { id, name } = await seedRule(request, token, categoryId, {
      amount_cents: 1234,
      auto_post: true,
      interval_unit: "week",
      anchor_date: daysAgo(36),
      next_occurrence: daysAgo(36),
    })
    await runCatchUp(baseURL!)

    await page.goto(`/recurring?peek=${id}`)
    const peek = page.getByRole("complementary", { name })
    const posted = peek.getByRole("list", { name: "Posted" })
    await expect(posted.getByRole("listitem")).toHaveCount(3)
    await expect(posted).toContainText(/12,34\s*€/)

    await peek.getByRole("button", { name: "All 6" }).click()
    await expect(page).toHaveURL(new RegExp(`/recurring/${id}/occurrences$`))
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible()
    await expect(page.getByRole("list", { name: "Posted transactions" }).getByRole("listitem")).toHaveCount(6)
  })

  test("requires confirmation before deleting a rule from the peek", async ({
    page,
    request,
  }) => {
    const { token, categoryId } = await seedExpenseCategory(request, "Delete")
    const { id, name } = await seedRule(request, token, categoryId)
    await page.goto(`/recurring?peek=${id}`)
    const peek = page.getByRole("complementary", { name })
    const confirm = page.getByRole("dialog", { name: `Delete recurring rule "${name}"?` })

    await peek.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Delete rule" }).click()
    await expect(confirm).toBeVisible()
    await confirm.getByRole("button", { name: "Cancel" }).click()
    await expect(confirm).toBeHidden()
    await expect(page.getByRole("listitem", { name })).toBeVisible()
    await fetchRule(request, id)

    await peek.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Delete rule" }).click()
    await confirm.getByRole("button", { name: "Delete", exact: true }).click()
    await expect(page.getByRole("listitem", { name })).toHaveCount(0)
    await expect(peek).toBeHidden()
    const remaining = (await (await request.get("/api/recurring")).json()) as {
      rules: StoredRule[]
    }
    expect(remaining.rules.some((rule) => rule.id === id)).toBe(false)
  })

  test("opens a rule's peek from the Audit view", async ({ page, request }) => {
    const { token, categoryId } = await seedExpenseCategory(request, "Audit")
    const { id, name } = await seedRule(request, token, categoryId, { amount_cents: 1399 })
    await page.goto("/recurring?view=audit")

    const row = page.getByRole("list", { name: "True cost" }).getByRole("listitem", { name })
    await expect(row).toContainText(/13,99\s*€/)
    await row.click()
    await expect(page).toHaveURL(new RegExp(`peek=${id}`))
    await expect(page.getByRole("complementary", { name })).toBeVisible()

    await page.getByRole("complementary", { name }).getByRole("button", { name: "Close" }).click()
    await expect(page.getByRole("complementary", { name })).toBeHidden()
  })

  test("shows an empty state with an Add rule action for a new account", async ({ page }) => {
    await page.goto("/recurring")
    const { request } = await loginAsIsolatedUser(page)
    try {
      await page.goto("/recurring")
      await expect(page.getByText("No recurring rules yet.")).toBeVisible()
      await page.getByRole("main").getByRole("button", { name: "Add rule" }).last().click()
      await expect(page.getByRole("dialog", { name: "Add rule" })).toBeVisible()
    } finally {
      await request.dispose()
    }
  })
})
