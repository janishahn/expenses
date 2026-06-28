import { expect, test, type Page } from "@playwright/test"
import { ensureElevatedAdmin } from "./auth-helpers"

const THEME_STORAGE_KEY = "ew.theme.preference"

async function readThemeChrome(page: Page) {
  return page.evaluate(() => ({
    theme: document.documentElement.dataset.theme ?? null,
    themeColor:
      Array.from(
        document.querySelectorAll<HTMLMetaElement>("meta[name='theme-color']")
      ).find((meta) => meta.media !== "not all")?.content ?? null,
    lightThemeColorMedia:
      document
        .querySelector<HTMLMetaElement>(
          "meta[name='theme-color'][data-ew-theme-color='light']"
        )
        ?.getAttribute("media") ?? null,
    darkThemeColorMedia:
      document
        .querySelector<HTMLMetaElement>(
          "meta[name='theme-color'][data-ew-theme-color='dark']"
        )
        ?.getAttribute("media") ?? null,
  }))
}

async function clickMobileSidebarBackdrop(page: Page) {
  const closeSidebarBackdrop = page.getByRole("button", { name: "Close sidebar" })
  await expect(closeSidebarBackdrop).toBeVisible()
  await expect
    .poll(async () =>
      closeSidebarBackdrop.evaluate((node) => {
        const rect = node.getBoundingClientRect()
        const topElement = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2
        )
        return topElement === node || node.contains(topElement)
      })
    )
    .toBeTruthy()
  await closeSidebarBackdrop.click()
}

async function clickMobileSidebarLink(page: Page, label: string) {
  await page.getByRole("button", { name: "Open sidebar" }).click()
  const sidebar = page.locator("aside")
  await expect(sidebar).toBeVisible()
  const link = sidebar.getByRole("link", { name: label })
  await link.scrollIntoViewIfNeeded()
  await link.click()
}

