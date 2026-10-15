import { expect, test } from "./fixtures"
import {
  createTransaction,
  ensureCategory,
  getCsrfToken,
  loginAsIsolatedUser,
} from "./helpers"
import { useAuditTheme } from "./state-audit.helpers"

test.describe("Mobile state audit", () => {
  test("a failed add keeps the entered values and its actions reachable at short height", async ({
    page,
  }) => {
    await useAuditTheme(page, "light")
    await page.setViewportSize({ width: 393, height: 360 })
    await page.goto("/transactions")
    await page.getByRole("button", { name: "Add transaction", exact: true }).tap()
    const dialog = page.getByRole("dialog", { name: "Add transaction" })
    const submit = dialog.getByRole("button", { name: "Add transaction" })
    const title = `Audit mobile pending ${Date.now()}`

    let failNext = true
    await page.route("**/api/transactions", async (route) => {
      if (route.request().method() !== "POST" || !failNext) return route.continue()
      failNext = false
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"detail":"Audit mobile save unavailable"}',
      })
    })

    await dialog.getByLabel("Amount").fill("56.78")
    await dialog.getByLabel("Title").fill(title)
    await submit.scrollIntoViewIfNeeded()
    await submit.tap()
    await expect(submit).toBeDisabled()
    const failure = dialog.getByText("Audit mobile save unavailable")
    await failure.scrollIntoViewIfNeeded()
    await expect(failure).toBeVisible()
    await expect(dialog.getByLabel("Amount")).toHaveValue("56.78")
    await expect(dialog.getByLabel("Title")).toHaveValue(title)

    const cancel = dialog.getByRole("button", { name: "Cancel" })
    await cancel.scrollIntoViewIfNeeded()
    await expect(cancel).toBeVisible()
    await expect(submit).toBeEnabled()
    await submit.scrollIntoViewIfNeeded()
    await submit.tap()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole("status")).toContainText("Transaction added")
  })

  test("a failed list load shows the reason and Retry recovers the rows", async ({
    page,
    request,
  }) => {
    await useAuditTheme(page, "light")
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "Audit mobile state")
    const title = `Audit mobile recovery ${Date.now()}`
    await createTransaction(request, token, {
      date: "2026-04-18",
      occurred_at: "2026-04-18T13:10:00",
      type: "expense",
      amount_cents: 3_456,
      category_id: categoryId,
      title,
      tags: [],
    })

    let recover = false
    await page.route(/\/api\/transactions(?:\?|$)/, (route) => {
      if (recover) return route.continue()
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"detail":"Audit mobile list unavailable"}',
      })
    })
    await page.goto(`/transactions?period=all&q=${encodeURIComponent(title)}`)
    await expect(page.getByRole("heading", { name: "Transactions", level: 1 })).toBeVisible()
    await expect(page.getByRole("alert")).toHaveText("Unable to load transactions.")
    const retry = page.getByRole("button", { name: "Retry" })
    await expect(retry).toBeVisible()

    recover = true
    await retry.tap()
    await expect(page.getByRole("listitem", { name: title })).toBeVisible()
    await expect(page.getByRole("alert")).toHaveCount(0)
  })

  test("a custom period range with the end before the start is rejected", async ({ page }) => {
    await useAuditTheme(page, "light")
    await page.goto("/")
    await page.getByRole("button", { name: /^Period:/ }).tap()
    await page.getByRole("menuitem", { name: "Custom range…" }).tap()
    const customRange = page.getByRole("dialog", { name: "Custom range" })
    await customRange.getByLabel("Start").fill("2026-08-10")
    await customRange.getByLabel("End").fill("2026-08-01")
    await customRange.getByRole("button", { name: "Apply" }).tap()
    const error = customRange.getByText("End date must be after start date.")
    await error.scrollIntoViewIfNeeded()
    await expect(error).toBeVisible()
    await expect(page).not.toHaveURL(/start=/)
  })

  test("an ordinary member sees no Admin entry and /admin returns to the dashboard", async ({
    page,
  }) => {
    await useAuditTheme(page, "light")
    await page.goto("/")
    const member = await loginAsIsolatedUser(page)
    try {
      await page.goto("/settings")
      await page.getByRole("navigation", { name: "Tabs" }).getByRole("button", { name: "More" }).tap()
      const menu = page.getByRole("dialog", { name: "More" })
      await expect(menu.getByRole("link", { name: "Settings" })).toBeVisible()
      await expect(menu.getByRole("link", { name: "Admin" })).toHaveCount(0)
      await page.keyboard.press("Escape")
      await page.goto("/admin")
      await expect(page).toHaveURL("/")
      await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible()
    } finally {
      await member.request.dispose()
    }
  })

  test("disabled AI hides the Assistant and rule mining on mobile", async ({ page }) => {
    await useAuditTheme(page, "light")
    await page.route("**/api/auth/bootstrap-status", async (route) => {
      const response = await route.fetch()
      const payload = (await response.json()) as Record<string, unknown>
      await route.fulfill({ json: { ...payload, llm_enabled: false } })
    })
    await page.goto("/rules")
    await expect(page.getByRole("heading", { name: "Rules", level: 1 })).toBeVisible()
    await expect(page.getByRole("button", { name: "Add rule" }).first()).toBeVisible()
    await expect(page.getByRole("button", { name: "More actions" })).toHaveCount(0)
    await page.getByRole("navigation", { name: "Tabs" }).getByRole("button", { name: "More" }).tap()
    const menu = page.getByRole("dialog", { name: "More" })
    await expect(menu.getByRole("link", { name: "Rules" })).toBeVisible()
    await expect(menu.getByRole("link", { name: "Assistant" })).toHaveCount(0)
    await page.keyboard.press("Escape")

    await page.goto("/assistant")
    await expect(page).toHaveURL("/")
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible()
  })

  test("missing tag and recurring routes offer touch-accessible return paths", async ({
    page,
  }) => {
    await useAuditTheme(page, "light")
    await page.goto("/tags/999999999")
    await expect(page.getByRole("alert")).toHaveText("Tag not found.")
    const tagsReturn = page.getByRole("link", { name: "Back to tags" })
    await expect(tagsReturn).toBeVisible()
    await tagsReturn.tap()
    await expect(page).toHaveURL("/tags")

    await page.goto("/recurring/999999999/occurrences")
    await expect(page.getByRole("alert")).toHaveText("Rule not found.")
    const recurringReturn = page.getByRole("link", { name: "Back to recurring" })
    await expect(recurringReturn).toBeVisible()
    await recurringReturn.tap()
    await expect(page).toHaveURL("/recurring")
  })

  test("transaction detail server failure remains retryable on mobile", async ({ page }) => {
    await useAuditTheme(page, "light")
    await page.route("**/api/transactions/999999998", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"detail":"Audit transaction unavailable"}',
      }),
    )
    await page.goto("/transactions/999999998")
    await expect(
      page.getByRole("alert").filter({ hasText: "Unable to load transaction." }),
    ).toBeVisible()
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Back to transactions" })).toHaveCount(0)
  })

  test("a page that cannot reach the server loads by itself on mobile", async ({ page }) => {
    await useAuditTheme(page, "light")
    await page.goto("/")
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible()

    let serverDown = true
    await page.route("**/api/**", (route) =>
      serverDown ? route.abort("connectionrefused") : route.continue(),
    )
    await page.getByRole("navigation", { name: "Tabs" }).getByRole("link", { name: "Budgets" }).tap()
    await expect(page.getByRole("alert")).toContainText("Can't reach the server")
    await expect(page.getByRole("button", { name: "Retry now" })).toBeVisible()

    serverDown = false
    await expect(page.getByRole("button", { name: "Add budget" }).first()).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByRole("alert")).toHaveCount(0)
  })
})
