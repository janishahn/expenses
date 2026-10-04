import { expect, test } from "./fixtures"
import { aiSettingsJourney } from "./ai-settings-journey"

test.use({ mockAIProvider: true })
test("ChatGPT settings persist and power ledger-backed Assistant answers on mobile", async ({ page }) => {
  await aiSettingsJourney(page)
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  ).toBeTruthy()
})
