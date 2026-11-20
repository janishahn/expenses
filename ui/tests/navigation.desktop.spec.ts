import { test, expect, type Page } from "./fixtures"
import { loginAsIsolatedUser } from "./helpers"

test.describe.configure({ mode: "parallel" })

test.describe("Navigation", () => {
  const clickSidebarLink = async (page: Page, name: string) => {
    const sidebar = page.getByRole("complementary", {
      name: "Application navigation",
    })
    await expect(sidebar).toBeVisible()
    await sidebar.getByRole("link", { name, exact: true }).click()
  }

  const chooseAppMenuItem = async (page: Page, name: string) => {
    await page.getByRole("button", { name: "Expenses", exact: true }).click()
    await page.getByRole("menuitem", { name }).click()
  }

  test("signs out from the app-name menu", async ({ page }) => {
    await page.goto("/")
    await loginAsIsolatedUser(page)
    await page.goto("/")
    await chooseAppMenuItem(page, "Sign out")
    await expect(page).toHaveURL(/\/login(?:\?|$)/)
    await expect(page.getByTestId("app-shell-root")).toHaveCount(0)
  })

  test("should preserve period across primary navigation", async ({ page }) => {
    await page.goto("/")
    await page.getByRole("button", { name: /^Period:/ }).click()
    await page.getByRole("menuitemcheckbox", { name: "This month" }).click()
    await expect(page).toHaveURL(/period=this_month/)

    await clickSidebarLink(page, "Transactions")
    await expect(page).toHaveURL(/\/transactions\?period=this_month/)

    await clickSidebarLink(page, "Dashboard")
    await expect(page).toHaveURL(/\/\?period=this_month/)
  })

  test("navigates to every sidebar destination", async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto("/")

    const routes = [
      { label: "Transactions", path: "/transactions", heading: "Transactions" },
      { label: "Insights", path: "/insights", heading: "Insights" },
      { label: "Forecast", path: "/forecast", heading: "Forecast" },
      { label: "Budgets", path: "/budgets", heading: "Budgets" },
      { label: "Digest", path: "/digest", heading: "Digest" },
      { label: "Assistant", path: "/assistant", heading: "Assistant" },
      { label: "Recurring", path: "/recurring", heading: "Recurring" },
      { label: "Templates", path: "/templates", heading: "Templates" },
      { label: "Rules", path: "/rules", heading: "Rules" },
      { label: "Categories", path: "/categories", heading: "Categories" },
      { label: "Tags", path: "/tags", heading: "Tags" },
      { label: "Reports", path: "/reports/builder", heading: "Reports" },
      { label: "What If", path: "/scenarios", heading: "What If" },
      { label: "Reconcile", path: "/reconciliation", heading: "Reconcile" },
    ]

    for (const route of routes) {
      await clickSidebarLink(page, route.label)
      await expect(page).toHaveURL(route.path)
      await expect(
        page.getByRole("heading", { name: route.heading, level: 1 })
      ).toBeVisible()
    }

    await chooseAppMenuItem(page, "Admin")
    await expect(page).toHaveURL(/\/admin\/elevate\?redirect=/)
    await expect(page.locator("main h1")).toContainText("Health")
    await expect(page.getByRole("heading", { name: "Enter your password" })).toBeVisible()
  })

  test("shows the 404 page for unknown routes and returns to the dashboard", async ({ page }) => {
    await page.goto("/unknown-route-12345?from=test")
    await expect(page.locator("main h1")).toHaveText("This page does not exist")
    await expect(page.locator("main")).toContainText("/unknown-route-12345?from=test")
    await page.getByRole("link", { name: "Go to dashboard" }).click()
    await expect(page).toHaveURL("/")
    await expect(page.locator("main h1")).toContainText("Dashboard")
  })
})
