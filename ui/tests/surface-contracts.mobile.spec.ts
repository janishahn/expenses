import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "./fixtures"
import { authenticatedSurfaces } from "./surface-contracts"

test.describe.configure({ mode: "parallel" })

test.describe("Mobile surface contracts", () => {
  for (const surface of authenticatedSurfaces) {
    test(`${surface.name} is accessible and fits the viewport`, async ({ page }) => {
      const runtimeErrors: string[] = []
      page.on("pageerror", (error) => runtimeErrors.push(error.message))
      page.on("console", (message) => {
        if (
          message.type() === "error" &&
          !message.text().startsWith("Failed to load resource:")
        ) {
          runtimeErrors.push(message.text())
        }
      })
      page.on("response", (response) => {
        if (response.status() < 400) return
        const path = new URL(response.url()).pathname
        if (
          surface.name === "Admin elevation" &&
          path === "/api/admin/info" &&
          response.status() === 403
        ) {
          return
        }
        runtimeErrors.push(`${response.status()} ${path}`)
      })

      await page.goto(surface.path)
      await expect(page.getByRole("main").first()).toBeVisible()
      await expect(page.getByTestId("app-loading-fallback")).toHaveCount(0, {
        timeout: 10_000,
      })

      const viewport = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        overflowingElements: Array.from(document.body.querySelectorAll("*"))
          .map((element) => ({
            element,
            rect: element.getBoundingClientRect(),
          }))
          .filter(
            ({ element, rect }) =>
              !element.closest(".sr-only") &&
              rect.width > 0 &&
              rect.right > document.documentElement.clientWidth + 1
          )
          .slice(0, 10)
          .map(({ element, rect }) => ({
            tag: element.tagName.toLowerCase(),
            className: element.getAttribute("class") ?? "",
            right: Math.round(rect.right),
            width: Math.round(rect.width),
          })),
      }))
      expect(
        viewport.scrollWidth,
        `Horizontal overflow: ${JSON.stringify(viewport.overflowingElements)}`
      ).toBeLessThanOrEqual(viewport.clientWidth)

      const accessibility = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .disableRules(["color-contrast"])
        .analyze()

      expect(accessibility.violations).toEqual([])
      expect(runtimeErrors).toEqual([])
    })
  }
})
