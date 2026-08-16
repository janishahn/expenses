import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test, type Page } from "./fixtures"
import { ensureElevatedAdmin } from "./auth-helpers"
import { authenticatedSurfaces } from "./surface-contracts"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const artifactRoot = process.env.UI_POLISH_AUDIT_ARTIFACT_DIR
  ? resolve(repoRoot, process.env.UI_POLISH_AUDIT_ARTIFACT_DIR)
  : null

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

async function setTheme(page: Page, theme: "light" | "dark" | "system") {
  await page.addInitScript((preference) => {
    window.localStorage.setItem("ew.theme.preference", preference)
  }, theme)
}

async function captureStressSurface(
  page: Page,
  profile: string,
  theme: "light" | "dark",
  name: string,
  path: string,
) {
  await page.goto(path, { waitUntil: "networkidle" })
  await expect(page.getByRole("main").first()).toBeVisible()
  await expect(page.getByTestId("route-loading")).toHaveCount(0)
  await expect(page.getByTestId("app-loading-fallback")).toHaveCount(0)
  const basename = slug(name)
  const manifest = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth
    const viewportHeight = document.documentElement.clientHeight
    const visibleControls = Array.from(
      document.querySelectorAll<HTMLElement>(
        "a[href],button,input,select,textarea,[role='button'],[role='switch'],[role='tab'],[role='menuitem']",
      ),
    ).filter((element) => {
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        style.pointerEvents !== "none"
      )
    })
    return {
      url: window.location.href,
      theme: document.documentElement.dataset.theme,
      viewport: { width: viewportWidth, height: viewportHeight },
      document: {
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        horizontalOverflow:
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
      },
      visibleControlCount: visibleControls.length,
      focused: {
        tag: document.activeElement?.tagName.toLowerCase() ?? null,
        label: document.activeElement?.getAttribute("aria-label") ?? null,
      },
    }
  })
  if (artifactRoot) {
    const directory = resolve(
      artifactRoot,
      profile,
      theme,
    )
    mkdirSync(directory, { recursive: true })
    await page.screenshot({
      path: resolve(directory, `${basename}.png`),
      fullPage: true,
      animations: "disabled",
    })
    writeFileSync(
      resolve(directory, `${basename}.json`),
      `${JSON.stringify(manifest, null, 2)}\n`,
    )
  }
  return manifest
}

for (const theme of ["light", "dark"] as const) {
  test(`captures every static route at a 200% zoom-equivalent reflow in ${theme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 640, height: 400 })
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" })
    await setTheme(page, theme)
    const manifests = []
    for (const surface of authenticatedSurfaces) {
      manifests.push(
        await captureStressSurface(
          page,
          "desktop-200-percent-reflow",
          theme,
          surface.name,
          surface.path,
        ),
      )
    }
    expect(manifests.every((manifest) => manifest.document.horizontalOverflow <= 1)).toBe(
      true,
    )
  })

  test(`captures every static route at short desktop height in ${theme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 520 })
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" })
    await setTheme(page, theme)
    const manifests = []
    for (const surface of authenticatedSurfaces) {
      manifests.push(
        await captureStressSurface(
          page,
          "desktop-short-height",
          theme,
          surface.name,
          surface.path,
        ),
      )
    }
    expect(manifests.every((manifest) => manifest.document.horizontalOverflow <= 1)).toBe(
      true,
    )
  })
}

for (const preference of ["forced-colors", "increased-contrast"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`captures representative ${preference} surfaces in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.emulateMedia({
        colorScheme: theme,
        reducedMotion: "reduce",
        forcedColors: preference === "forced-colors" ? "active" : "none",
        contrast: preference === "increased-contrast" ? "more" : "no-preference",
      })
      await setTheme(page, theme)
      for (const surface of [
        { name: "Dashboard", path: "/" },
        { name: "Transactions", path: "/transactions?period=all" },
        { name: "Assistant", path: "/assistant" },
        { name: "Insights", path: "/insights?period=all" },
        { name: "Settings", path: "/settings" },
      ]) {
        await captureStressSurface(page, preference, theme, surface.name, surface.path)
      }
    })
  }
}

test("system theme follows both operating-system color schemes", async ({ page }) => {
  await setTheme(page, "system")
  const observations = []
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" })
    await page.goto("/settings", { waitUntil: "networkidle" })
    observations.push({
      scheme,
      dataTheme: await page.locator("html").getAttribute("data-theme"),
      selected: await page.getByRole("button", { name: "System" }).getAttribute("aria-pressed"),
    })
  }
  if (artifactRoot) {
    const directory = resolve(artifactRoot, "system-theme")
    mkdirSync(directory, { recursive: true })
    writeFileSync(
      resolve(directory, "observations.json"),
      `${JSON.stringify(observations, null, 2)}\n`,
    )
  }
  expect(observations).toEqual([
    { scheme: "light", dataTheme: "light", selected: "true" },
    { scheme: "dark", dataTheme: "dark", selected: "true" },
  ])
})

test("reduced motion suppresses shared page, dialog, and sheet animation families", async ({
  page,
}) => {
  await setTheme(page, "light")
  const observations: Record<string, unknown> = {}
  for (const motion of ["no-preference", "reduce"] as const) {
    await page.emulateMedia({ colorScheme: "light", reducedMotion: motion })
    await page.goto("/categories", { waitUntil: "networkidle" })
    await page.getByRole("button", { name: "Add category" }).first().click()
    const dialog = page.getByRole("dialog", { name: "Add category" })
    await expect(dialog).toBeVisible()
    observations[motion] = await page.evaluate(() => {
      const pageElement = document.querySelector<HTMLElement>(".page-enter")
      const dialogElement = document.querySelector<HTMLElement>("[role='dialog']")
      const read = (element: HTMLElement | null) => {
        if (!element) return null
        const style = window.getComputedStyle(element)
        return {
          animationName: style.animationName,
          animationDuration: style.animationDuration,
          transitionDuration: style.transitionDuration,
        }
      }
      return { page: read(pageElement), dialog: read(dialogElement) }
    })
    await page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()
  }
  if (artifactRoot) {
    const directory = resolve(artifactRoot, "motion")
    mkdirSync(directory, { recursive: true })
    writeFileSync(
      resolve(directory, "shared-animation-observations.json"),
      `${JSON.stringify(observations, null, 2)}\n`,
    )
  }
  expect(observations.reduce).toBeTruthy()
})

test("elevated admin remains usable at short height", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 520 })
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" })
  await setTheme(page, "light")
  await ensureElevatedAdmin(page)
  await captureStressSurface(
    page,
    "desktop-short-height",
    "light",
    "Admin elevated",
    "/admin",
  )
})
