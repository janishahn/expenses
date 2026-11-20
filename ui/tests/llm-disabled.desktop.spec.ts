import { test, expect, type Page } from "./fixtures"

async function disableLlmCapability(page: Page) {
  await page.route("**/api/auth/bootstrap-status", async (route) => {
    const response = await route.fetch()
    const payload = await response.json()
    await route.fulfill({ json: { ...payload, ai_features: [] } })
  })
}

test("hides AI surfaces and blocks the Assistant route when LLM is disabled", async ({ page }) => {
  await disableLlmCapability(page)

  await page.goto("/")
  const sidebar = page.getByRole("complementary", {
    name: "Application navigation",
  })
  await expect(sidebar.getByRole("link", { name: "Transactions" })).toBeVisible()
  await expect(sidebar.getByRole("link", { name: "Assistant" })).toHaveCount(0)

  await page.goto("/assistant")
  await expect(page).toHaveURL("/")
  await expect(page.locator("main h1")).toContainText("Dashboard")

  // Plain search still filters the ledger, without the smart-search control.
  await page.goto("/transactions")
  await expect(page.locator("main h1")).toContainText("Transactions")
  await page.getByRole("button", { name: "Search", exact: true }).click()
  await page.getByRole("searchbox", { name: "Search transactions" }).fill("coffee")
  await expect(page).toHaveURL(/q=coffee/)
  await expect(page.getByRole("button", { name: "Run smart search" })).toHaveCount(0)

  await page.goto("/rules")
  await expect(page.getByRole("button", { name: "Add rule" }).first()).toBeVisible()
  await expect(page.getByRole("button", { name: "More actions" })).toHaveCount(0)
})
