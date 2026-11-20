import { expect, request as playwrightRequest } from "@playwright/test"
import type { APIRequestContext, Locator, Page } from "@playwright/test"
import { loginWith } from "./auth-helpers"

// Radix starts handling outside presses and Escape a moment after a layer
// mounts. Wait for the entrance and one timer tick before dismissing it.
export async function waitForEntrance(layer: Locator): Promise<void> {
  await layer.evaluate(async (node) => {
    await Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished))
    await new Promise((resolve) => window.setTimeout(resolve, 0))
  })
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

export async function createCategory(
  request: APIRequestContext,
  csrfToken: string,
  type: "income" | "expense",
  name: string
): Promise<number> {
  const response = await request.post("/api/categories", {
    headers: { "X-CSRF-Token": csrfToken },
    data: { name, type, order: 0 },
  })
  expect(response.ok()).toBeTruthy()
  return ((await response.json()) as { id: number }).id
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

export async function createUncategorizedExpense(
  request: APIRequestContext,
  csrfToken: string,
  title: string,
  amountCents = 1500
): Promise<number> {
  const response = await request.post("/api/transactions", {
    headers: { "X-CSRF-Token": csrfToken },
    data: {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: amountCents,
      title,
      tags: [],
    },
  })
  expect(response.ok()).toBeTruthy()
  return ((await response.json()) as { id: number }).id
}

// Two months of Insights data for a fresh user: last month 2.000 € Salary income and a 500 €
// Rent expense tagged Trip; this month a 120 € Dining expense with a 300 € monthly Dining budget.
export async function provisionInsightsData(request: APIRequestContext, csrfToken: string) {
  const now = new Date()
  const key = (offset: number) => {
    const target = new Date(now.getFullYear(), now.getMonth() + offset, 1)
    return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}`
  }
  const lastMonth = key(-1)
  const thisMonth = key(0)
  const salaryId = await createCategory(request, csrfToken, "income", "Salary")
  const rentId = await createCategory(request, csrfToken, "expense", "Rent")
  const diningId = await createCategory(request, csrfToken, "expense", "Dining")
  const tagResponse = await request.post("/api/tags", {
    headers: { "X-CSRF-Token": csrfToken },
    data: { name: "Trip", is_hidden_from_budget: false },
  })
  expect(tagResponse.ok()).toBeTruthy()
  const tagId = ((await tagResponse.json()) as { id: number }).id
  const add = (
    date: string,
    type: "income" | "expense",
    amount_cents: number,
    category_id: number,
    title: string,
    tags: string[] = []
  ) =>
    createTransaction(request, csrfToken, {
      date,
      occurred_at: `${date}T09:00:00`,
      type,
      amount_cents,
      category_id,
      title,
      tags,
    })
  await add(`${lastMonth}-10`, "income", 200_000, salaryId, "Salary payment")
  await add(`${lastMonth}-12`, "expense", 50_000, rentId, "Rent payment", ["Trip"])
  await add(`${thisMonth}-01`, "expense", 12_000, diningId, "Team dinner")
  const budgetResponse = await request.post("/api/budgets/templates", {
    headers: { "X-CSRF-Token": csrfToken },
    data: {
      frequency: "monthly",
      category_id: diningId,
      amount_cents: 30_000,
      starts_on: `${lastMonth}-01`,
      ends_on: null,
    },
  })
  expect(budgetResponse.ok()).toBeTruthy()
  return { lastMonth, thisMonth, rentId, diningId, tagId }
}
