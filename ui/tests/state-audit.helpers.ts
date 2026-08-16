import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, type Page } from "@playwright/test"

export type AuditLayout =
  | "desktop-chromium"
  | "mobile-webkit"
  | "mobile-chromium-fallback"
export type AuditTheme = "light" | "dark"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

export async function useAuditTheme(page: Page, theme: AuditTheme) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" })
  await page.addInitScript((selectedTheme) => {
    window.localStorage.setItem("ew.theme.preference", selectedTheme)
  }, theme)
}

export async function captureAuditState(
  page: Page,
  layout: AuditLayout,
  theme: AuditTheme,
  name: string,
) {
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme)
  const configuredRoot = process.env.UI_POLISH_AUDIT_ARTIFACT_DIR
  if (!configuredRoot) return
  const evidenceRoot = resolve(repoRoot, configuredRoot)
  const directory = resolve(evidenceRoot, layout, theme, "states")
  mkdirSync(directory, { recursive: true })
  const basename = slug(name)
  const manifest = await page.evaluate(() => {
    const visible = (element: Element) => {
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
    }
    const active = document.activeElement as HTMLElement | null
    const controls = Array.from(
      document.querySelectorAll<HTMLElement>(
        "a[href], button, input, select, textarea, [role='button'], [role='link'], [role='tab'], [role='switch'], [role='checkbox'], [role='radio'], [role='menuitem']",
      ),
    )
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect()
        return {
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute("role"),
          name:
            element.getAttribute("aria-label") ||
            element.getAttribute("title") ||
            element.textContent?.trim().replace(/\s+/g, " ").slice(0, 120) ||
            null,
          type: element.getAttribute("type"),
          disabled:
            element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true",
          checked: element.getAttribute("aria-checked") ?? (element as HTMLInputElement).checked ?? null,
          expanded: element.getAttribute("aria-expanded"),
          selected: element.getAttribute("aria-selected"),
          tabIndex: element.tabIndex,
          box: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        }
      })
    const viewport = {
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    }
    return {
      url: window.location.href,
      theme: document.documentElement.dataset.theme,
      viewport,
      document: {
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      },
      inputMedia: {
        coarse: window.matchMedia("(hover: none) and (pointer: coarse)").matches,
        touchPoints: navigator.maxTouchPoints,
      },
      activeElement: active
        ? {
            tag: active.tagName.toLowerCase(),
            name:
              active.getAttribute("aria-label") ||
              active.getAttribute("title") ||
              active.textContent?.trim().replace(/\s+/g, " ").slice(0, 120) ||
              null,
            hiddenAncestor: Boolean(active.closest('[aria-hidden="true"]')),
          }
        : null,
      dialogs: Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
        .filter(visible)
        .map((dialog) => ({
          name: dialog.getAttribute("aria-label") || dialog.textContent?.trim().replace(/\s+/g, " ").slice(0, 160),
          scrollHeight: dialog.scrollHeight,
          clientHeight: dialog.clientHeight,
        })),
      liveRegions: Array.from(document.querySelectorAll<HTMLElement>('[role="alert"], [role="status"], [aria-live]'))
        .filter(visible)
        .map((element) => ({
          role: element.getAttribute("role"),
          live: element.getAttribute("aria-live"),
          text: element.textContent?.trim().replace(/\s+/g, " ").slice(0, 240),
        })),
      semanticMessages: Array.from(
        document.querySelectorAll<HTMLElement>(".text-semantic-red, .text-semantic-green"),
      )
        .filter(visible)
        .map((element) => {
          const rect = element.getBoundingClientRect()
          const x = Math.min(viewport.width - 1, Math.max(0, rect.left + rect.width / 2))
          const y = Math.min(viewport.height - 1, Math.max(0, rect.top + rect.height / 2))
          const topmost = document.elementFromPoint(x, y)
          return {
            text: element.textContent?.trim().replace(/\s+/g, " ").slice(0, 240),
            box: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            },
            insideViewport: rect.bottom > 0 && rect.top < viewport.height,
            topmostIsMessage: Boolean(topmost && (topmost === element || element.contains(topmost))),
            topmost: topmost
              ? {
                  tag: topmost.tagName.toLowerCase(),
                  text: topmost.textContent?.trim().replace(/\s+/g, " ").slice(0, 120),
                  className: topmost.getAttribute("class"),
                }
              : null,
          }
        }),
      controls,
    }
  })
  writeFileSync(
    resolve(directory, `${basename}.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
  await page.screenshot({
    path: resolve(directory, `${basename}.png`),
    fullPage: layout === "desktop-chromium",
  })
}
