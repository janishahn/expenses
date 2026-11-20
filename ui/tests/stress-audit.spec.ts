import { expect, test, type Page } from "./fixtures"
import { authenticatedSurfaces } from "./surface-contracts"

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript((preference) => {
    window.localStorage.setItem("ew.theme.preference", preference)
  }, theme)
}

// Opens a route and measures how it fits the viewport: horizontal overflow, and whether
// the page title stays inside the visible height.
async function measureStressSurface(page: Page, path: string) {
  await page.goto(path, { waitUntil: "networkidle" })
  await expect(page.getByRole("main").first()).toBeVisible()
  await expect(page.getByTestId("route-loading")).toHaveCount(0)
  await expect(page.getByTestId("app-loading-fallback")).toHaveCount(0)
  return page.evaluate(() => {
    const heading = document.querySelector("main h1")?.getBoundingClientRect()
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      headingInView: Boolean(
        heading && heading.top >= 0 && heading.bottom <= window.innerHeight,
      ),
    }
  })
}

test("every static route reflows at a 200% zoom-equivalent width", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 400 })
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" })
  await setTheme(page, "light")
  const overflowing: string[] = []
  for (const surface of authenticatedSurfaces) {
    const fit = await measureStressSurface(page, surface.path)
    if (fit.overflow > 0 || !fit.headingInView) overflowing.push(`${surface.name}: ${JSON.stringify(fit)}`)
  }
  expect(overflowing).toEqual([])
})

test("representative surfaces keep a keyboard focus indicator under forced colors", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.emulateMedia({
    colorScheme: "light",
    reducedMotion: "reduce",
    forcedColors: "active",
  })
  await setTheme(page, "light")
  for (const surface of [
    { name: "Dashboard", path: "/" },
    { name: "Transactions", path: "/transactions?period=all" },
    { name: "Assistant", path: "/assistant" },
    { name: "Insights", path: "/insights?period=all" },
    { name: "Settings", path: "/settings" },
  ]) {
    const fit = await measureStressSurface(page, surface.path)
    expect(fit.overflow, surface.name).toBeLessThanOrEqual(0)
    expect(
      await page.evaluate(() => window.matchMedia("(forced-colors: active)").matches),
    ).toBe(true)

    await page.keyboard.press("Tab")
    const focus = await page.evaluate(() => {
      const element = document.activeElement
      if (!element || element === document.body) return null
      const style = getComputedStyle(element)
      return { outlineStyle: style.outlineStyle, outlineWidth: Number.parseFloat(style.outlineWidth) }
    })
    expect(focus, `${surface.name} focus target`).not.toBeNull()
    expect(focus!.outlineStyle, surface.name).not.toBe("none")
    expect(focus!.outlineWidth, surface.name).toBeGreaterThan(0)
  }
})
