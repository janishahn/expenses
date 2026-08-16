import { expect, test, type APIRequestContext, type Page } from "./fixtures"
import {
  createTransaction,
  ensureCategory,
  getCsrfToken,
  loginAsIsolatedUser,
} from "./helpers"
import {
  captureAuditState,
  type AuditLayout,
  type AuditTheme,
  useAuditTheme,
} from "./state-audit.helpers"

const themes: AuditTheme[] = ["light", "dark"]

function mobileAuditLayout(browserName: string): AuditLayout {
  return browserName === "webkit" ? "mobile-webkit" : "mobile-chromium-fallback"
}

function monthKey(offset: number) {
  const value = new Date()
  value.setDate(1)
  value.setMonth(value.getMonth() + offset)
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`
}

async function seedFinancialHistory(request: APIRequestContext, suffix: string) {
  const token = await getCsrfToken(request)
  const expenseId = await ensureCategory(request, token, "expense", `Audit mobile expense ${suffix}`)
  const incomeId = await ensureCategory(request, token, "income", `Audit mobile income ${suffix}`)
  for (let offset = -5; offset <= 0; offset += 1) {
    const key = monthKey(offset)
    await createTransaction(request, token, {
      date: `${key}-05`,
      occurred_at: `${key}-05T09:30:00`,
      type: "income",
      amount_cents: 240_000 + (offset + 5) * 7_500,
      category_id: incomeId,
      title: `Audit mobile chart income ${suffix} ${offset}`,
      tags: [],
    })
    await createTransaction(request, token, {
      date: `${key}-12`,
      occurred_at: `${key}-12T17:15:00`,
      type: "expense",
      amount_cents: 105_000 + (offset + 5) * 6_250,
      category_id: expenseId,
      title: `Audit mobile chart expense ${suffix} ${offset}`,
      tags: [],
    })
  }
  const budget = await request.post("/api/budgets/templates", {
    headers: { "X-CSRF-Token": token },
    data: {
      frequency: "monthly",
      category_id: null,
      amount_cents: 180_000,
      starts_on: `${monthKey(0)}-01`,
      ends_on: null,
    },
  })
  expect(budget.ok()).toBeTruthy()
  return { token, expenseId, incomeId }
}

async function expectCoarseTouch(page: Page, browserName: string) {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        coarse: window.matchMedia("(hover: none) and (pointer: coarse)").matches,
        touchPoints: navigator.maxTouchPoints,
      })),
    )
    .toEqual({
      coarse: true,
      touchPoints: browserName === "webkit" ? 0 : 1,
    })
}

async function openGlobalAdd(page: Page) {
  await page.getByRole("button", { name: "Add transaction", exact: true }).first().click()
  const dialog = page.getByRole("dialog", { name: "Add transaction" })
  await expect(dialog).toBeVisible()
  return dialog
}

test.describe("Mobile state audit evidence", () => {
  for (const theme of themes) {
    test(`captures recovery, disabled, gated, loading, destructive, and short-height states in ${theme}`, async ({
      browserName,
      page,
      request,
    }) => {
      const layout = mobileAuditLayout(browserName)
      await useAuditTheme(page, theme)
      await expectCoarseTouch(page, browserName)
      const token = await getCsrfToken(request)
      const categoryId = await ensureCategory(request, token, "expense", `Audit mobile state ${theme}`)
      const transactionId = await createTransaction(request, token, {
        date: new Date().toISOString().slice(0, 10),
        occurred_at: new Date().toISOString(),
        type: "expense",
        amount_cents: 3_456,
        category_id: categoryId,
        title: `Audit mobile destructive ${theme} ${Date.now()}`,
        tags: [],
      })

      await page.goto("/transactions")
      let dialog = await openGlobalAdd(page)
      await expect(
        dialog.getByText("Wait for tags to load before adding the transaction"),
      ).toHaveCount(0)
      await dialog.getByLabel("Amount").fill("12.34")
      await dialog.getByLabel("Title").fill("   ")
      await dialog.locator("form").evaluate((form) => {
        if (form instanceof HTMLFormElement) form.requestSubmit()
      })
      const validationError = dialog.getByText("Title is required")
      await expect(validationError).toBeVisible()
      await validationError.scrollIntoViewIfNeeded()
      await captureAuditState(page, layout, theme, "global add validation error")
      await page.keyboard.press("Escape")

      let addShouldFail = true
      await page.route("**/api/transactions", async (route) => {
        if (route.request().method() !== "POST") return route.continue()
        if (!addShouldFail) return route.continue()
        addShouldFail = false
        await new Promise((resolve) => setTimeout(resolve, 1_500))
        await route.fulfill({ status: 503, contentType: "application/json", body: '{"detail":"Audit mobile save unavailable"}' })
      })
      dialog = await openGlobalAdd(page)
      await dialog.getByLabel("Amount").fill("56.78")
      await dialog.getByLabel("Title").fill("Audit mobile pending transaction")
      await dialog.getByRole("button", { name: "Add transaction" }).click()
      await expect(dialog.getByRole("button", { name: "Saving..." })).toBeDisabled()
      await captureAuditState(page, layout, theme, "global add pending disabled")
      const requestError = dialog.getByText(/Audit mobile save unavailable/)
      await expect(requestError).toBeVisible()
      await expect(requestError).toHaveText("Audit mobile save unavailable")
      await expect(dialog.getByLabel("Amount")).toHaveValue("56.78")
      await expect(dialog.getByLabel("Title")).toHaveValue(
        "Audit mobile pending transaction",
      )
      await requestError.scrollIntoViewIfNeeded()
      await captureAuditState(page, layout, theme, "global add request recovery")
      await dialog.getByRole("button", { name: "Add transaction" }).click()
      await expect(dialog).toBeHidden()
      await page.unroute("**/api/transactions")

      await page.goto(`/transactions/${transactionId}`)
      await page.getByRole("button", { name: "Delete transaction" }).click()
      await expect(page.getByRole("dialog", { name: "Delete this transaction?" })).toBeVisible()
      await captureAuditState(page, layout, theme, "transaction destructive confirmation")
      await page.getByRole("button", { name: "Cancel" }).click()

      await page.goto("/admin")
      await expect(page).toHaveURL(/\/admin\/elevate/)
      await page.getByTestId("admin-elevation-password").fill("wrong-password")
      await page.getByTestId("admin-elevation-submit").click()
      await expect(page.getByTestId("admin-elevation-error")).toHaveText("Invalid password")
      await captureAuditState(page, layout, theme, "admin elevation invalid password")

      await page.route("**/api/auth/bootstrap-status", async (route) => {
        const response = await route.fetch()
        const payload = (await response.json()) as Record<string, unknown>
        await route.fulfill({ json: { ...payload, llm_enabled: false } })
      })
      await page.goto("/rules")
      await expect(page.getByRole("heading", { name: "Categorization Rules" })).toBeVisible()
      await expect(page.getByRole("button", { name: "Mine rules" })).toHaveCount(0)
      await captureAuditState(page, layout, theme, "llm feature disabled rules")
      await page.goto("/assistant")
      await expect(page).toHaveURL("/")
      await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible()
      await captureAuditState(page, layout, theme, "llm feature disabled redirect")
      await page.unroute("**/api/auth/bootstrap-status")

      await page.route(/\/api\/transactions(?:\?|$)/, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1_000))
        await route.continue()
      })
      await page.goto("/transactions?period=all")
      await expect(page.getByTestId("route-loading")).toBeVisible()
      await captureAuditState(page, layout, theme, "transactions delayed loading")
      await expect(page.getByTestId("route-loading")).toHaveCount(0)
      await page.unroute(/\/api\/transactions(?:\?|$)/)

      let recoverList = false
      await page.route(/\/api\/transactions(?:\?|$)/, (route) => {
        if (recoverList) return route.continue()
        return route.fulfill({ status: 500, contentType: "application/json", body: '{"detail":"Audit mobile list unavailable"}' })
      })
      await page.goto("/transactions?period=all")
      await expect(page.getByText(/Unable to load transactions/i)).toBeVisible()
      await expect(
        page.getByRole("heading", { name: "Transactions", exact: true }),
      ).toBeVisible()
      const retryTransactions = page.getByRole("button", { name: "Retry" })
      await expect(retryTransactions).toBeVisible()
      await captureAuditState(page, layout, theme, "transactions route error")
      recoverList = true
      await retryTransactions.click()
      await expect(page.getByText(/matching transactions/i)).toBeVisible()
      await captureAuditState(page, layout, theme, "transactions route error recovered")
      await page.unroute(/\/api\/transactions(?:\?|$)/)

      await page.goto("/transactions/999999999")
      await expect(page.getByText(/not found/i).first()).toBeVisible()
      const returnFromMissing = page.getByRole("link", { name: "Back to transactions" })
      await expect(returnFromMissing).toBeVisible()
      await captureAuditState(page, layout, theme, "transaction missing recovery")
      await returnFromMissing.click()
      await expect(page).toHaveURL(/\/transactions(?:\?|$)/)

      await page.goto("/")
      await page.getByRole("button", { name: "Custom", exact: true }).click()
      await page.getByLabel("Start date").fill("2026-08-10")
      await page.getByLabel("End date").fill("2026-08-01")
      await page.getByRole("button", { name: "Apply custom range" }).click()
      const periodError = page.getByText("End date must be after start date.")
      await expect(periodError).toBeVisible()
      await periodError.scrollIntoViewIfNeeded()
      await captureAuditState(page, layout, theme, "period custom validation")

      await page.goto("/reports/builder")
      for (const name of ["Summary", "Category breakdown", "Transactions"]) {
        await page.getByRole("checkbox", { name, exact: true }).uncheck()
      }
      await page.getByRole("button", { name: "Generate PDF" }).click()
      const reportError = page.getByText("Select at least one report section.")
      await expect(reportError).toBeVisible()
      await reportError.scrollIntoViewIfNeeded()
      await captureAuditState(page, layout, theme, "report builder validation")

      await page.goto("/scenarios")
      await page.getByLabel("Adjustment type").selectOption("add_rule")
      await page.getByRole("button", { name: "Add adjustment" }).click()
      const scenarioError = page.getByText("Enter a valid name and amount.")
      await expect(scenarioError).toBeVisible()
      await scenarioError.scrollIntoViewIfNeeded()
      await captureAuditState(page, layout, theme, "scenario validation")

      await page.setViewportSize({ width: 393, height: 360 })
      await page.goto("/transactions")
      await expectCoarseTouch(page, browserName)
      dialog = await openGlobalAdd(page)
      await dialog.getByLabel("Title").focus()
      await captureAuditState(page, layout, theme, "global add short-height focused field")
      await dialog.getByRole("button", { name: "Cancel" }).scrollIntoViewIfNeeded()
      await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible()
      await captureAuditState(page, layout, theme, "global add short-height actions")
    })

    test(`captures ordinary-member role gate in ${theme}`, async ({
      browserName,
      page,
    }) => {
      const layout = mobileAuditLayout(browserName)
      await useAuditTheme(page, theme)
      await expectCoarseTouch(page, browserName)
      await page.goto("/")
      const member = await loginAsIsolatedUser(page)
      await page.goto("/settings")
      await expect(page.getByTestId("settings-page")).toBeVisible()
      await page.getByRole("button", { name: "Open menu" }).click()
      const menu = page.getByRole("complementary", { name: "Application menu" })
      await expect(menu.getByRole("link", { name: "Admin" })).toHaveCount(0)
      await captureAuditState(page, layout, theme, "ordinary member menu")
      await page.keyboard.press("Escape")
      await page.goto("/admin")
      await expect(page).toHaveURL("/")
      await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible()
      await captureAuditState(page, layout, theme, "ordinary member admin redirect")
      await member.request.dispose()
    })

    test(`captures populated chart viewports, drill-downs, and nonvisual equivalents in ${theme}`, async ({
      browserName,
      page,
      request,
    }) => {
      const layout = mobileAuditLayout(browserName)
      await useAuditTheme(page, theme)
      await expectCoarseTouch(page, browserName)
      await seedFinancialHistory(request, `${theme}-${Date.now()}`)

      await page.goto("/")
      await page.waitForLoadState("networkidle")
      await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible()
      await captureAuditState(page, layout, theme, "dashboard populated balance hero")
      const legendButton = page.getByTestId("dashboard-donut-legend").getByRole("button").first()
      if (await legendButton.isVisible().catch(() => false)) {
        await legendButton.scrollIntoViewIfNeeded()
        await legendButton.click()
        await captureAuditState(page, layout, theme, "dashboard category chart selection")
      }

      await page.goto("/insights?period=last_6_months")
      await page.waitForLoadState("networkidle")
      const analysisChart = page.locator("canvas").first()
      await analysisChart.scrollIntoViewIfNeeded()
      await captureAuditState(page, layout, theme, "insights populated analysis")
      await page.getByRole("button", { name: "Net" }).click()
      const netView = page.getByRole("heading", { name: "Income & spending" })
      await expect(netView).toBeVisible()
      await netView.scrollIntoViewIfNeeded()
      await captureAuditState(page, layout, theme, "insights populated net")

      await page.goto("/forecast?horizon=6&mode=full")
      await page.waitForLoadState("networkidle")
      const monthButton = page.locator("button").filter({ hasText: /20\d\d/ }).first()
      if (await monthButton.isVisible().catch(() => false)) await monthButton.click()
      const outlook = page.getByText("Monthly outlook", { exact: true })
      await outlook.scrollIntoViewIfNeeded()
      await captureAuditState(page, layout, theme, "forecast populated drilldown")

      await page.goto("/scenarios?horizon=6&mode=full")
      await page.getByLabel("Adjustment type").selectOption("one_time")
      await page.getByLabel("Name").fill("Audit mobile scenario")
      await page.getByRole("textbox", { name: "Month", exact: true }).fill(monthKey(1))
      await page.getByLabel("Amount").fill("200.00")
      await page.getByRole("button", { name: "Add adjustment" }).click()
      const scenarioCanvas = page.locator("canvas").first()
      await expect(scenarioCanvas).toBeVisible()
      await scenarioCanvas.scrollIntoViewIfNeeded()
      await captureAuditState(page, layout, theme, "scenario populated chart")

      await page.goto("/budgets")
      await expect(page.getByRole("heading", { name: "Budgets", exact: true })).toBeVisible()
      const details = page.getByRole("button", { name: "View details" }).first()
      if (await details.isVisible().catch(() => false)) await details.click()
      const budgetChart = page.locator("canvas").first()
      if (await budgetChart.isVisible().catch(() => false)) await budgetChart.scrollIntoViewIfNeeded()
      await captureAuditState(page, layout, theme, "budget populated burndown")

      await page.goto("/digest")
      await page.waitForLoadState("networkidle")
      await captureAuditState(page, layout, theme, "digest populated decision sections")
    })
  }
})

test("missing organization routes offer touch-accessible return paths", async ({
  browserName,
  page,
}) => {
  const layout = mobileAuditLayout(browserName)
  await useAuditTheme(page, "light")
  await page.goto("/tags/999999999")
  await expect(page.getByRole("heading", { name: "Tag not found." })).toBeVisible()
  const tagsReturn = page.getByRole("link", { name: "Back to tags" })
  await expect(tagsReturn).toBeVisible()
  await captureAuditState(page, layout, "light", "missing tag recovery")
  await tagsReturn.tap()
  await expect(page).toHaveURL("/tags")

  await page.goto("/recurring/999999999/occurrences")
  await expect(page.getByRole("heading", { name: "Rule not found." })).toBeVisible()
  const recurringReturn = page.getByRole("link", { name: "Back to recurring" })
  await expect(recurringReturn).toBeVisible()
  await captureAuditState(page, layout, "light", "missing recurring rule recovery")
  await recurringReturn.tap()
  await expect(page).toHaveURL("/recurring")
})

test("transaction detail server failure remains retryable on mobile", async ({
  browserName,
  page,
}) => {
  const layout = mobileAuditLayout(browserName)
  await useAuditTheme(page, "light")
  await page.route("**/api/transactions/999999998", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: '{"detail":"Audit transaction unavailable"}',
    })
  )
  await page.goto("/transactions/999999998")
  await expect(
    page.getByRole("heading", { name: "Unable to load transaction." })
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Back to transactions" })).toHaveCount(0)
  await captureAuditState(page, layout, "light", "transaction detail server error")
})
