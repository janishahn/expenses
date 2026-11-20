import { request as playwrightRequest } from "@playwright/test"
import { ADMIN_USER } from "./auth-helpers"
import { expect, test } from "./fixtures"
import { createCategory, getCsrfToken } from "./helpers"

test.describe.configure({ mode: "parallel" })

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

async function seedWeeklyRule(
  request: Parameters<typeof getCsrfToken>[0],
  autoPost: boolean,
) {
  const token = await getCsrfToken(request)
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 100000)}`
  const categoryId = await createCategory(request, token, "expense", `E2E History ${stamp}`)
  const name = `E2E History ${stamp}`
  const response = await request.post("/api/recurring", {
    headers: { "X-CSRF-Token": token },
    data: {
      name,
      type: "expense",
      currency_code: "EUR",
      amount_cents: 12345,
      category_id: categoryId,
      anchor_date: daysAgo(36),
      interval_unit: "week",
      interval_count: 1,
      next_occurrence: daysAgo(36),
      end_date: null,
      auto_post: autoPost,
      skip_weekends: false,
      month_day_policy: "snap_to_end",
    },
  })
  expect(response.ok()).toBeTruthy()
  return { id: ((await response.json()) as { id: number }).id, name }
}

test.describe("Recurring occurrences page", () => {
  test("shows the rule summary and every posted transaction with exact amounts", async ({
    page,
    request,
    baseURL,
  }) => {
    const { id, name } = await seedWeeklyRule(request, true)
    await runCatchUp(baseURL!)

    await page.goto(`/recurring/${id}/occurrences`)
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible()
    const main = page.getByRole("main")
    await expect(main).toContainText(/Amount\s*123,45\s*€\s*every week/)
    await expect(main).toContainText(/Posting\s*Automatic\s*no end date/)
    await expect(main).toContainText(/Posted\s*6\s*740,70\s*€ in total/)

    const posted = page.getByRole("list", { name: "Posted transactions" })
    await expect(posted.getByRole("listitem")).toHaveCount(6)
    await expect(posted.getByRole("listitem").first()).toContainText(/123,45\s*€/)

    await posted.getByRole("listitem").first().click()
    await expect(page).toHaveURL(/\/transactions\/\d+/)
  })
})
