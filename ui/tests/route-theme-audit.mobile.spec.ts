import { test } from "./fixtures"
import { runRouteThemeAudit } from "./route-theme-audit.helpers"

test.describe("Mobile route theme audit evidence", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`captures every canonical surface in the ${theme} theme`, async ({
      browserName,
      page,
      request,
    }) => {
      test.setTimeout(240_000)
      await runRouteThemeAudit(
        page,
        request,
        browserName === "webkit" ? "mobile-webkit" : "mobile-chromium-fallback",
        theme,
      )
    })
  }
})
