import { request as playwrightRequest } from "@playwright/test"
import type { APIRequestContext, Page } from "@playwright/test"
import { loginWith } from "./auth-helpers"

type DashboardMockPayload = {
  period: { slug: string; start: string; end: string }
  filters: { type: string | null }
  kpis: { income: number; expenses: number; balance: number }
  sparklines: { income?: string; expenses?: string; balance?: string }
  deltas: { income: number; expenses: number; balance: number } | null
  donut: {
    has_any_transactions: boolean
    mode?: "both" | "expense-only" | "income-only"
    expense_breakdown?: Array<{ name: string; amount_cents: number; percent: number }>
    income_breakdown?: Array<{ name: string; amount_cents: number; percent: number }>
  }
  recent: Array<{
    id: number
    date: string
    occurred_at: string
    type: string
    amount_cents: number
    net_amount_cents: number
    reimbursed_total_cents: number
    is_reimbursement: boolean
    category: { id: number; name: string; type: string; icon: string | null } | null
    title: string | null
    description?: string | null
    tags: Array<{ id: number; name: string }>
  }>
  categories: Array<{ id: number; name: string; type: string; icon: string | null }>
  budget_pace?: {
    velocity_ratio: number
    projected_cents: number
    budget_cents: number
    sparkline: string
  }
  category_budget_summary?: {
    total: number
    needs_attention: number
    priority: {
      scope_category_id: number
      scope_label: string
      amount_cents: number
      spent_cents: number
      remaining_cents: number
      velocity_ratio: number
    }
  }
}

export async function getCsrfToken(request: APIRequestContext): Promise<string> {
  const response = await request.get("/api/csrf")
  const payload = (await response.json()) as { token: string }
  return payload.token
}

