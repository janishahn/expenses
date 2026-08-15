import { expect, test } from "./fixtures"
import {
  createTransaction,
  ensureCategory,
  getCsrfToken,
} from "./helpers"

test.describe("Route loading skeleton", () => {
  test("shows the skeleton for slow loads and removes it when content is ready", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Route Loading")
    const title = `E2E Route Loading Slow ${Date.now()}`
    await createTransaction(request, token, {
      date: "2026-04-18",
      occurred_at: "2026-04-18T09:15:00",
      type: "expense",
      amount_cents: 1234,
      category_id: categoryId,
      title,
      tags: ["route-loading"],
    })

    await page.route(/\/api\/transactions/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800))
      await route.continue()
    })

    await page.goto(`/transactions?period=all&q=${encodeURIComponent(title)}`)

    const loader = page.getByTestId("route-loading")
    await expect(loader).toBeVisible()
    await expect(loader.getByRole("status")).toHaveText("Loading transactions…")

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
    const title = `E2E Route Loading Fast ${Date.now()}`
    await createTransaction(request, token, {
      date: "2026-04-18",
      occurred_at: "2026-04-18T09:30:00",
      type: "expense",
      amount_cents: 2345,
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
