import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, type APIRequestContext, type Page } from "@playwright/test"
import { ensureElevatedAdmin } from "./auth-helpers"
import { authenticatedSurfaces } from "./surface-contracts"
import {
  createTransaction,
  ensureCategory,
  getCsrfToken,
} from "./helpers"

type AuditTheme = "light" | "dark"
type AuditLayout =
  | "desktop-chromium"
  | "mobile-webkit"
  | "mobile-chromium-fallback"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const artifactRoot = process.env.UI_POLISH_AUDIT_ARTIFACT_DIR
  ? resolve(repoRoot, process.env.UI_POLISH_AUDIT_ARTIFACT_DIR)
  : null

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

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

// Computed colors of the theme tokens (canvas, panel, ink) in tokens.css.
const THEME_COLORS = {
  light: { canvas: "rgb(234, 234, 231)", panel: "rgb(245, 245, 243)", ink: "rgb(28, 28, 26)" },
  dark: { canvas: "rgb(17, 16, 14)", panel: "rgb(24, 23, 21)", ink: "rgb(238, 235, 230)" },
} as const

async function checkSurface(
  page: Page,
  layout: AuditLayout,
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
  if (layout !== "desktop-chromium") {
    const expectedMaxTouchPoints = layout === "mobile-webkit" ? 0 : 1
    await expect
      .poll(() =>
        page.evaluate(() => ({
          coarse: window.matchMedia("(hover: none) and (pointer: coarse)").matches,
          maxTouchPoints: navigator.maxTouchPoints,
        })),
      )
      .toEqual({ coarse: true, maxTouchPoints: expectedMaxTouchPoints })
  }

  const rendered = await page.evaluate(() => {
    const main = document.querySelector("main")!
    const heading = main.querySelector("h1")
    return {
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      canvas: getComputedStyle(document.body).backgroundColor,
      panel: getComputedStyle(main).backgroundColor,
      ink: heading ? getComputedStyle(heading).color : null,
      inShell: Boolean(document.querySelector('[data-testid="app-shell-root"]')),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
  const expected = THEME_COLORS[theme]
  const where = `${name} (${path}) in ${theme}`
  expect(rendered.colorScheme, where).toBe(theme)
  expect(rendered.canvas, where).toBe(expected.canvas)
  if (rendered.inShell) expect(rendered.panel, where).toBe(expected.panel)
  expect(rendered.ink, where).toBe(expected.ink)
  expect(rendered.overflow, where).toBeLessThanOrEqual(0)

  if (artifactRoot) {
    const directory = resolve(artifactRoot, layout, theme)
    mkdirSync(directory, { recursive: true })
    await page.screenshot({ path: resolve(directory, `${slug(name)}.png`), fullPage: true })
  }
}

export async function runRouteThemeAudit(
  page: Page,
  request: APIRequestContext,
  layout: AuditLayout,
  theme: AuditTheme,
) {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme })
  if (layout !== "desktop-chromium") {
    const expectedMaxTouchPoints = layout === "mobile-webkit" ? 0 : 1
    await expect
      .poll(() =>
        page.evaluate(() => ({
          coarse: window.matchMedia("(hover: none) and (pointer: coarse)").matches,
          maxTouchPoints: navigator.maxTouchPoints,
        })),
      )
      .toEqual({ coarse: true, maxTouchPoints: expectedMaxTouchPoints })
  }
  const checkIsolatedSurface = async (name: string, path: string) => {
    const surfacePage = await page.context().newPage()
    await surfacePage.emulateMedia({ reducedMotion: "reduce", colorScheme: theme })
    await surfacePage.addInitScript((selectedTheme) => {
      window.localStorage.setItem("ew.theme.preference", selectedTheme)
    }, theme)
    try {
      await checkSurface(surfacePage, layout, theme, name, path)
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
