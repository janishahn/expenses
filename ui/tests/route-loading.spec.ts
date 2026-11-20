import { expect, test } from "./fixtures"

test.describe("Route loading skeleton", () => {
  test("keeps the budget editor action unavailable until its route data is ready", async ({
    page,
  }) => {
    let releaseBudgets: () => void = () => {}
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
    await expect(page.getByRole("heading", { name: "Budgets", level: 1 })).toBeVisible()

    releaseBudgets()
    const addBudget = page
      .getByRole("main")
      .locator("header")
      .getByRole("button", { name: "Add budget" })
    await expect(addBudget).toBeVisible()
    await addBudget.click()
    await expect(page.getByRole("dialog", { name: "Add budget" })).toBeVisible()
  })
})
