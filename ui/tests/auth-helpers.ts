import { expect, type APIRequestContext, type Page } from "@playwright/test"

export const ADMIN_USER = { username: "bootstrap-admin", password: "hunter22" }
export const ORDINARY_USER = { username: "ordinary-user", password: "hunter22" }

export async function logoutIfAuthenticated(request: APIRequestContext): Promise<void> {
  const meResponse = await request.get("/api/auth/me")
  const mePayload = (await meResponse.json()) as { authenticated: boolean }
  if (!mePayload.authenticated) {
    return
  }

  const csrfResponse = await request.get("/api/csrf")
  const csrfPayload = (await csrfResponse.json()) as { token: string }
  const logoutResponse = await request.post("/api/auth/logout", {
    headers: { "X-CSRF-Token": csrfPayload.token },
  })
  expect(logoutResponse.ok()).toBeTruthy()
}

export async function ensureBootstrap(request: APIRequestContext): Promise<void> {
  const statusResponse = await request.get("/api/auth/bootstrap-status")
  const status = (await statusResponse.json()) as { setup_required: boolean }

  if (status.setup_required) {
    const setupResponse = await request.post("/api/auth/setup", { data: ADMIN_USER })
    if (setupResponse.ok()) {
      return
    }
    expect([409, 422]).toContain(setupResponse.status())
  }

  await logoutIfAuthenticated(request)
  const loginResponse = await request.post("/api/auth/login", { data: ADMIN_USER })
  expect(loginResponse.ok()).toBeTruthy()

  const meResponse = await request.get("/api/auth/me")
  const mePayload = (await meResponse.json()) as {
    authenticated: boolean
    user: { username: string } | null
  }
  expect(mePayload.authenticated).toBeTruthy()
  expect(mePayload.user?.username).toBe(ADMIN_USER.username)
}

export async function ensureOrdinaryUser(request: APIRequestContext): Promise<void> {
  await ensureBootstrap(request)
  await logoutIfAuthenticated(request)

  const loginResponse = await request.post("/api/auth/login", { data: ORDINARY_USER })
  if (loginResponse.ok()) {
    return
  }

  const signupResponse = await request.post("/api/auth/signup", {
    data: ORDINARY_USER,
  })
  expect([200, 409]).toContain(signupResponse.status())
}

export async function loginWith(
  page: Page,
  credentials: { username: string; password: string }
): Promise<void> {
  if (!page.url().includes("/login")) {
    await page.goto("/login")
  }
  if (!page.url().includes("/login")) {
    return
  }

  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible()
  await page.getByLabel("Username").fill(credentials.username)
  await page.getByLabel("Password").fill(credentials.password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/)
}

export async function ensureElevatedAdmin(page: Page): Promise<void> {
  const request = page.request

  const statusResponse = await request.get("/api/auth/bootstrap-status")
  const statusPayload = (await statusResponse.json()) as { setup_required: boolean }
  if (statusPayload.setup_required) {
    const setupResponse = await request.post("/api/auth/setup", { data: ADMIN_USER })
    expect(setupResponse.ok()).toBeTruthy()
  }

  await page.context().clearCookies()

  const loginResponse = await request.post("/api/auth/login", { data: ADMIN_USER })
  expect(loginResponse.ok()).toBeTruthy()

  const csrfResponse = await request.get("/api/csrf")
  const csrfPayload = (await csrfResponse.json()) as { token: string }
  const elevateResponse = await request.post("/api/auth/admin-elevation", {
    headers: { "X-CSRF-Token": csrfPayload.token },
    data: { password: ADMIN_USER.password },
  })
  expect(elevateResponse.ok()).toBeTruthy()

  await page.goto("/admin")
  await expect(page).toHaveURL("/admin")
  await expect(page.getByRole("navigation", { name: "Admin sections" })).toBeVisible()
}
