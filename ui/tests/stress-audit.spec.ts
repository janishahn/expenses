import { expect, test, type Page } from "./fixtures"
import { ensureElevatedAdmin } from "./auth-helpers"
import { waitForEntrance } from "./helpers"
import { authenticatedSurfaces } from "./surface-contracts"

async function setTheme(page: Page, theme: "light" | "dark" | "system") {
  await page.addInitScript((preference) => {
    window.localStorage.setItem("ew.theme.preference", preference)
  }, theme)
}

// Opens a route and measures how it fits the viewport: horizontal overflow, and whether
// the page title and the panel stay inside the visible height.
async function measureStressSurface(page: Page, path: string) {
  await page.goto(path, { waitUntil: "networkidle" })
  await expect(page.getByRole("main").first()).toBeVisible()
  await expect(page.getByTestId("route-loading")).toHaveCount(0)
  await expect(page.getByTestId("app-loading-fallback")).toHaveCount(0)
  return page.evaluate(() => {
    const heading = document.querySelector("main h1")?.getBoundingClientRect()
    const main = document.querySelector("main")!.getBoundingClientRect()
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      headingInView: Boolean(
        heading && heading.top >= 0 && heading.bottom <= window.innerHeight,
      ),
      panelBottom: Math.round(main.bottom),
      viewportHeight: window.innerHeight,
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

test("every static route fits a short desktop height", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 520 })
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" })
  await setTheme(page, "light")
  const overflowing: string[] = []
  for (const surface of authenticatedSurfaces) {
    const fit = await measureStressSurface(page, surface.path)
    if (fit.overflow > 0 || !fit.headingInView || fit.panelBottom > fit.viewportHeight) {
      overflowing.push(`${surface.name}: ${JSON.stringify(fit)}`)
    }
  }
  expect(overflowing).toEqual([])
})

for (const preference of ["forced-colors", "increased-contrast"] as const) {
  test(`representative surfaces keep a keyboard focus indicator under ${preference}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.emulateMedia({
      colorScheme: "light",
      reducedMotion: "reduce",
      forcedColors: preference === "forced-colors" ? "active" : "none",
      contrast: preference === "increased-contrast" ? "more" : "no-preference",
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
        await page.evaluate(
          (query) => window.matchMedia(query).matches,
          preference === "forced-colors" ? "(forced-colors: active)" : "(prefers-contrast: more)",
        ),
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
}

test("system theme follows both operating-system color schemes", async ({ page }) => {
  await setTheme(page, "system")
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" })
    await page.goto("/settings/appearance", { waitUntil: "networkidle" })
    await expect(page.locator("html")).toHaveAttribute("data-theme", scheme)
    await expect(
      page
        .getByRole("radiogroup", { name: "Theme" })
        .getByRole("radio", { name: "System" }),
    ).toBeChecked()
  }
})

test("reduced motion removes movement from dialog, menu, and sheet entrances", async ({
  page,
}) => {
  await setTheme(page, "light")
  // Records, for every dialog or menu entrance, whether its keyframes animate transform.
  await page.addInitScript(() => {
    const entrances: Array<{ role: string | null; movement: boolean }> = []
    ;(window as unknown as { entrances: typeof entrances }).entrances = entrances
    document.addEventListener(
      "animationstart",
      (event) => {
        const layer = event.target as Element
        if (!layer.matches("[role='dialog'], [role='menu']")) return
        const animation = layer
          .getAnimations()
          .find((candidate) => (candidate as CSSAnimation).animationName === event.animationName)
        const keyframes = (animation?.effect as KeyframeEffect | undefined)?.getKeyframes() ?? []
        entrances.push({
          role: layer.getAttribute("role"),
          movement: keyframes.some((frame) => "transform" in frame),
        })
      },
      true,
    )
  })

  const observed: Record<string, Array<{ role: string | null; movement: boolean }>> = {}
  for (const motion of ["no-preference", "reduce"] as const) {
    await page.emulateMedia({ colorScheme: "light", reducedMotion: motion })

    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto("/categories", { waitUntil: "networkidle" })
    await page.getByRole("button", { name: "Expenses", exact: true }).click()
    const menu = page.getByRole("menu")
    await expect(menu).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(menu).toBeHidden()
    await page.getByRole("button", { name: "Add category" }).first().click()
    const dialog = page.getByRole("dialog", { name: "Add category" })
    await expect(dialog).toBeVisible()
    await waitForEntrance(dialog)
    await page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()

    await page.setViewportSize({ width: 640, height: 400 })
    await page
      .getByRole("navigation", { name: "Tabs" })
      .getByRole("button", { name: "More" })
      .click()
    const sheet = page.getByRole("dialog", { name: "More" })
    await expect(sheet).toBeVisible()
    await waitForEntrance(sheet)
    await page.keyboard.press("Escape")
    await expect(sheet).toBeHidden()

    observed[motion] = await page.evaluate(
      () => (window as unknown as { entrances: Array<{ role: string | null; movement: boolean }> }).entrances.splice(0),
    )
  }

  for (const role of ["menu", "dialog"]) {
    expect(
      observed["no-preference"].some((entrance) => entrance.role === role && entrance.movement),
      `${role} moves by default`,
    ).toBe(true)
    expect(
      observed.reduce.some((entrance) => entrance.role === role),
      `${role} still fades in`,
    ).toBe(true)
  }
  expect(observed.reduce.filter((entrance) => entrance.movement)).toEqual([])
})

test("elevated admin remains usable at short height", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 520 })
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" })
  await setTheme(page, "light")
  await ensureElevatedAdmin(page)
  const fit = await measureStressSurface(page, "/admin")
  expect(fit.overflow).toBeLessThanOrEqual(0)
  expect(fit.headingInView).toBe(true)

  const sections = page.getByRole("navigation", { name: "Admin sections" })
  const lastSection = sections.getByRole("link").last()
  await lastSection.scrollIntoViewIfNeeded()
  await expect(lastSection).toBeInViewport()
})
