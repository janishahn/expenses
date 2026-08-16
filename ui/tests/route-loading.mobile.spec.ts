import { expect, test } from "./fixtures"
import {
  createTransaction,
  ensureCategory,
  getCsrfToken,
} from "./helpers"

test.describe("Route loading skeleton (mobile)", () => {
  test("keeps the budget editor action unavailable until its route data is ready", async ({
    page,
  }) => {
    let releaseBudgets: () => void = () => undefined
    const budgetsReady = new Promise<void>((resolve) => {
      releaseBudgets = resolve
    })
    await page.route(/\/api\/budgets(?:\?|$)/, async (route) => {
      await budgetsReady
      await route.continue()
    })

    await page.goto("/budgets")
    await expect(page.getByTestId("route-loading")).toBeVisible()
    await expect(page.getByRole("button", { name: "Add budget" })).toHaveCount(0)

    releaseBudgets()
    const addBudget = page.getByRole("button", { name: "Add budget" })
    await expect(addBudget).toBeVisible()
    await addBudget.click()
    await expect(page.getByRole("dialog", { name: "Add budget" })).toBeVisible()
  })

  test("shows the skeleton for slow loads and removes it when content is ready", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Route Loading")
    const title = `E2E Route Loading Slow Mobile ${Date.now()}`
    await createTransaction(request, token, {
      date: "2026-04-18",
      occurred_at: "2026-04-18T09:45:00",
      type: "expense",
      amount_cents: 3456,
      category_id: categoryId,
      title,
      tags: ["route-loading"],
    })

    let releaseTransactions: () => void = () => undefined
    const transactionsReady = new Promise<void>((resolve) => {
      releaseTransactions = resolve
    })
    await page.route(/\/api\/transactions/, async (route) => {
      await transactionsReady
      await route.continue()
    })

    await page.goto(`/transactions?period=all&q=${encodeURIComponent(title)}`)

    const loader = page.getByTestId("route-loading")
    await expect(loader).toBeVisible()
    await expect(loader.getByRole("status")).toHaveText("Loading transactions…")

    releaseTransactions()
    const row = page.locator("div.surface-card").filter({ hasText: title }).first()
    await expect(row).toBeVisible()
    await expect(loader).toHaveCount(0)
  })

  test("never shows the skeleton when the load finishes quickly", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Route Loading")
    const title = `E2E Route Loading Fast Mobile ${Date.now()}`
    await createTransaction(request, token, {
      date: "2026-04-18",
      occurred_at: "2026-04-18T10:00:00",
      type: "expense",
      amount_cents: 4567,
      category_id: categoryId,
      title,
      tags: ["route-loading"],
    })

    await page.addInitScript(() => {
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (
              node instanceof Element &&
              (node.matches('[data-testid="route-loading"]') ||
                node.querySelector('[data-testid="route-loading"]'))
            ) {
              document.documentElement.dataset.routeLoadingSeen = "true"
            }
          }
        }
      })
      observer.observe(document.documentElement, { childList: true, subtree: true })
    })

    await page.goto(`/transactions?period=all&q=${encodeURIComponent(title)}`)

    const row = page.locator("div.surface-card").filter({ hasText: title }).first()
    await expect(row).toBeVisible()
    expect(await page.locator("html").getAttribute("data-route-loading-seen")).toBeNull()
  })
})
