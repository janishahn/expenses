import { expect, type APIRequestContext, type Page } from "@playwright/test"
import { ensureElevatedAdmin } from "./auth-helpers"
import { authenticatedSurfaces } from "./surface-contracts"
import {
  createTransaction,
  ensureCategory,
  getCsrfToken,
} from "./helpers"

type AuditTheme = "light" | "dark"

async function seedDynamicSurfaces(request: APIRequestContext) {
  const csrfToken = await getCsrfToken(request)
  const categoryId = await ensureCategory(
    request,
    csrfToken,
    "expense",
    "Audit expense",
  )
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
  const tagName = `Audit tag ${suffix}`
  const tagResponse = await request.post("/api/tags", {
    headers: { "X-CSRF-Token": csrfToken },
    data: { name: tagName, is_hidden_from_budget: false },
  })
  expect(tagResponse.ok()).toBeTruthy()
  const tagId = ((await tagResponse.json()) as { id: number }).id

  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const transactionId = await createTransaction(request, csrfToken, {
    date: today,
    occurred_at: now.toISOString(),
    type: "expense",
    amount_cents: 4_299,
    category_id: categoryId,
    title: "Audit grocery receipt",
    description: "Deterministic populated detail state for the route audit.",
    tags: [tagName],
  })

  const recurringResponse = await request.post("/api/recurring", {
    headers: { "X-CSRF-Token": csrfToken },
    data: {
      name: `Audit recurring ${suffix}`,
      type: "expense",
      currency_code: "EUR",
      amount_cents: 1_299,
      category_id: categoryId,
      anchor_date: today,
      interval_unit: "month",
      interval_count: 1,
      next_occurrence: today,
      end_date: null,
      auto_post: false,
      skip_weekends: false,
      month_day_policy: "snap_to_end",
    },
  })
  expect(recurringResponse.ok()).toBeTruthy()
  const recurringId = ((await recurringResponse.json()) as { id: number }).id

  return { tagId, transactionId, recurringId }
}

async function checkSurface(
  page: Page,
  theme: AuditTheme,
  name: string,
  path: string,
) {
  await page.goto(path, { waitUntil: "networkidle" })
  await expect(page.getByRole("main").first()).toBeVisible()
  await expect(page.getByTestId("route-loading")).toHaveCount(0, {
    timeout: 10_000,
  })
  await expect(page.getByTestId("app-loading-fallback")).toHaveCount(0, {
    timeout: 10_000,
  })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
    .toBe(theme)

  const rendered = await page.evaluate(() => ({
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }))
  const where = `${name} (${path}) in ${theme}`
  expect(rendered.colorScheme, where).toBe(theme)
  expect(rendered.overflow, where).toBeLessThanOrEqual(0)
}

export async function runRouteThemeAudit(
  page: Page,
  request: APIRequestContext,
  theme: AuditTheme,
) {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme })
  const checkIsolatedSurface = async (name: string, path: string) => {
    const surfacePage = await page.context().newPage()
    await surfacePage.emulateMedia({ reducedMotion: "reduce", colorScheme: theme })
    await surfacePage.addInitScript((selectedTheme) => {
      window.localStorage.setItem("ew.theme.preference", selectedTheme)
    }, theme)
    try {
      await checkSurface(surfacePage, theme, name, path)
    } finally {
      await surfacePage.close()
    }
  }

  const dynamic = await seedDynamicSurfaces(request)
  const surfaces = [
    ...authenticatedSurfaces,
    {
      name: "Transaction detail populated",
      path: `/transactions/${dynamic.transactionId}`,
    },
    {
      name: "Transaction edit populated",
      path: `/transactions/${dynamic.transactionId}/edit`,
    },
    { name: "Tag detail populated", path: `/tags/${dynamic.tagId}?period=all` },
    {
      name: "Recurring occurrences populated",
      path: `/recurring/${dynamic.recurringId}/occurrences`,
    },
    { name: "Unknown route", path: "/audit-route-does-not-exist" },
  ]

  for (const surface of surfaces) {
    await checkIsolatedSurface(surface.name, surface.path)
  }

  await ensureElevatedAdmin(page)
  await checkIsolatedSurface("Admin elevated", "/admin")
  await checkIsolatedSurface("Admin import elevated", "/admin/import")
}