test.describe("Navigation (mobile)", () => {
  test("loads dashboard as home page", async ({ page }) => {
    await page.goto("/")
    await expect(page.locator("main h1")).toContainText("Dashboard")
    await expect(page.getByTestId("app-shell-header")).not.toContainText("Dashboard")
  })

  test("preserves period across mobile sidebar navigation", async ({ page }) => {
    await page.goto("/")
    await page.getByRole("button", { name: "This month" }).click()
    await expect(page).toHaveURL(/period=this_month/)

    await clickMobileSidebarLink(page, "Transactions")
    await expect(page).toHaveURL(/\/transactions\?period=this_month/)

    await clickMobileSidebarLink(page, "Dashboard")
    await expect(page).toHaveURL(/\/\?period=this_month/)
  })

  test("uses a mobile add FAB instead of persistent bottom navigation", async ({
    page,
  }) => {
    await page.goto("/")
    await expect(page.getByTestId("app-shell-bottom-nav")).toHaveCount(0)

    const addFab = page.getByTestId("app-shell-mobile-add-fab")
    await expect(addFab).toBeVisible()
    await expect(addFab).toHaveAccessibleName("Add")

    const layout = await addFab.evaluate((node) => {
      const rect = node.getBoundingClientRect()
      return {
        bottom: window.innerHeight - rect.bottom,
        height: rect.height,
        right: window.innerWidth - rect.right,
        width: rect.width,
      }
    })

    expect(layout.bottom).toBeGreaterThanOrEqual(14)
    expect(layout.bottom).toBeLessThanOrEqual(22)
    expect(layout.right).toBeGreaterThanOrEqual(18)
    expect(layout.right).toBeLessThanOrEqual(24)
    expect(layout.width).toBe(56)
    expect(layout.height).toBe(56)

    await addFab.click()
    await expect(page.getByRole("dialog", { name: "Add transaction" })).toBeVisible()
    await expect(addFab).toHaveCount(0)
  })

  test("navigates non-tab routes through the sidebar", async ({ page }) => {
    test.setTimeout(60_000)

    await page.goto("/")

    const routes = [
      { label: "Assistant", path: "/assistant", heading: "Spending Assistant" },
      { label: "Forecast", path: "/forecast", heading: "Forecast" },
      { label: "Budgets", path: "/budgets", heading: "Budgets" },
      { label: "Recurring", path: "/recurring", heading: "Recurring" },
      { label: "Templates", path: "/templates", heading: "Templates" },
      { label: "Rules", path: "/rules", heading: "Categorization Rules" },
      { label: "Categories", path: "/categories", heading: "Categories" },
      { label: "Tags", path: "/tags", heading: "Tags" },
      { label: "Reports", path: "/reports/builder", heading: "Report Builder" },
      { label: "What If", path: "/scenarios", heading: "What If" },
      { label: "Admin", path: "/admin/elevate?redirect=%2Fadmin", heading: "Re-enter your password" },
    ]

    for (const route of routes) {
      await page.getByRole("button", { name: "Open sidebar" }).click()
      const sidebar = page.locator("aside")
      await expect(sidebar).toBeVisible()
      await sidebar.locator("nav").evaluate((node, label) => {
        const links = Array.from(node.querySelectorAll("a"))
        const target = links.find((link) =>
          link.textContent?.replace(/\s+/g, " ").trim().includes(label)
        )
        target?.scrollIntoView({ block: "center" })
      }, route.label)
      const routeLink = sidebar.getByRole("link", { name: route.label })
      await routeLink.focus()
      await routeLink.press("Enter")
      await expect(page).toHaveURL(route.path)
      await expect(page.locator("main h1")).toContainText(route.heading)
    }
  })

  test("keeps bottom tool links tappable when sidebar is open", async ({
    page,
  }) => {
    await page.goto("/")
    await page.getByRole("button", { name: "Open sidebar" }).click()

    const sidebar = page.locator("aside")
    await expect(sidebar).toBeVisible()
    const adminLink = sidebar.getByRole("link", { name: "Admin" })
    await adminLink.scrollIntoViewIfNeeded()

    const adminLinkIsTopmost = await adminLink.evaluate((node) => {
      const rect = node.getBoundingClientRect()
      const x = rect.left + rect.width / 2
      const y = rect.top + rect.height / 2
      const topElement = document.elementFromPoint(x, y)
      return topElement === node || node.contains(topElement)
    })

    expect(adminLinkIsTopmost).toBeTruthy()
    await adminLink.click()
    await expect(page).toHaveURL(/\/admin\/elevate\?redirect=/)
  })

  test("closes the mobile sidebar via backdrop, escape, and destination navigation while restoring scrolling", async ({
    page,
  }) => {
    await page.goto("/")

    await page.getByRole("button", { name: "Open sidebar" }).click()
    await expect(page.locator("aside")).toBeVisible()
    await expect(page.getByRole("button", { name: "Close sidebar" })).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden")

    const dashboardUrl = page.url()
    await clickMobileSidebarBackdrop(page)
    await expect(page).toHaveURL(dashboardUrl)
    await expect(page.locator("aside")).toHaveClass(/-translate-x-full/)
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("")

    await page.getByRole("button", { name: "Open sidebar" }).click()
    await expect(page.locator("aside")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.locator("aside")).toHaveClass(/-translate-x-full/)
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("")

    await page.getByRole("button", { name: "Open sidebar" }).click()
    const sidebar = page.locator("aside")
    await sidebar.getByRole("link", { name: "Transactions" }).click()
    await expect(page).toHaveURL("/transactions")
    await expect(page.locator("aside")).toHaveClass(/-translate-x-full/)
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("")
  })

  test("exposes a mobile quick theme toggle in the shell header and keeps nav tappable", async ({
    page,
  }) => {
    await page.goto("/")
    await page.evaluate((key) => window.localStorage.setItem(key, "dark"), THEME_STORAGE_KEY)
    await page.reload()
    const shellThemeToggle = page.getByTestId("shell-theme-quick-toggle")
    await expect(shellThemeToggle).toBeVisible()
    await expect(shellThemeToggle).toHaveAttribute("data-theme-icon", "dark")
    await shellThemeToggle.click()
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("light")
    await expect.poll(() => readThemeChrome(page)).toMatchObject({
      theme: "light",
      themeColor: "#f0f6f8",
    })
    await expect
      .poll(
        async () =>
          page.evaluate((key) => window.localStorage.getItem(key), THEME_STORAGE_KEY)
      )
      .toBe("light")

    await page.getByRole("button", { name: "Open sidebar" }).click()
    const sidebar = page.locator("aside")
    const adminLink = sidebar.getByRole("link", { name: "Admin" })
    await adminLink.scrollIntoViewIfNeeded()
    await adminLink.click()
    await expect(page).toHaveURL(/\/admin\/elevate\?redirect=/)
    await expect(page.getByTestId("shell-theme-quick-toggle")).toHaveCount(0)

    await page.getByRole("button", { name: "Open sidebar" }).click()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("button", { name: "Close sidebar" })).not.toBeVisible()

    await clickMobileSidebarLink(page, "Transactions")
    await expect(page).toHaveURL("/transactions")
    await page.getByTestId("app-shell-mobile-add-fab").click()
    await expect(page.getByRole("dialog", { name: "Add transaction" })).toBeVisible()
  })

  test("preserves selected theme across dashboard, transactions, and admin import routes", async ({
    page,
  }) => {
    await page.goto("/")
    await page.evaluate((key) => window.localStorage.setItem(key, "dark"), THEME_STORAGE_KEY)
    await page.reload()
    const shellThemeToggle = page.getByTestId("shell-theme-quick-toggle")
    await shellThemeToggle.click()
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("light")

    await clickMobileSidebarLink(page, "Transactions")
    await expect(page).toHaveURL("/transactions")
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("light")

    await page.getByRole("button", { name: "Open sidebar" }).click()
    const sidebar = page.locator("aside")
    await sidebar.getByRole("link", { name: "Admin" }).click()
    await expect(page).toHaveURL(/\/admin\/elevate\?redirect=/)
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("light")

    await ensureElevatedAdmin(page)
    await page.getByRole("link", { name: "Open importer" }).click()
    await expect(page).toHaveURL("/admin/import")
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("light")

    await page.getByRole("link", { name: "← Back to admin" }).click()
    await expect(page).toHaveURL("/admin")
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("light")

    await clickMobileSidebarLink(page, "Dashboard")
    await expect(page).toHaveURL("/")
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("light")
  })

  test("hides the mobile add FAB during sidebar and field focus states", async ({
    page,
  }) => {
    await page.goto("/transactions")
    const addFab = page.getByTestId("app-shell-mobile-add-fab")
    await expect(addFab).toBeVisible()

    await page.getByRole("button", { name: "Open sidebar" }).click()
    await expect(page.locator("aside")).toBeVisible()
    await expect(addFab).toHaveCount(0)
    await page.keyboard.press("Escape")
    await expect(addFab).toBeVisible()

    await page.getByRole("button", { name: /Filters/ }).click()
    const filtersDialog = page.getByRole("dialog", { name: "Transaction filters" })
    await expect(filtersDialog).toBeVisible()
    const searchInput = filtersDialog.getByRole("textbox", { name: "Search" })
    await searchInput.focus()
    await expect(addFab).toHaveCount(0)
    await page.keyboard.press("Escape")
    await expect(addFab).toBeVisible()
  })

  test("recovers from unknown routes back to dashboard", async ({ page }) => {
    await page.goto("/unknown-route-12345")
    await page.getByRole("link", { name: "Back to dashboard" }).click()
    await expect(page).toHaveURL("/")
    await expect(page.locator("main h1")).toContainText("Dashboard")
  })
})
