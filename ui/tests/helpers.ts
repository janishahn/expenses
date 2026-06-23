import type { APIRequestContext, Page } from "@playwright/test"

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
}

export async function getCsrfToken(request: APIRequestContext): Promise<string> {
  const response = await request.get("/api/csrf")
  const payload = (await response.json()) as { token: string }
  return payload.token
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
