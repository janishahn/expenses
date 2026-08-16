import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { ensureElevatedAdmin } from "./auth-helpers"
import { expect, test } from "./fixtures"
import { runRouteThemeAudit } from "./route-theme-audit.helpers"

const artifactRoot = process.env.UI_POLISH_AUDIT_ARTIFACT_DIR
  ? resolve("..", process.env.UI_POLISH_AUDIT_ARTIFACT_DIR)
  : null

test.describe("Desktop route theme audit evidence", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`captures every canonical surface in the ${theme} theme`, async ({
      page,
      request,
    }) => {
      test.setTimeout(180_000)
      await runRouteThemeAudit(page, request, "desktop-chromium", theme)
    })
  }

  test("records keyboard semantics for interactive admin log rows", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("ew.theme.preference", "light")
    })
    await ensureElevatedAdmin(page)
    await page.getByRole("button", { name: "All", exact: true }).click()
    const firstRow = page.locator("tbody tr").first()
    await expect(firstRow).toBeVisible()
    const before = await firstRow.evaluate((row) => ({
      tag: row.tagName.toLowerCase(),
      role: row.getAttribute("role"),
      tabIndex: (row as HTMLElement).tabIndex,
      hasClickHandler: row.getAttribute("class")?.includes("cursor-pointer") ?? false,
      text: (row.textContent || "").trim().replace(/\s+/g, " "),
    }))
    const inspectButton = firstRow.getByRole("button", { name: /^Inspect / })
    await inspectButton.click()
    await expect(inspectButton).toHaveAttribute("aria-pressed", "true")
    await expect(page.getByRole("heading", { name: "Entry details" })).toBeVisible()
    const detailText = await page
      .getByRole("heading", { name: "Entry details" })
      .locator("xpath=../following-sibling::*[1]")
      .innerText()

    if (artifactRoot) {
      const artifactDirectory = resolve(
        artifactRoot,
        "desktop-chromium",
        "light",
      )
      mkdirSync(artifactDirectory, { recursive: true })
      await page.screenshot({
        path: resolve(artifactDirectory, "admin-log-row-pointer-selection.png"),
        fullPage: true,
        animations: "disabled",
      })
      writeFileSync(
        resolve(artifactDirectory, "admin-log-row-pointer-selection.json"),
        `${JSON.stringify({ before, pointerSelectionOpenedDetail: detailText.length > 0 }, null, 2)}\n`,
      )
    }
  })
})
