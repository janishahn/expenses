import { test } from "./fixtures"
import { runRouteThemeAudit } from "./route-theme-audit.helpers"

test.describe("Desktop route theme audit", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`renders every canonical surface in the ${theme} theme without overflow`, async ({
      page,
      request,
    }) => {
      test.setTimeout(180_000)
      await runRouteThemeAudit(page, request, "desktop-chromium", theme)
    })
  }
})
