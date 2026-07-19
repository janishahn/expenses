import { test, expect, type Page } from "./fixtures"

async function disableLlmCapability(page: Page) {
  await page.route("**/api/auth/bootstrap-status", async (route) => {
    const response = await route.fetch()
    const payload = await response.json()
    await route.fulfill({ json: { ...payload, llm_enabled: false } })
  })
}

test.describe("AI surfaces hidden when LLM is disabled", () => {
  test.beforeEach(async ({ page }) => {
    await disableLlmCapability(page)
  })

  test("omits the Assistant entry from the sidebar", async ({ page }) => {
    await page.goto("/")
    const sidebar = page.locator("aside")
    await expect(sidebar).toBeVisible()
    await expect(sidebar.getByRole("link", { name: "Transactions" })).toBeVisible()
    await expect(sidebar.getByRole("link", { name: "Assistant" })).toHaveCount(0)
  })

  test("redirects the assistant route to the dashboard", async ({ page }) => {
    await page.goto("/assistant")
    await expect(page).toHaveURL("/")
    await expect(page.locator("main h1")).toContainText("Dashboard")
  })

  test("keeps plain transaction search without smart-search controls", async ({ page }) => {
    await page.goto("/transactions")
    await expect(page.locator("main h1")).toContainText("Transactions")
    await page.getByRole("button", { name: "Search transactions" }).click()
    await expect(
      page.getByPlaceholder("Search titles and descriptions…"),
    ).toBeVisible()
    await expect(page.getByRole("button", { name: "Run smart search" })).toHaveCount(0)
  })

  test("hides the rule suggestions card on the rules page", async ({ page }) => {
    await page.goto("/rules")
    await expect(page.locator("main h1")).toContainText("Categorization Rules")
    await expect(page.getByRole("button", { name: "Mine rules" })).toHaveCount(0)
  })
})
