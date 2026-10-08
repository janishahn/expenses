import { test } from "./fixtures"
import { aiSettingsJourney } from "./ai-settings-journey"

test.use({ mockAIProvider: true })
test("ChatGPT settings persist and power ledger-backed Assistant answers on desktop", async ({ page }) => {
  await aiSettingsJourney(page)
})
