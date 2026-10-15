import { expect, test } from "./fixtures"
import {
  createTransaction,
  ensureCategory,
  getCsrfToken,
} from "./helpers"
import { useAuditTheme } from "./state-audit.helpers"

test.describe("State audit", () => {
  test("a failed add keeps the entered values, shows the API detail, and saves on retry", async ({
    page,
  }) => {
    await useAuditTheme(page, "light")
    await page.goto("/transactions")
    await page.getByRole("button", { name: "Add transaction", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Add transaction" })
    const submit = dialog.getByRole("button", { name: "Add transaction" })
    const title = `Audit pending transaction ${Date.now()}`

    let failNext = true
    await page.route("**/api/transactions", async (route) => {
      if (route.request().method() !== "POST" || !failNext) return route.continue()
      failNext = false
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          detail: [
            {
              loc: ["body", "amount_cents"],
              msg: "Audit amount must be positive.",
              type: "greater_than",
            },
          ],
        }),
      })
    })

    await dialog.getByLabel("Amount").fill("56.78")
    await dialog.getByLabel("Title").fill(title)
    await submit.click()
    await expect(submit).toBeDisabled()
    await expect(dialog.getByText("Audit amount must be positive.")).toBeVisible()
    await expect(submit).toBeEnabled()
    await expect(dialog.getByLabel("Amount")).toHaveValue("56.78")
    await expect(dialog.getByLabel("Title")).toHaveValue(title)

    await submit.click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole("status")).toContainText("Transaction added")
  })

  test("a failed list load shows the reason and Retry recovers the rows", async ({
    page,
    request,
  }) => {
    await useAuditTheme(page, "light")
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "Audit state")
    const title = `Audit recovery ${Date.now()}`
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
        body: '{"detail":"Audit list unavailable"}',
      })
    })
    await page.goto(`/transactions?period=all&q=${encodeURIComponent(title)}`)
    await expect(page.getByRole("heading", { name: "Transactions", level: 1 })).toBeVisible()
    await expect(page.getByRole("alert")).toHaveText("Unable to load transactions.")
    const retry = page.getByRole("button", { name: "Retry" })
    await expect(retry).toBeVisible()

    recover = true
    await retry.click()
    await expect(page.getByRole("listitem", { name: title })).toBeVisible()
    await expect(page.getByRole("alert")).toHaveCount(0)
  })

  test("route errors keep the page title and offer Retry", async ({ page }) => {
    await useAuditTheme(page, "light")
    const cases = [
      { path: "/transactions/deleted", api: "**/api/transactions/deleted?*", title: "Trash" },
      { path: "/recurring", api: "**/api/recurring", title: "Recurring" },
      { path: "/rules", api: "**/api/rules", title: "Rules" },
      {
        path: "/transactions/inbox",
        api: "**/api/transactions/uncategorized?*",
        title: "Uncategorized",
      },
    ]

    for (const routeCase of cases) {
      await page.route(routeCase.api, (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: '{"detail":"Audit route unavailable"}',
        }),
      )
      await page.goto(routeCase.path)
      await expect(
        page.getByRole("heading", { name: routeCase.title, level: 1, exact: true }),
      ).toBeVisible()
      await expect(page.getByRole("alert")).toContainText("Unable to load")
      await expect(page.getByRole("button", { name: "Retry" })).toBeVisible()
      await page.unroute(routeCase.api)
    }
  })

  test("a page that cannot reach the server keeps retrying and loads by itself", async ({
    page,
  }) => {
    await useAuditTheme(page, "light")
    await page.goto("/")
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible()

    let serverDown = true
    await page.route("**/api/**", (route) =>
      serverDown ? route.abort("connectionrefused") : route.continue(),
    )
    await page
      .getByRole("complementary", { name: "Application navigation" })
      .getByRole("link", { name: "Budgets", exact: true })
      .click()
    await expect(page.getByRole("heading", { name: "Budgets", level: 1 })).toBeVisible()
    await expect(page.getByRole("alert")).toContainText("Can't reach the server")
    await expect(page.getByRole("button", { name: "Retry now" })).toBeVisible()

    serverDown = false
    await expect(page.getByRole("button", { name: "Add budget" }).first()).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByRole("alert")).toHaveCount(0)
  })

  test("a gateway error shows the receipt only while the server does not answer", async ({
    page,
  }) => {
    await useAuditTheme(page, "light")
    // A proxy timing out one request while the server answers everything else.
    await page.route("**/api/rules", (route) => route.fulfill({ status: 504 }))
    await page.goto("/rules")
    await expect(page.getByRole("alert")).toHaveText("Unable to load rules.")
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible()

    // A proxy reporting the whole app as down.
    await page.route("**/api/**", (route) => route.fulfill({ status: 502 }))
    await page
      .getByRole("complementary", { name: "Application navigation" })
      .getByRole("link", { name: "Recurring", exact: true })
      .click()
    await expect(page.getByRole("alert")).toContainText("Can't reach the server")
  })

  test("a page whose code cannot load while the server is down reloads by itself", async ({
    page,
  }) => {
    await useAuditTheme(page, "light")
    await page.goto("/")
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible()

    let serverDown = true
    for (const url of ["**/assets/RulesPage-*.js", "**/api/**"]) {
      await page.route(url, (route) =>
        serverDown ? route.abort("connectionrefused") : route.continue(),
      )
    }
    const sidebar = page.getByRole("complementary", { name: "Application navigation" })
    await sidebar.getByRole("link", { name: "Rules", exact: true }).click()
    await expect(page.getByRole("heading", { name: "Rules", level: 1 })).toBeVisible()
    await expect(page.getByRole("alert")).toContainText("Can't reach the server")
    await expect(sidebar).toBeVisible()

    serverDown = false
    await expect(page.getByRole("button", { name: "Add rule" }).first()).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByRole("alert")).toHaveCount(0)
  })

  test("a page whose code is gone after an update offers Retry", async ({ page }) => {
    await useAuditTheme(page, "light")
    await page.goto("/")
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible()

    await page.route("**/assets/RulesPage-*.js", (route) => route.fulfill({ status: 404 }))
    await page
      .getByRole("complementary", { name: "Application navigation" })
      .getByRole("link", { name: "Rules", exact: true })
      .click()
    await expect(page.getByRole("heading", { name: "Rules", level: 1 })).toBeVisible()
    await expect(page.getByRole("alert")).toHaveText("Unable to load this page.")
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible()
  })

  test("an add form whose code cannot load keeps the page and offers Reload", async ({ page }) => {
    await useAuditTheme(page, "light")
    await page.goto("/transactions")
    await expect(page.getByRole("heading", { name: "Transactions", level: 1 })).toBeVisible()

    await page.route("**/assets/AddTransactionDialog-*.js", (route) => route.fulfill({ status: 404 }))
    await page.getByRole("button", { name: "Add transaction", exact: true }).click()
    await expect(page.getByRole("status")).toContainText("Unable to open the add form.")
    await expect(page.getByRole("button", { name: "Reload" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Transactions", level: 1 })).toBeVisible()
  })

  test("transaction detail distinguishes server failure from a missing record", async ({
    page,
  }) => {
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

  test("a custom period range with the end before the start is rejected", async ({ page }) => {
    await useAuditTheme(page, "light")
    await page.goto("/")
    await page.getByRole("button", { name: /^Period:/ }).click()
    await page.getByRole("menuitem", { name: "Custom range…" }).click()
    const customRange = page.getByRole("dialog", { name: "Custom range" })
    await customRange.getByLabel("Start").fill("2026-08-10")
    await customRange.getByLabel("End").fill("2026-08-01")
    await customRange.getByRole("button", { name: "Apply" }).click()
    await expect(customRange.getByText("End date must be after start date.")).toBeVisible()
    await expect(page).not.toHaveURL(/start=/)
  })
})
