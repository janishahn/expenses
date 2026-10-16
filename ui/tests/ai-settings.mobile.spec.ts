import { expect, test } from "./fixtures"
import { aiSettingsJourney } from "./ai-settings-journey"

test("per-feature AI settings persist on mobile", async ({ page }) => {
  await aiSettingsJourney(page)
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  ).toBeTruthy()
})
