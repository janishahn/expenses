import { test } from "./fixtures"
import { aiSettingsJourney } from "./ai-settings-journey"

test("per-feature AI settings persist on desktop", async ({ page }) => {
  await aiSettingsJourney(page)
})
