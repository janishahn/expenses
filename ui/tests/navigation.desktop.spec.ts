import { test, expect, type Page } from "./fixtures"

test.describe.configure({ mode: "parallel" })

const THEME_STORAGE_KEY = "ew.theme.preference"

async function readThemePreference(page: Page): Promise<string | null> {
  return page.evaluate(
    (storageKey) => window.localStorage.getItem(storageKey),
    THEME_STORAGE_KEY
  )
}

test.describe("Navigation", () => {
  const clickSidebarLink = async (page: Page, name: string) => {
    const sidebar = page.getByRole("complementary", {
      name: "Application navigation",
    })
    await expect(sidebar).toBeVisible()
    await sidebar.getByRole("link", { name }).click()
  }

  test("uses in-content page titles beneath the compact desktop utility bar", async ({
    page,
  }) => {
    const routes = [
      { path: "/", heading: "Dashboard" },
      { path: "/transactions", heading: "Transactions" },
      { path: "/admin", heading: "Re-enter your password" },
      { path: "/unknown-route-12345", heading: "Page not found" },
    ]

    for (const route of routes) {
      await page.goto(route.path)
      await expect(page.locator("main h1")).toContainText(route.heading)
      await expect(page.getByTestId("app-shell-header")).toBeHidden()
      await expect(page.getByTestId("app-shell-utility")).toBeVisible()
    }
  })

  test("distinguishes value selectors from page view tabs", async ({
    page,
  }) => {
    const selectors = [
      { path: "/", label: "Period" },
      { path: "/forecast", label: "Forecast horizon" },
      { path: "/scenarios", label: "Scenario model" },
      { path: "/settings", label: "Theme mode" },
    ]

    for (const selector of selectors) {
      await page.goto(selector.path)
      const group = page.getByRole("group", { name: selector.label })
      await expect(group).toBeVisible()
      await expect(group.locator(".segmented-control-indicator")).toHaveCSS("opacity", "1")
    }

    await page.goto("/insights")
    await expect(page.getByRole("tablist", { name: "Insights views" })).toBeVisible()
    await page.goto("/recurring")
    await expect(page.getByRole("tablist", { name: "Recurring views" })).toBeVisible()

    await page.goto("/budgets")
    await expect(page.getByRole("group", { name: "Budget view" })).toHaveCount(0)
    await expect(page.getByLabel("Budget month")).toBeVisible()

    await expect(page.getByLabel(/^Period:/)).toHaveCount(0)
  })

  test("should load dashboard as home page", async ({ page }) => {
    await page.goto("/")
    await expect(page.locator("main h1")).toContainText("Dashboard")
    await expect(page).toHaveTitle("Expenses")
  })

  test("keeps every available desktop destination visible without an overflow menu", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto("/")

    const sidebar = page.getByRole("complementary", {
      name: "Application navigation",
    })
    await expect(sidebar).toBeVisible()
    await expect(page.getByTestId("app-shell-brand")).toHaveText("Expenses")
    for (const label of [
      "Dashboard",
      "Transactions",
      "Budgets",
      "Forecast",
      "Insights",
      "Digest",
      "Assistant",
      "Recurring",
      "Templates",
      "Rules",
      "Categories",
      "Tags",
      "What If",
      "Reconcile",
      "Reports",
      "Settings",
      "Admin",
    ]) {
      await expect(sidebar.getByRole("link", { name: label })).toBeVisible()
    }
    await expect(sidebar.getByRole("button", { name: /More/i })).toHaveCount(0)
    await expect(sidebar.getByRole("link", { name: /More/i })).toHaveCount(0)
  })

  test("reserves the sidebar scroll gutter while hiding its idle thumb", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 720 })
    await page.goto("/")

    const navigation = page.getByRole("navigation", { name: "Primary" })
    await expect(navigation).toBeVisible()
    await expect
      .poll(() =>
        navigation.evaluate((element) => {
          const style = getComputedStyle(element)
          return {
            gutter: style.scrollbarGutter,
            thumb: style.getPropertyValue("--sidebar-scrollbar-thumb").trim(),
          }
        })
      )
      .toEqual({ gutter: "stable", thumb: "transparent" })

    await navigation.hover()
    await expect
      .poll(() =>
        navigation.evaluate((element) =>
          getComputedStyle(element)
            .getPropertyValue("--sidebar-scrollbar-thumb")
            .trim()
        )
      )
      .not.toBe("transparent")

    await page.locator("main h1").hover()
    await expect
      .poll(() =>
        navigation.evaluate((element) =>
          getComputedStyle(element)
            .getPropertyValue("--sidebar-scrollbar-thumb")
            .trim()
        )
      )
      .toBe("transparent")
  })

  test("keeps theme selection in Settings and removes the shell quick toggle", async ({
    page,
  }) => {
    await page.goto("/")
    await page.evaluate((storageKey) => {
      window.localStorage.setItem(storageKey, "light")
    }, THEME_STORAGE_KEY)
    await page.reload()
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("light")
    await expect(page.getByTestId("shell-theme-quick-toggle")).toHaveCount(0)
    await clickSidebarLink(page, "Settings")
    const themeControl = page.getByTestId("settings-theme-control")
    await themeControl.getByRole("button", { name: "Dark" }).click()
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("dark")
    await expect.poll(() => readThemePreference(page)).toBe("dark")

    await clickSidebarLink(page, "Transactions")
    await expect(page).toHaveURL("/transactions")
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("dark")

    await clickSidebarLink(page, "Insights")
    await expect(page).toHaveURL("/insights")
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("dark")

    await clickSidebarLink(page, "Admin")
    await expect(page).toHaveURL(/\/admin\/elevate\?redirect=/)
    await expect(page.getByTestId("shell-theme-quick-toggle")).toHaveCount(0)
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("dark")

    await page.reload()
    await expect(page).toHaveURL(/\/admin\/elevate\?redirect=/)
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("dark")
    await expect.poll(() => readThemePreference(page)).toBe("dark")
  })

  test("should preserve period across primary navigation", async ({ page }) => {
    await page.goto("/")
    await page.getByRole("button", { name: "This month" }).click()
    await expect(page).toHaveURL(/period=this_month/)

    await clickSidebarLink(page, "Transactions")
    await expect(page).toHaveURL(/\/transactions\?period=this_month/)

    await clickSidebarLink(page, "Dashboard")
    await expect(page).toHaveURL(/\/\?period=this_month/)
  })

  test("keeps ledger search local to Transactions", async ({ page }) => {
    await page.goto("/?period=last_month")
    await expect(page.getByRole("searchbox")).toHaveCount(0)

    await clickSidebarLink(page, "Transactions")
    await page.getByRole("button", { name: "Search transactions" }).click()
    const search = page.getByRole("searchbox", { name: "Search transactions" })
    await search.fill("coffee beans")
    await expect(page).toHaveURL(/\/transactions\?period=last_month.*q=coffee/)
  })

  test("should navigate to transactions page", async ({ page }) => {
    await page.goto("/")
    await clickSidebarLink(page, "Transactions")
    await expect(page).toHaveURL("/transactions")
    await expect(page.locator("main h1")).toContainText("Transactions")
  })

  test("should navigate to insights page", async ({ page }) => {
    await page.goto("/")
    await clickSidebarLink(page, "Insights")
    await expect(page).toHaveURL("/insights")
    await expect(page.locator("main h1")).toContainText("Insights")
  })

  test("should navigate to forecast page", async ({ page }) => {
    await page.goto("/")
    await clickSidebarLink(page, "Forecast")
    await expect(page).toHaveURL("/forecast")
    await expect(page.locator("main h1")).toContainText("Forecast")
  })

  test("should navigate to budgets page", async ({ page }) => {
    await page.goto("/")
    await clickSidebarLink(page, "Budgets")
    await expect(page).toHaveURL("/budgets")
    await expect(page.locator("main h1")).toContainText("Budgets")
  })

  test("should navigate to digest page", async ({ page }) => {
    await page.goto("/")
    await clickSidebarLink(page, "Digest")
    await expect(page).toHaveURL("/digest")
    await expect(page.locator("main h1")).toContainText("Digest")
  })

  test("should navigate to spending assistant page", async ({ page }) => {
    await page.goto("/")
    await clickSidebarLink(page, "Assistant")
    await expect(page).toHaveURL("/assistant")
    await expect(
      page.getByRole("heading", { name: "Assistant", level: 1 })
    ).toBeVisible()
  })

  test("should navigate to recurring rules page", async ({ page }) => {
    await page.goto("/")
    await clickSidebarLink(page, "Recurring")
    await expect(page).toHaveURL("/recurring")
    await expect(page.locator("main h1")).toContainText("Recurring")
  })

  test("should navigate to templates page", async ({ page }) => {
    await page.goto("/")
    await clickSidebarLink(page, "Templates")
    await expect(page).toHaveURL("/templates")
    await expect(page.locator("main h1")).toContainText("Templates")
  })

  test("should navigate to categorization rules page", async ({ page }) => {
    await page.goto("/")
    await clickSidebarLink(page, "Rules")
    await expect(page).toHaveURL("/rules")
    await expect(page.locator("main h1")).toContainText("Categorization Rules")
  })

  test("should navigate to categories page", async ({ page }) => {
    await page.goto("/")
    await clickSidebarLink(page, "Categories")
    await expect(page).toHaveURL("/categories")
    await expect(page.locator("main h1")).toContainText("Categories")
  })

  test("should navigate to tags page", async ({ page }) => {
    await page.goto("/")
    await clickSidebarLink(page, "Tags")
    await expect(page).toHaveURL("/tags")
    await expect(page.locator("main h1")).toContainText("Tags")
  })

  test("should navigate to report builder page", async ({ page }) => {
    await page.goto("/")
    await clickSidebarLink(page, "Reports")
    await expect(page).toHaveURL("/reports/builder")
    await expect(page.locator("main h1")).toContainText("Report Builder")
  })

  test("should navigate to scenarios page", async ({ page }) => {
    await page.goto("/")
    await clickSidebarLink(page, "What If")
    await expect(page).toHaveURL("/scenarios")
    await expect(page.locator("main h1")).toContainText("What If")
  })

  test("should navigate to admin elevation gate", async ({ page }) => {
    await page.goto("/")
    await clickSidebarLink(page, "Admin")
    await expect(page).toHaveURL(/\/admin\/elevate\?redirect=/)
    await expect(page.locator("main h1")).toContainText("Re-enter your password")
  })

  test("uses page-specific desktop utility actions", async ({
    page,
  }) => {
    for (const route of ["/", "/transactions"]) {
      await page.goto(route)
      await page.getByRole("button", { name: "Add transaction" }).click()
      await expect(page.getByRole("dialog", { name: "Add transaction" })).toBeVisible()
      await page.keyboard.press("Escape")
    }

    await page.goto("/insights")
    await expect(page.getByRole("button", { name: "Add transaction" })).toHaveCount(0)

    await page.goto("/budgets")
    await page.getByRole("button", { name: "Add budget" }).click()
    await expect(page.getByRole("dialog", { name: "Add budget" })).toBeVisible()
    await page.keyboard.press("Escape")

    await page.goto("/recurring")
    await page.getByRole("button", { name: "Add rule" }).click()
    await expect(page.getByRole("dialog", { name: "Add rule" })).toBeVisible()
  })

  test("keeps the centered page canvas stable while shared modals lock scrolling", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 500 })

    for (const entry of [
      {
        path: "/",
        action: "Add transaction",
        dialog: "Add transaction",
      },
      { path: "/budgets", action: "Add budget", dialog: "Add budget" },
    ]) {
      await page.goto(entry.path)
      const action = page
        .getByTestId("app-shell-utility")
        .getByRole("button", { name: entry.action, exact: true })
      await expect(action).toBeVisible()

      // Emulate a classic 15px desktop scrollbar so Radix's compensation is
      // exercised even when the test host uses overlay scrollbars.
      await page.evaluate(() => {
        Object.defineProperty(document.documentElement, "clientWidth", {
          configurable: true,
          value: window.innerWidth - 15,
        })
      })

      const canvas = page.locator(".page-enter")
      const beforeBox = await canvas.boundingBox()
      expect(beforeBox).not.toBeNull()

      await action.click()
      const dialog = page.getByRole("dialog", { name: entry.dialog })
      await expect(dialog).toBeVisible()
      await expect
        .poll(() =>
          page.evaluate(() => ({
            overflow: getComputedStyle(document.body).overflow,
            marginRight: getComputedStyle(document.body).marginRight,
            scrollLocked: document.body.hasAttribute("data-scroll-locked"),
          })),
        )
        .toEqual({ overflow: "hidden", marginRight: "0px", scrollLocked: true })

      const openBox = await canvas.boundingBox()
      expect(openBox).not.toBeNull()
      expect(Math.abs(openBox!.x - beforeBox!.x)).toBeLessThanOrEqual(0.5)
      expect(Math.abs(openBox!.width - beforeBox!.width)).toBeLessThanOrEqual(0.5)

      await page.keyboard.press("Escape")
      await expect(dialog).toBeHidden()
      const closedBox = await canvas.boundingBox()
      expect(closedBox).not.toBeNull()
      expect(Math.abs(closedBox!.x - beforeBox!.x)).toBeLessThanOrEqual(0.5)
      expect(Math.abs(closedBox!.width - beforeBox!.width)).toBeLessThanOrEqual(0.5)
    }
  })

  test("restores desktop shell interactivity after closing the global add sheet", async ({
    page,
  }) => {
    await page.goto("/transactions")
    const addButton = page.getByRole("button", { name: "Add transaction" })
    await addButton.click()
    const dialog = page.getByRole("dialog", { name: "Add transaction" })
    await expect(dialog).toBeVisible()
    await expect
      .poll(() =>
        page.evaluate(() => ({
          overflow: getComputedStyle(document.body).overflow,
          scrollLocked: document.body.hasAttribute("data-scroll-locked"),
        })),
      )
      .toEqual({ overflow: "hidden", scrollLocked: true })

    await dialog.getByRole("button", { name: "Close" }).click()
    await expect(dialog).toBeHidden()
    await expect
      .poll(() =>
        page.evaluate(() => ({
          overflow: getComputedStyle(document.body).overflow,
          scrollLocked: document.body.hasAttribute("data-scroll-locked"),
        })),
      )
      .toEqual({ overflow: "visible", scrollLocked: false })

    await addButton.click()
    await expect(dialog).toBeVisible()
    await page.mouse.click(10, 10)
    await expect(dialog).toBeHidden()

    await addButton.click()
    await expect(dialog).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()
    await expect
      .poll(() =>
        page.evaluate(() => ({
          overflow: getComputedStyle(document.body).overflow,
          scrollLocked: document.body.hasAttribute("data-scroll-locked"),
        })),
      )
      .toEqual({ overflow: "visible", scrollLocked: false })

    await clickSidebarLink(page, "Insights")
    await expect(page).toHaveURL("/insights")
  })

  test("should show 404 page for unknown routes", async ({ page }) => {
    await page.goto("/unknown-route-12345")
    await expect(page.locator("main h1")).toContainText("Page not found")
  })

  test("recovers from unknown routes back to dashboard", async ({ page }) => {
    await page.goto("/unknown-route-12345")
    await page.getByRole("link", { name: "Back to dashboard" }).click()
    await expect(page).toHaveURL("/")
    await expect(page.locator("main h1")).toContainText("Dashboard")
  })
})
