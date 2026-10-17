import { expect, test, type Page } from "./fixtures"

test.describe.configure({ mode: "parallel" })

const THEME_STORAGE_KEY = "ew.theme.preference"

async function readThemeChrome(page: Page) {
  return page.evaluate(() => ({
    theme: document.documentElement.dataset.theme ?? null,
    themeColor:
      Array.from(
        document.querySelectorAll<HTMLMetaElement>("meta[name='theme-color']")
      ).find((meta) => meta.media !== "not all")?.content ?? null,
  }))
}

function tabBar(page: Page) {
  return page.getByRole("navigation", { name: "Tabs" })
}

async function chooseMoreDestination(page: Page, label: string) {
  await tabBar(page).getByRole("button", { name: "More" }).click()
  const sheet = page.getByRole("dialog", { name: "More" })
  await expect(sheet).toBeVisible()
  await sheet.getByRole("link", { name: label, exact: true }).click()
  await expect(sheet).toBeHidden()
}

test.describe("Navigation (mobile)", () => {
  test("loads dashboard as home page with the tab bar", async ({ page }) => {
    await page.goto("/")
    await expect(page.locator("main h1")).toContainText("Dashboard")
    const tabs = tabBar(page)
    await expect(tabs).toBeVisible()
    await expect(tabs.getByRole("link")).toHaveText([
      "Dashboard",
      "Transactions",
      "Budgets",
      "Insights",
    ])
    await expect(tabs.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "aria-current",
      "page",
    )
    await expect(tabs.getByRole("button", { name: "More" })).toBeVisible()
    await expect(
      page.getByRole("complementary", { name: "Application navigation" }),
    ).toBeHidden()
  })

  test("keeps every tab at least 44px tall and the bar on the bottom edge", async ({
    page,
  }) => {
    await page.goto("/")
    const layout = await tabBar(page).evaluate((node) => {
      const rect = node.getBoundingClientRect()
      return {
        bottom: rect.bottom,
        viewport: window.innerHeight,
        heights: Array.from(node.children).map(
          (child) => child.getBoundingClientRect().height,
        ),
      }
    })
    expect(layout.bottom).toBe(layout.viewport)
    for (const height of layout.heights) expect(height).toBeGreaterThanOrEqual(44)
  })

  test("preserves period across tab navigation", async ({ page }) => {
    await page.goto("/")
    await page.getByRole("button", { name: /^Period:/ }).click()
    await page.getByRole("menuitemcheckbox", { name: "This month" }).click()
    await expect(page).toHaveURL(/period=this_month/)

    await tabBar(page).getByRole("link", { name: "Transactions" }).click()
    await expect(page).toHaveURL(/\/transactions\?period=this_month/)

    await tabBar(page).getByRole("link", { name: "Dashboard" }).click()
    await expect(page).toHaveURL(/\/\?period=this_month/)
  })

  test("hides the tab bar while a dialog, sheet, or text field is active", async ({
    page,
  }) => {
    await page.goto("/transactions")
    const tabs = tabBar(page)
    await expect(tabs).toBeVisible()

    await page.getByRole("button", { name: "Add transaction" }).click()
    const addDialog = page.getByRole("dialog", { name: "Add transaction" })
    await expect(addDialog).toBeVisible()
    await addDialog.getByRole("button", { name: "Close" }).click()
    await expect(addDialog).toBeHidden()
    await expect(tabs).toBeVisible()

    await tabs.getByRole("button", { name: "More" }).click()
    const sheet = page.getByRole("dialog", { name: "More" })
    await expect(sheet).toBeVisible()
    await expect(tabs).toBeHidden()
    await page.keyboard.press("Escape")
    await expect(sheet).toBeHidden()
    await expect(tabs).toBeVisible()
    await expect(tabs.getByRole("button", { name: "More" })).toBeFocused()

    await page.getByRole("button", { name: "Search", exact: true }).click()
    const search = page.getByRole("searchbox", { name: "Search transactions" })
    await expect(search).toBeFocused()
    await expect(tabs).toBeHidden()
    await search.blur()
    await expect(tabs).toBeVisible()
  })

  test("navigates non-tab routes through the More sheet", async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto("/")

    const routes = [
      { label: "Assistant", path: "/assistant", heading: "Assistant" },
      { label: "Forecast", path: "/forecast", heading: "Forecast" },
      { label: "Digest", path: "/digest", heading: "Digest" },
      { label: "Recurring", path: "/recurring", heading: "Recurring" },
      { label: "Templates", path: "/templates", heading: "Templates" },
      { label: "Rules", path: "/rules", heading: "Rules" },
      { label: "Categories", path: "/categories", heading: "Categories" },
      { label: "Tags", path: "/tags", heading: "Tags" },
      { label: "Reports", path: "/reports/builder", heading: "Reports" },
      { label: "What If", path: "/scenarios", heading: "What If" },
      { label: "Reconcile", path: "/reconciliation", heading: "Reconcile" },
      { label: "Settings", path: "/settings", heading: "Settings" },
      {
        label: "Admin",
        path: "/admin/elevate?redirect=%2Fadmin",
        heading: "Admin",
      },
    ]

    for (const route of routes) {
      await chooseMoreDestination(page, route.label)
      await expect(page).toHaveURL(route.path)
      await expect(
        page.getByRole("heading", { name: route.heading, level: 1 }),
      ).toBeVisible()
    }
  })

  test("keeps theme selection in Settings across routes", async ({ page }) => {
    await page.goto("/")
    await page.evaluate((key) => window.localStorage.setItem(key, "dark"), THEME_STORAGE_KEY)
    await page.reload()
    await expect(page.getByTestId("shell-theme-quick-toggle")).toHaveCount(0)
    await chooseMoreDestination(page, "Settings")
    await page
      .getByRole("navigation", { name: "Settings sections" })
      .getByRole("link", { name: "Appearance" })
      .click()
    await page.getByRole("radiogroup", { name: "Theme" }).getByRole("radio", { name: "Light" }).click()
    await expect.poll(() => readThemeChrome(page)).toMatchObject({
      theme: "light",
      themeColor: "#eaeae7",
    })
    await expect
      .poll(() =>
        page.evaluate((key) => window.localStorage.getItem(key), THEME_STORAGE_KEY),
      )
      .toBe("light")

    await chooseMoreDestination(page, "Admin")
    await expect(page).toHaveURL(/\/admin\/elevate\?redirect=/)
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("light")

    await page.getByRole("link", { name: "Cancel" }).click()
    await expect(page).toHaveURL("/settings")
    await tabBar(page).getByRole("link", { name: "Transactions" }).click()
    await expect(page).toHaveURL("/transactions")
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("light")
  })

  test("recovers from unknown routes back to dashboard", async ({ page }) => {
    await page.goto("/unknown-route-12345")
    await page.getByRole("link", { name: "Go to dashboard" }).click()
    await expect(page).toHaveURL("/")
    await expect(page.locator("main h1")).toContainText("Dashboard")
  })
})
