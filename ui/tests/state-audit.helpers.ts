import type { Page } from "@playwright/test"

export async function useAuditTheme(page: Page, theme: "light" | "dark") {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" })
  await page.addInitScript((selectedTheme) => {
    window.localStorage.setItem("ew.theme.preference", selectedTheme)
  }, theme)
}
