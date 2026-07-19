import { expect, test, type Page } from "./fixtures"
import { ensureElevatedAdmin } from "./auth-helpers"

test.describe.configure({ mode: "parallel" })

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

async function closeMobileMenu(page: Page) {
  const closeMenu = page.getByRole("button", { name: "Close menu" })
  await expect(closeMenu).toBeVisible()
  await closeMenu.click()
}

async function clickMobileSidebarLink(page: Page, label: string) {
  await page.getByRole("button", { name: "Open menu" }).click()
  const sidebar = page.getByRole("complementary", { name: "Application menu" })
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

    await page
      .getByTestId("app-shell-header")
      .getByRole("link", { name: "Expenses" })
      .click()
    await expect(page).toHaveURL(/\/\?period=this_month/)

    await clickMobileSidebarLink(page, "Transactions")
    await clickMobileSidebarLink(page, "Dashboard")
    await expect(page).toHaveURL(/\/\?period=this_month/)
  })

  test("uses a compact mobile header action without fixed bottom navigation", async ({
    page,
  }) => {
    await page.goto("/")
    await expect(page.getByTestId("app-shell-bottom-nav")).toHaveCount(0)
    const header = page.getByTestId("app-shell-header")
    const addAction = header.getByTestId("app-shell-mobile-add-action")
    await expect(addAction).toBeVisible()
    await expect(addAction).toHaveAccessibleName("Add transaction")
    await expect(header.getByRole("button", { name: "Open menu" })).toBeVisible()
    await addAction.focus()
    await expect(addAction).toHaveCSS("outline-style", "solid")
    await expect(addAction).toHaveCSS("outline-width", "2px")

    const layout = await addAction.evaluate((node) => {
      const rect = node.getBoundingClientRect()
      return {
        height: rect.height,
        width: rect.width,
      }
    })

    expect(layout.width).toBeGreaterThanOrEqual(44)
    expect(layout.height).toBeGreaterThanOrEqual(44)

    await addAction.click()
    await expect(page.getByRole("dialog", { name: "Add transaction" })).toBeVisible()
  })

  test("navigates non-tab routes through the sidebar", async ({ page }) => {
    test.setTimeout(90_000)

    await page.goto("/")

    const routes = [
      { label: "Assistant", path: "/assistant", heading: "Assistant" },
      { label: "Forecast", path: "/forecast", heading: "Forecast" },
      { label: "Budgets", path: "/budgets", heading: "Budgets" },
      { label: "Digest", path: "/digest", heading: "Digest" },
      { label: "Recurring", path: "/recurring", heading: "Recurring" },
      { label: "Templates", path: "/templates", heading: "Templates" },
      { label: "Rules", path: "/rules", heading: "Categorization Rules" },
      { label: "Categories", path: "/categories", heading: "Categories" },
      { label: "Tags", path: "/tags", heading: "Tags" },
      { label: "Reports", path: "/reports/builder", heading: "Report Builder" },
      { label: "What If", path: "/scenarios", heading: "What If" },
      { label: "Reconcile", path: "/reconciliation", heading: "Reconciliation" },
      { label: "Settings", path: "/settings", heading: "Settings" },
      { label: "Admin", path: "/admin/elevate?redirect=%2Fadmin", heading: "Re-enter your password" },
    ]

    for (const route of routes) {
      await page.getByRole("button", { name: "Open menu" }).click()
      const sidebar = page.getByRole("complementary", {
        name: "Application menu",
      })
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
      await expect(
        page.getByRole("heading", { name: route.heading, level: 1 })
      ).toBeVisible()
    }
  })

  test("keeps every menu destination tappable in the edge-attached drawer", async ({
    page,
  }) => {
    await page.goto("/")
    await page.getByRole("button", { name: "Open menu" }).click()

    const sidebar = page.getByRole("complementary", { name: "Application menu" })
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

  test("closes the mobile menu via its close control, escape, and destination navigation while restoring scrolling", async ({
    page,
  }) => {
    await page.goto("/")

    await page.getByRole("button", { name: "Open menu" }).click()
    await expect(
      page.getByRole("complementary", { name: "Application menu" }),
    ).toBeVisible()
    await expect(page.getByRole("button", { name: "Close menu" })).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden")

    const dashboardUrl = page.url()
    await closeMobileMenu(page)
    await expect(page).toHaveURL(dashboardUrl)
    await expect(page.locator("aside.app-sidebar")).not.toHaveClass(
      /app-sidebar-open/,
    )
    await expect(page.locator("aside.app-sidebar")).toHaveAttribute(
      "aria-hidden",
      "true",
    )
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("")

    await page.getByRole("button", { name: "Open menu" }).click()
    await expect(
      page.getByRole("complementary", { name: "Application menu" }),
    ).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.locator("aside.app-sidebar")).not.toHaveClass(
      /app-sidebar-open/,
    )
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("")

    await page.getByRole("button", { name: "Open menu" }).click()
    const sidebar = page.getByRole("complementary", { name: "Application menu" })
    await sidebar.getByRole("link", { name: "Transactions" }).click()
    await expect(page).toHaveURL("/transactions")
    await expect(page.locator("aside.app-sidebar")).not.toHaveClass(
      /app-sidebar-open/,
    )
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("")
  })

  test("exposes a mobile quick theme toggle in the shell header and keeps nav tappable", async ({
    page,
  }) => {
    await page.goto("/")
    await page.evaluate((key) => window.localStorage.setItem(key, "dark"), THEME_STORAGE_KEY)
    await page.reload()
    const shellThemeToggle = page
      .getByTestId("app-shell-header")
      .getByTestId("shell-theme-quick-toggle")
    await expect(shellThemeToggle).toBeVisible()
    await expect(shellThemeToggle).toHaveAttribute("data-theme-icon", "dark")
    await shellThemeToggle.click()
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("light")
    await expect.poll(() => readThemeChrome(page)).toMatchObject({
      theme: "light",
      themeColor: "#eeefe9",
    })
    await expect
      .poll(
        async () =>
          page.evaluate((key) => window.localStorage.getItem(key), THEME_STORAGE_KEY)
      )
      .toBe("light")

    await page.getByRole("button", { name: "Open menu" }).click()
    const sidebar = page.getByRole("complementary", { name: "Application menu" })
    const adminLink = sidebar.getByRole("link", { name: "Admin" })
    await adminLink.scrollIntoViewIfNeeded()
    await adminLink.click()
    await expect(page).toHaveURL(/\/admin\/elevate\?redirect=/)
    await expect(page.getByTestId("shell-theme-quick-toggle")).toHaveCount(0)

    await page.getByRole("button", { name: "Open menu" }).click()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("button", { name: "Close menu" })).not.toBeVisible()

    await clickMobileSidebarLink(page, "Transactions")
    await expect(page).toHaveURL("/transactions")
    await page.getByTestId("app-shell-mobile-add-action").click()
    await expect(page.getByRole("dialog", { name: "Add transaction" })).toBeVisible()
  })

  test("preserves selected theme across dashboard, transactions, and admin import routes", async ({
    page,
  }) => {
    await page.goto("/")
    await page.evaluate((key) => window.localStorage.setItem(key, "dark"), THEME_STORAGE_KEY)
    await page.reload()
    const shellThemeToggle = page
      .getByTestId("app-shell-header")
      .getByTestId("shell-theme-quick-toggle")
    await shellThemeToggle.click()
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("light")

    await clickMobileSidebarLink(page, "Transactions")
    await expect(page).toHaveURL("/transactions")
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("light")

    await page.getByRole("button", { name: "Open menu" }).click()
    const sidebar = page.getByRole("complementary", { name: "Application menu" })
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

  test("keeps the page-specific Add action in the mobile header", async ({
    page,
  }) => {
    await page.goto("/budgets")
    const addAction = page
      .getByTestId("app-shell-header")
      .getByTestId("app-shell-mobile-add-action")
    await expect(addAction).toBeVisible()
    await expect(addAction).toHaveAccessibleName("Add budget")

    const position = await addAction.evaluate((node) => {
      const rect = node.getBoundingClientRect()
      return { center: rect.left + rect.width / 2, viewport: window.innerWidth }
    })
    expect(position.center).toBeGreaterThan(position.viewport / 2)

    await addAction.click()
    await expect(page.getByRole("dialog", { name: "Add budget" })).toBeVisible()
  })

  test("recovers from unknown routes back to dashboard", async ({ page }) => {
    await page.goto("/unknown-route-12345")
    await page.getByRole("link", { name: "Back to dashboard" }).click()
    await expect(page).toHaveURL("/")
    await expect(page.locator("main h1")).toContainText("Dashboard")
  })
})
