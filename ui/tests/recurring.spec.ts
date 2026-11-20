import type { APIRequestContext, Page } from "@playwright/test"
import { test, expect } from "./fixtures"
import { createCategory, getCsrfToken } from "./helpers"

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
  next_occurrence: string
  end_date: string | null
  auto_post: boolean
  skip_weekends: boolean
}

const today = () => new Date().toISOString().slice(0, 10)
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

    await peek.getByRole("button", { name: "Edit Name" }).click()
    await peek.getByRole("textbox", { name: "Name" }).fill("")
    await peek.getByRole("textbox", { name: "Name" }).press("Enter")
    await expect(peek.getByText("Enter a name.")).toBeVisible()
    await peek.getByRole("textbox", { name: "Name" }).press("Escape")
    await expect(peek.getByRole("button", { name: "Edit Name" })).toContainText(renamed)
    expect((await fetchRule(request, id)).name).toBe(renamed)
  })

  // A weekly rule from Thursday 1 Jan 2026 whose next posting is a Thursday at least four days ahead.
  async function seedThursdayRule(request: APIRequestContext) {
    const { token, categoryId } = await seedExpenseCategory(request, "Start")
    const next = new Date(Date.now() + 4 * 86_400_000)
    while (next.getUTCDay() !== 4) next.setUTCDate(next.getUTCDate() + 1)
    const nextIso = next.toISOString().slice(0, 10)
    const { id, name } = await seedRule(request, token, categoryId, {
      anchor_date: "2026-01-01",
      next_occurrence: nextIso,
      interval_unit: "week",
    })
    const monday = new Date(next.getTime() - 3 * 86_400_000).toISOString().slice(0, 10)
    return { id, name, next: nextIso, monday }
  }

  async function changeStartToMonday(page: Page, name: string) {
    const peek = page.getByRole("complementary", { name })
    await expect(peek.getByRole("button", { name: "Repeats Every week on Thursday" })).toBeVisible()
    await peek.getByRole("button", { name: "Starts 1 Jan 2026" }).click()
    await page.getByRole("textbox", { name: "Starts" }).fill("2025-12-29")
    await page.getByRole("button", { name: "Save" }).click()
    await expect(peek.getByRole("button", { name: "Repeats Every week on Monday" })).toBeVisible()
    return peek
  }

  test("keeps the moved next occurrence when another edit follows before the start is saved", async ({
    page,
    request,
  }) => {
    const { id, name, monday } = await seedThursdayRule(request)
    await page.goto(`/recurring?peek=${id}`)
    // The start's save is held, so the next edit queues behind it as on a slow connection.
    let release = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    await page.route(
      `**/api/recurring/${id}`,
      async (route) => {
        await held
        await route.continue()
      },
      { times: 1 },
    )
    const peek = await changeStartToMonday(page, name)
    await peek.getByRole("switch", { name: "Skip weekends" }).click()
    release()

    await expect
      .poll(async () => {
        const rule = await fetchRule(request, id)
        return `${rule.next_occurrence} ${rule.skip_weekends}`
      })
      .toBe(`${monday} true`)
  })
})
