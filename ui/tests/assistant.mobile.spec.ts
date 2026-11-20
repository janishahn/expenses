import { expect, test } from "./fixtures"
import { assistantTurns, composer, sendQuestion, unique } from "./assistant-journeys"

test.describe("Assistant (mobile)", () => {
  test("docks the composer above the tab bar and hides the tab bar while typing", async ({ page }) => {
    await page.goto("/assistant")
    await expect(page.locator("main h1")).toHaveText("Assistant")
    await expect(composer(page)).toBeVisible()
    await expect(page.getByRole("button", { name: "Add transaction" })).toHaveCount(0)

    // The composer docks just above the tab bar.
    const tabs = page.getByRole("navigation", { name: "Tabs" })
    const composerBounds = await page.locator("form").filter({ has: composer(page) }).boundingBox()
    const tabBarBounds = await tabs.boundingBox()
    expect(composerBounds).not.toBeNull()
    expect(tabBarBounds).not.toBeNull()
    if (composerBounds && tabBarBounds) {
      const gap = tabBarBounds.y - (composerBounds.y + composerBounds.height)
      expect(gap).toBeGreaterThanOrEqual(0)
      expect(gap).toBeLessThan(48)
    }

    // Typing gives the bottom edge to the keyboard.
    await composer(page).focus()
    await expect(tabs).toBeHidden()
    await composer(page).blur()
    await expect(tabs).toBeVisible()

    // The page action is route-specific: Add returns on other mobile pages.
    await page.goto("/transactions")
    await expect(page.getByRole("button", { name: "Add transaction", exact: true })).toBeVisible()
  })

  test("fits a long change card to the phone width, lists every row, applies it, and opens the linked transaction", async ({ page }) => {
    await page.goto("/assistant")
    await sendQuestion(page, unique("Add ten lunches for 12,50"))

    const card = assistantTurns(page).last().getByRole("region", { name: "Add 10 transactions" })
    await expect(card.getByText("Lunch", { exact: true })).toHaveCount(8)
    await card.getByRole("button", { name: "Show 2 more" }).click()
    await expect(card.getByText("Lunch", { exact: true })).toHaveCount(10)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)

    await card.getByRole("button", { name: "Add" }).click()
    await expect(card).toContainText("Added")
    await expect(assistantTurns(page).last()).toContainText("Added Lunch.")

    // The peek replaces the conversation, and its back button returns to it.
    await assistantTurns(page).last().getByRole("link", { name: "Lunch" }).click()
    const peek = page.getByRole("complementary", { name: "Lunch" })
    await expect(peek).toContainText("12,50")
    await expect(composer(page)).toBeHidden()
    await peek.getByRole("button", { name: "Assistant" }).click()
    await expect(peek).toHaveCount(0)
    await expect(composer(page)).toBeVisible()
  })
})
