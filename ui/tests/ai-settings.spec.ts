import { test } from "./fixtures"
import { aiSettingsJourney } from "./ai-settings-journey"

test.use({ mockAIProvider: true })
test("ChatGPT pairing and per-feature model settings persist on desktop", async ({ page }) => {
  await aiSettingsJourney(page)
})