// Signs the browser page in as a brand-new account so tests can assert exact
// dashboard states (budget counts, empty states, exact KPI amounts) without
// interference from data other tests seeded for the shared worker admin user.
export async function loginAsIsolatedUser(
  page: Page
): Promise<{ request: APIRequestContext; csrfToken: string }> {
  const credentials = {
    username: `e2e-isolated-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
    password: "hunter22",
  }
  const context = await playwrightRequest.newContext({
    baseURL: new URL(page.url()).origin,
    storageState: { cookies: [], origins: [] },
  })
  const signupResponse = await context.post("/api/auth/signup", {
    data: credentials,
  })
  if (!signupResponse.ok()) {
    throw new Error(
      `signup failed: ${signupResponse.status()} ${await signupResponse.text()}`
    )
  }
  const loginResponse = await context.post("/api/auth/login", {
    data: credentials,
  })
  if (!loginResponse.ok()) {
    throw new Error(`login failed: ${loginResponse.status()}`)
  }
  await page.context().clearCookies()
  await loginWith(page, credentials)
  return { request: context, csrfToken: await getCsrfToken(context) }
}

export async function ensureCategory(
  request: APIRequestContext,
  csrfToken: string,
  type: "income" | "expense",
  namePrefix: string
): Promise<number> {
  const listResponse = await request.get("/api/categories?period=all")
  const listPayload = (await listResponse.json()) as {
    categories: Array<{
      id: number
      name: string
      type: string
      archived_at: string | null
    }>
  }

  const existing = listPayload.categories.find(
    (item) => item.type === type && item.archived_at === null
  )
  if (existing) {
    return existing.id
  }

  const createResponse = await request.post("/api/categories", {
    headers: { "X-CSRF-Token": csrfToken },
    data: {
      name: `${namePrefix} ${Date.now()}`,
      type,
      order: 0,
    },
  })
  const created = (await createResponse.json()) as { id: number }
  return created.id
}

export async function createTransaction(
  request: APIRequestContext,
  csrfToken: string,
  payload: {
    date: string
    occurred_at: string
    type: "income" | "expense"
    amount_cents: number
    category_id: number
    title: string
    description?: string
    tags: string[]
    is_reimbursement?: boolean
  }
): Promise<number> {
  const response = await request.post("/api/transactions", {
    headers: { "X-CSRF-Token": csrfToken },
    data: payload,
  })
  const body = (await response.json()) as { id: number }
  return body.id
}

export async function createIngestToken(
  request: APIRequestContext
): Promise<string> {
  const csrfToken = await getCsrfToken(request)
  const response = await request.post("/api/settings/ingest-token", {
    headers: { "X-CSRF-Token": csrfToken },
  })
  const body = (await response.json()) as { token: string }
  return body.token
}

export async function createIngestTransaction(
  request: APIRequestContext,
  payload: {
    amount_cents: number
    title: string
    date?: string
    category?: string
    latitude?: number
    longitude?: number
  },
  ingestToken?: string
): Promise<number> {
  const token = ingestToken || (await createIngestToken(request))
  const response = await request.post("/api/ingest", {
    headers: { Authorization: `Bearer ${token}` },
    data: payload,
  })
  const body = (await response.json()) as { id: number }
  return body.id
}

export async function uploadAttachment(
  request: APIRequestContext,
  csrfToken: string,
  transactionId: number,
  file: {
    name: string
    mimeType: string
    buffer: Buffer
  }
): Promise<number> {
  const response = await request.post(
    `/api/transactions/${transactionId}/attachments`,
    {
      headers: { "X-CSRF-Token": csrfToken },
      multipart: {
        file: {
          name: file.name,
          mimeType: file.mimeType,
          buffer: file.buffer,
        },
      },
    }
  )
  const body = (await response.json()) as { id: number }
  return body.id
}

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pfdvK0AAAAASUVORK5CYII=",
  "base64"
)

export async function stubOsmTiles(page: Page): Promise<void> {
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      body: onePixelPng,
    })
  )
}

export async function mockDashboardApi(
  page: Page,
  payload: DashboardMockPayload
): Promise<void> {
  await Promise.all([
    page.route("**/api/dashboard?*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(payload),
      }),
    ),
    page.route("**/api/durable-purchases*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [] }),
      }),
    ),
  ])
}

export async function mockVisualSupportingApi(page: Page): Promise<void> {
  await Promise.all([
    page.route("**/api/category-breakdown?*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          months: [
            {
              month: "2026-02",
              balance_cents: 84_500,
              total_cents: 72_000,
              segments: [
                {
                  category_id: 2,
                  name: "Housing",
                  icon: "house",
                  amount_cents: 72_000,
                },
              ],
            },
            {
              month: "2026-03",
              balance_cents: 91_200,
              total_cents: 96_000,
              segments: [
                {
                  category_id: 2,
                  name: "Housing",
                  icon: "house",
                  amount_cents: 72_000,
                },
                {
                  category_id: 1,
                  name: "Food",
                  icon: "fork-knife",
                  amount_cents: 24_000,
                },
              ],
            },
            {
              month: "2026-04",
              balance_cents: 97_600,
              total_cents: 108_000,
              segments: [
                {
                  category_id: 2,
                  name: "Housing",
                  icon: "house",
                  amount_cents: 72_000,
                },
                {
                  category_id: 1,
                  name: "Food",
                  icon: "fork-knife",
                  amount_cents: 36_000,
                },
              ],
            },
            {
              month: "2026-05",
              balance_cents: 103_900,
              total_cents: 121_000,
              segments: [
                {
                  category_id: 2,
                  name: "Housing",
                  icon: "house",
                  amount_cents: 78_000,
                },
                {
                  category_id: 1,
                  name: "Food",
                  icon: "fork-knife",
                  amount_cents: 43_000,
                },
              ],
            },
            {
              month: "2026-06",
              balance_cents: 110_400,
              total_cents: 134_000,
              segments: [
                {
                  category_id: 2,
                  name: "Housing",
                  icon: "house",
                  amount_cents: 84_000,
                },
                {
                  category_id: 1,
                  name: "Food",
                  icon: "fork-knife",
                  amount_cents: 50_000,
                },
              ],
            },
            {
              month: "2026-07",
              balance_cents: 116_700,
              total_cents: 148_950,
              segments: [
                {
                  category_id: 2,
                  name: "Housing",
                  icon: "house",
                  amount_cents: 90_000,
                },
                {
                  category_id: 1,
                  name: "Food",
                  icon: "fork-knife",
                  amount_cents: 58_950,
                },
              ],
            },
          ],
        }),
      }),
    ),
    page.route("**/api/forecast?*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          start_balance_cents: 116_700,
          months: [
            { month: "2026-08", end_balance_cents: 122_000, end_balance_p10_cents: 116_000, end_balance_p90_cents: 128_000 },
            { month: "2026-09", end_balance_cents: 129_000, end_balance_p10_cents: 118_000, end_balance_p90_cents: 140_000 },
            { month: "2026-10", end_balance_cents: 136_000, end_balance_p10_cents: 120_000, end_balance_p90_cents: 152_000 },
            { month: "2026-11", end_balance_cents: 141_000, end_balance_p10_cents: 120_000, end_balance_p90_cents: 162_000 },
            { month: "2026-12", end_balance_cents: 149_000, end_balance_p10_cents: 123_000, end_balance_p90_cents: 175_000 },
            { month: "2027-01", end_balance_cents: 158_000, end_balance_p10_cents: 127_000, end_balance_p90_cents: 189_000 },
          ],
        }),
      }),
    ),
    page.route("**/api/templates", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ templates: [] }),
      }),
    ),
    page.route("**/api/tags?period=all", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ tags: [] }),
      }),
    ),
  ])
}
