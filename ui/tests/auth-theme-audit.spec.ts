import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, freshInstanceTest as test, type Page } from "./fixtures"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const artifactRoot = process.env.UI_POLISH_AUDIT_ARTIFACT_DIR
  ? resolve(repoRoot, process.env.UI_POLISH_AUDIT_ARTIFACT_DIR)
  : null

async function captureAuth(
  page: Page,
  layout: "desktop-chromium" | "mobile-chromium-fallback",
  theme: "light" | "dark",
  name: string,
) {
  await page.evaluate((selectedTheme) => {
    const key = "ew.theme.preference"
    const oldValue = window.localStorage.getItem(key)
    window.localStorage.setItem(key, selectedTheme)
    window.dispatchEvent(
      new StorageEvent("storage", {
        key,
        oldValue,
        newValue: selectedTheme,
        storageArea: window.localStorage,
      }),
    )
  }, theme)
  await expect.poll(() => page.locator("html").getAttribute("data-theme")).toBe(theme)
  const manifest = await page.evaluate(() => ({
    url: window.location.href,
    theme: document.documentElement.dataset.theme,
    viewport: {
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    },
    document: {
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      horizontalOverflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    },
    controls: Array.from(
      document.querySelectorAll<HTMLElement>("a[href],button,input"),
    ).map((element) => {
      const rect = element.getBoundingClientRect()
      return {
        tag: element.tagName.toLowerCase(),
        label:
          element.getAttribute("aria-label") ||
          element.getAttribute("name") ||
          element.textContent?.trim() ||
          null,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }
    }),
  }))
  if (artifactRoot) {
    const directory = resolve(
      artifactRoot,
      "auth",
      layout,
      theme,
    )
    mkdirSync(directory, { recursive: true })
    await page.screenshot({
      path: resolve(directory, `${name}.png`),
      fullPage: true,
    })
    writeFileSync(
      resolve(directory, `${name}.json`),
      `${JSON.stringify(manifest, null, 2)}\n`,
    )
  }
  expect(manifest.document.horizontalOverflow).toBeLessThanOrEqual(1)
}

test("captures setup, login, validation, signup, and success states in both themes", async ({
  page,
}, testInfo) => {
  const layout = testInfo.project.name.includes("mobile")
    ? "mobile-chromium-fallback"
    : "desktop-chromium"
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" })

  await page.goto("/")
  await expect(page).toHaveURL(/\/setup(?:\?|$)/)
  for (const theme of ["light", "dark"] as const) {
    await captureAuth(page, layout, theme, "setup")
  }

  await page.getByTestId("auth-username").fill("audit-admin")
  await page.getByTestId("auth-password").fill("hunter22")
  await page.getByTestId("auth-submit").click()
  await expect(page.getByTestId("app-shell-root")).toBeVisible()
  await page.goto("/settings")
  await page.getByTestId("auth-logout").click()
  await expect(page).toHaveURL(/\/login(?:\?|$)/)

  for (const theme of ["light", "dark"] as const) {
    await captureAuth(page, layout, theme, "login")
  }
  await page.getByTestId("auth-username").fill("audit-admin")
  await page.getByTestId("auth-password").fill("wrong-password")
  await page.getByTestId("auth-submit").click()
  await expect(page.getByTestId("auth-error")).toBeVisible()
  for (const theme of ["light", "dark"] as const) {
    await captureAuth(page, layout, theme, "login-error")
  }

  await page.getByTestId("auth-switch-to-signup").click()
  await expect(page).toHaveURL(/\/signup(?:\?|$)/)
  for (const theme of ["light", "dark"] as const) {
    await captureAuth(page, layout, theme, "signup")
  }
  await page.getByTestId("auth-username").fill("audit-user")
  await page.getByTestId("auth-password").fill("hunter22")
  await page.getByTestId("auth-submit").click()
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByTestId("auth-success")).toBeVisible()
  for (const theme of ["light", "dark"] as const) {
    await captureAuth(page, layout, theme, "login-success")
  }
})
