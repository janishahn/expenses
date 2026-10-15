import { expect, type Page } from "@playwright/test"
import { ensureElevatedAdmin } from "./auth-helpers"

type StoredFeature = { id: string; enabled: boolean; backend: string; model: string; thinking: string }

async function storedFeatures(page: Page): Promise<StoredFeature[]> {
  return (await (await page.request.get("/api/admin/ai/settings")).json()).features
}

// The worker fixture turns every feature on with the stub "local" backend and e2e-large.
export async function aiSettingsJourney(page: Page) {
  await ensureElevatedAdmin(page)
  await page.goto("/admin/ai")
  const features = page.getByRole("list", { name: "AI features" })
  const assistant = features.getByRole("listitem", { name: "Assistant", exact: true })
  const triage = features.getByRole("listitem", { name: "Categorization suggestions", exact: true })

  await expect(assistant.getByLabel("Backend", { exact: true })).toHaveValue("local")
  await expect(assistant.getByLabel("Model", { exact: true }).locator('option[value="e2e-small"]')).toHaveCount(1)
  await assistant.getByLabel("Model", { exact: true }).selectOption("e2e-small")
  await expect(assistant.getByLabel("Thinking")).toBeEnabled()
  await assistant.getByLabel("Thinking").selectOption("high")
  await expect(triage.getByRole("switch")).toBeEnabled()
  await triage.getByRole("switch").click()
  await expect
    .poll(async () => (await storedFeatures(page)).map((f) => `${f.id}:${f.enabled}:${f.model}:${f.thinking}`))
    .toEqual(["spending_chat:true:e2e-small:high", "transaction_triage:false:e2e-large:auto", "rule_mining:true:e2e-large:auto"])

  await page.reload()
  await expect(assistant.getByLabel("Model", { exact: true })).toHaveValue("e2e-small")
  await expect(assistant.getByLabel("Thinking")).toHaveValue("high")
  await expect(triage.getByRole("switch")).not.toBeChecked()

  // A model the backend does not list can still be typed in.
  await assistant.getByLabel("Model", { exact: true }).selectOption({ label: "Enter model ID…" })
  await assistant.getByLabel("Model ID", { exact: true }).fill("custom-model")
  await assistant.getByLabel("Model ID", { exact: true }).press("Enter")
  await expect
    .poll(async () => (await storedFeatures(page)).find((f) => f.id === "spending_chat")?.model)
    .toBe("custom-model")
  await page.reload()
  await expect(assistant.getByLabel("Model ID", { exact: true })).toHaveValue("custom-model")

  // Turning the Assistant off removes it from the navigation.
  await assistant.getByRole("switch").click()
  await expect
    .poll(async () => (await storedFeatures(page)).find((f) => f.id === "spending_chat")?.enabled)
    .toBe(false)
  await page.goto("/assistant")
  await expect(page).toHaveURL("/")

  await page.goto("/admin/ai")
  await assistant.getByLabel("Model", { exact: true }).selectOption("e2e-large")
  await expect(assistant.getByLabel("Thinking")).toBeEnabled()
  await assistant.getByLabel("Thinking").selectOption("auto")
  await expect(assistant.getByLabel("Thinking")).toBeEnabled()
  await assistant.getByRole("switch").click()
  await expect(triage.getByRole("switch")).toBeEnabled()
  await triage.getByRole("switch").click()
  await expect
    .poll(async () => (await storedFeatures(page)).every((f) => f.enabled && f.model === "e2e-large" && f.thinking === "auto"))
    .toBe(true)
  await page.goto("/assistant")
  await expect(page).toHaveURL("/assistant")
}
