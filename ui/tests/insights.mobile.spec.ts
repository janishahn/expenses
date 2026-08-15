import { expect, test } from "./fixtures"
import { createTransaction, getCsrfToken } from "./helpers"

test.describe("Insights Page (mobile)", () => {
  test("applies filters from the mobile filter sheet", async ({ page }) => {
    await page.goto("/insights")
    await page.getByRole("button", { name: /Filters/ }).click()
    const dialog = page.getByRole("dialog", { name: "Insights filters" })
    await expect(dialog).toBeVisible()
    await dialog.getByRole("button", { name: "Expense", exact: true }).click()
    await dialog.getByRole("button", { name: "Apply" }).click()
    await expect(page).toHaveURL(/type=expense/)
  })

  test("keeps the view switch compact and renders single-month chart points", async ({
    page,
  }) => {
    await page.goto("/insights?period=this_month")

    const viewSwitcher = page.locator(".insights-view-switcher")
    await expect(viewSwitcher).toBeVisible()
    const switcherWidth = await viewSwitcher.evaluate(
      (node) => node.getBoundingClientRect().width,
    )
    expect(switcherWidth).toBeLessThan(260)

    const chartPanel = page
      .locator('[data-financial-surface="chart"]')
      .filter({ hasText: "Monthly income vs expenses" })
      .first()
    const canvas = chartPanel.locator("canvas")
    await expect(canvas).toBeVisible()

    await expect
      .poll(() =>
        canvas.evaluate((node) => {
          const chart = node as HTMLCanvasElement
          const context = chart.getContext("2d")
          if (!context) return 0
          const styles = getComputedStyle(document.documentElement)
          const colors = ["--semantic-green", "--semantic-red"].map((token) =>
            styles
              .getPropertyValue(token)
              .trim()
              .split(/\s+/)
              .map(Number),
          )
          const pixels = context.getImageData(0, 0, chart.width, chart.height).data
          let matches = 0
          for (let index = 0; index < pixels.length; index += 4) {
            if (
              pixels[index + 3] > 0 &&
              colors.some(
                ([red, green, blue]) =>
                  Math.abs(pixels[index] - red) < 12 &&
                  Math.abs(pixels[index + 1] - green) < 12 &&
                  Math.abs(pixels[index + 2] - blue) < 12,
              )
            ) {
              matches += 1
            }
          }
          return matches
        }),
      )
      .toBeGreaterThan(10)
  })

  test("renders an interactive net chart without horizontal page scrolling", async ({
    page,
    request,
  }) => {
    const csrfToken = await getCsrfToken(request)
    const suffix = Date.now()
    const incomeName = `Mobile Net Income ${suffix}`
    const expenseName = `Mobile Net Expense ${suffix}`
    const createCategory = async (name: string, type: "income" | "expense") => {
      const response = await request.post("/api/categories", {
        headers: { "X-CSRF-Token": csrfToken },
        data: { name, type, order: 0 },
      })
      expect(response.ok()).toBeTruthy()
      return ((await response.json()) as { id: number }).id
    }
    const incomeCategoryID = await createCategory(incomeName, "income")
    const expenseCategoryID = await createCategory(expenseName, "expense")
    const now = new Date()

    await createTransaction(request, csrfToken, {
      date: now.toISOString().slice(0, 10),
      occurred_at: now.toISOString(),
      type: "income",
      amount_cents: 99_000_000,
      category_id: incomeCategoryID,
      title: incomeName,
      tags: [],
    })
    await createTransaction(request, csrfToken, {
      date: now.toISOString().slice(0, 10),
      occurred_at: now.toISOString(),
      type: "expense",
      amount_cents: 44_000_000,
      category_id: expenseCategoryID,
      title: expenseName,
      tags: [],
    })

    await page.goto("/insights?view=net&period=this_month")
    const chart = page.getByRole("group", { name: "Income and spending chart" })
    await expect(chart).toBeVisible()
    const expenseStep = chart.locator(
      `[data-waterfall-step][aria-label^="${expenseName}:"]`
    )
    await expect(expenseStep).toBeVisible()
    expect(await expenseStep.getAttribute("data-selected")).toBeNull()

    await expenseStep.click()
    await expect(expenseStep).toHaveAttribute("data-selected", "")
    await expect(page.getByTestId("waterfall-details")).toContainText(expenseName)

    await page.getByRole("heading", { name: "Income & spending" }).click()
    expect(await expenseStep.getAttribute("data-selected")).toBeNull()
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        )
      )
      .toBeLessThanOrEqual(0)
  })
})
