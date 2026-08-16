import { mkdirSync, writeFileSync } from "node:fs"
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

async function captureSurface(
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
  if (!artifactRoot) return

  const artifactDirectory = resolve(
    artifactRoot,
    layout,
    theme,
  )
  mkdirSync(artifactDirectory, { recursive: true })
  const basename = slug(name)

  const manifest = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth
    const viewportHeight = document.documentElement.clientHeight
    const controls = Array.from(
      document.querySelectorAll<HTMLElement>(
        "a[href], button, input, select, textarea, [role='button'], [role='link'], [role='tab'], [role='switch'], [role='menuitem']",
      ),
    )
      .filter((element) => {
        const style = window.getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.opacity !== "0" &&
          style.pointerEvents !== "none" &&
          rect.width > 0 &&
          rect.height > 0
        )
      })
      .map((element, index) => {
        const rect = element.getBoundingClientRect()
        const pseudoBox = (pseudo: "::before" | "::after") => {
          const style = window.getComputedStyle(element, pseudo)
          if (style.content === "none") return null
          const number = (value: string) => {
            const parsed = Number.parseFloat(value)
            return Number.isFinite(parsed) ? parsed : 0
          }
          return {
            width: Math.round(rect.width - number(style.left) - number(style.right)),
            height: Math.round(rect.height - number(style.top) - number(style.bottom)),
            inset: {
              top: style.top,
              right: style.right,
              bottom: style.bottom,
              left: style.left,
            },
          }
        }
        const labels = "labels" in element
          ? Array.from((element as HTMLInputElement).labels ?? [])
          : element.closest("label")
            ? [element.closest("label")!]
            : []
        const labelBoxes = labels.map((label) => {
          const labelRect = label.getBoundingClientRect()
          return {
            width: Math.round(labelRect.width),
            height: Math.round(labelRect.height),
          }
        })
        return {
          index,
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute("role"),
          type: element.getAttribute("type"),
          text: (element.innerText || "").trim().replace(/\s+/g, " ").slice(0, 160),
          ariaLabel: element.getAttribute("aria-label"),
          title: element.getAttribute("title"),
          href: element.getAttribute("href"),
          disabled:
            element.hasAttribute("disabled") ||
            element.getAttribute("aria-disabled") === "true",
          checked: element.getAttribute("aria-checked"),
          expanded: element.getAttribute("aria-expanded"),
          selected: element.getAttribute("aria-selected"),
          box: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
          generatedTargets: {
            before: pseudoBox("::before"),
            after: pseudoBox("::after"),
          },
          enclosingLabels: labelBoxes,
          coarsePointer: window.matchMedia("(hover: none) and (pointer: coarse)").matches,
        }
      })
    const overflowing = Array.from(document.body.querySelectorAll<HTMLElement>("*"))
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ element, rect }) => {
        const style = window.getComputedStyle(element)
        return (
          !element.closest(".sr-only") &&
          !element.closest(".app-sidebar:not(.app-sidebar-open)") &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.opacity !== "0" &&
          rect.width > 0 &&
          (rect.right > viewportWidth + 1 || rect.left < -1)
        )
      })
      .slice(0, 20)
      .map(({ element, rect }) => ({
        tag: element.tagName.toLowerCase(),
        className: element.getAttribute("class") || "",
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
      }))
    return {
      url: window.location.href,
      title: document.title,
      theme: document.documentElement.dataset.theme,
      viewport: { width: viewportWidth, height: viewportHeight },
      document: {
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      },
      activeElement: document.activeElement?.tagName.toLowerCase() || null,
      inputMedia: {
        coarsePointer: window.matchMedia("(hover: none) and (pointer: coarse)").matches,
        anyCoarsePointer: window.matchMedia("(any-hover: none) and (any-pointer: coarse)").matches,
        maxTouchPoints: navigator.maxTouchPoints,
      },
      controls,
      overflowing,
    }
  })
  writeFileSync(
    resolve(artifactDirectory, `${basename}.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
  await page.screenshot({
    path: resolve(artifactDirectory, `${basename}.png`),
    fullPage: true,
  })
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
  const captureIsolatedSurface = async (name: string, path: string) => {
    const surfacePage = await page.context().newPage()
    await surfacePage.emulateMedia({ reducedMotion: "reduce", colorScheme: theme })
    await surfacePage.addInitScript((selectedTheme) => {
      window.localStorage.setItem("ew.theme.preference", selectedTheme)
    }, theme)
    try {
      await captureSurface(surfacePage, layout, theme, name, path)
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
    await captureIsolatedSurface(surface.name, surface.path)
  }

  await ensureElevatedAdmin(page)
  await captureIsolatedSurface("Admin elevated", "/admin")
  await captureIsolatedSurface("Admin import elevated", "/admin/import")
}
