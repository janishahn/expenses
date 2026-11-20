import type { APIRequestContext } from "@playwright/test"
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

test.describe("Recurring page (mobile)", () => {
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
})
