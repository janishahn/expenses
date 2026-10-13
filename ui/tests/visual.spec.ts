import { expect, test } from "./fixtures"
import { loginAsIsolatedUser } from "./helpers"
import {
  mockDashboardApi,
  prepareVisualPage,
  seedBudgets,
  seedLedger,
  settle,
  THEMES,
  visualContext,
} from "./visual.fixtures"

test.use(visualContext)

const screenshot = { animations: "disabled" as const, maxDiffPixels: 100 }

for (const theme of THEMES) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await prepareVisualPage(page, theme)
    })

    test(`Dashboard keeps its desktop ${theme} look @visual`, async ({ page }) => {
      // The page scrolls inside the shell, so a tall viewport shows the whole dashboard.
      await page.setViewportSize({ width: 1280, height: 1180 })
      await mockDashboardApi(page)
      await page.goto("/")
      await loginAsIsolatedUser(page)
      await page.goto("/")
      await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible()
      await expect(page.getByRole("list", { name: "Recent transactions" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`dashboard-desktop-${theme}.png`, { ...screenshot, fullPage: true })
    })

    test(`Transactions with the peek open keep their desktop ${theme} look @visual`, async ({ page }) => {
      await page.goto("/")
      const { request, csrfToken } = await loginAsIsolatedUser(page)
      const peekId = await seedLedger(request, csrfToken)
      await page.goto(`/transactions?peek=${peekId}`)
      await expect(page.getByRole("complementary", { name: "Dinner at Trattoria" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`transactions-peek-desktop-${theme}.png`, { ...screenshot, fullPage: true })
    })

    test(`Add transaction dialog keeps its desktop ${theme} look @visual`, async ({ page }) => {
      await page.goto("/")
      const { request, csrfToken } = await loginAsIsolatedUser(page)
      await seedLedger(request, csrfToken)
      await page.goto("/transactions")
      await page.getByRole("button", { name: "Add transaction", exact: true }).click()
      const dialog = page.getByRole("dialog", { name: "Add transaction" })
      await expect(dialog).toBeVisible()
      await settle(page)
      await expect(dialog).toHaveScreenshot(`add-transaction-desktop-${theme}.png`, {
        ...screenshot,
      })
    })

    test(`Budgets keep their desktop ${theme} look @visual`, async ({ page }) => {
      await page.goto("/")
      const { request, csrfToken } = await loginAsIsolatedUser(page)
      await seedLedger(request, csrfToken)
      await seedBudgets(request, csrfToken)
      await page.goto("/budgets?month=2026-07")
      await expect(page.getByRole("heading", { name: "Budgets", level: 1 })).toBeVisible()
      await expect(page.getByText("Groceries").first()).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`budgets-desktop-${theme}.png`, { ...screenshot, fullPage: true })
    })
  })
}
