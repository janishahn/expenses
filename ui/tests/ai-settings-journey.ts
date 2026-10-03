import { expect, type Page } from "@playwright/test"

export async function aiSettingsJourney(page: Page) {
  await page.goto("/settings")
  const settings = page.getByTestId("ai-settings")
  await expect(settings.getByRole("heading", { name: "AI settings" })).toBeVisible()
  await settings.getByRole("button", { name: "Continue with ChatGPT" }).click()
  const pairing = settings.getByTestId("chatgpt-pairing")
  await expect(pairing).toBeVisible()
  const code = await pairing.getByLabel("ChatGPT pairing code").innerText()
  const headers = { "X-ChatGPT-Pairing": code }
  // Stand in for the local connection helper; only OpenAI's external responses
  // are mocked in the worker. Pairing and storage use the real Expenses API.
  const start = await page.request.post("/api/ai/chatgpt/pairing/start", {
    headers,
    data: { port: 1455 },
  })
  expect(start.ok()).toBeTruthy()
  const complete = await page.request.post("/api/ai/chatgpt/pairing/complete", {
    headers,
    data: {
      client_id: "e2e-client",
      access_token: "e2e-access-token",
      refresh_token: "e2e-refresh-token",
      id_token: "e2e-id-token",
      scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
      expires_in: 3600,
    },
  })
  expect(complete.ok()).toBeTruthy()
  await pairing.getByRole("button", { name: "I’ve finished connecting" }).click()
  await expect(
    settings.getByText("Connected as test@example.com.", { exact: true })
  ).toBeVisible()
  for (const [feature, model, thinking] of [
    ["Categorization", "gpt-6-luna", "low"],
    ["Rule suggestions", "gpt-6-luna", "low"],
    ["Spending analysis", "gpt-6.1-sol", "high"],
  ]) {
    const row = settings.getByRole("group", { name: feature, exact: true })
    await row.getByLabel("Provider", { exact: true }).selectOption("chatgpt")
    await expect(
      row.getByLabel("Model", { exact: true }).locator(`option[value="${model}"]`)
    ).toHaveCount(1)
    await row.getByLabel("Model", { exact: true }).selectOption(model)
    await row.getByLabel("Thinking level").selectOption(thinking)
  }
  await settings.getByRole("button", { name: "Save AI settings" }).click()
  await expect(settings.getByText("AI settings saved.", { exact: true })).toBeVisible()
  await page.reload()
  await expect(
    settings
      .getByRole("group", { name: "Categorization", exact: true })
      .getByLabel("Model", { exact: true })
  ).toHaveValue("gpt-6-luna")
  await expect(
    settings
      .getByRole("group", { name: "Spending analysis", exact: true })
      .getByLabel("Thinking level")
  ).toHaveValue("high")
  const spending = settings.getByRole("group", { name: "Spending analysis", exact: true })
  await spending.getByLabel("Model", { exact: true }).selectOption({ label: "Enter model ID…" })
  await spending.getByLabel("Model ID", { exact: true }).fill("custom-model")
  await spending.getByLabel("Thinking level").selectOption("low")
  await settings.getByRole("button", { name: "Save AI settings" }).click()
  await expect(settings.getByText("AI settings saved.", { exact: true })).toBeVisible()
  await page.reload()
  await expect(spending.getByLabel("Model ID", { exact: true })).toHaveValue("custom-model")
  await expect(spending.getByLabel("Thinking level")).toHaveValue("low")

  const saved = (await (await page.request.get("/api/ai/settings")).json()).features
  await spending.getByLabel("Model ID", { exact: true }).fill("unavailable-model")
  await spending.getByLabel("Thinking level").selectOption("high")
  await settings.getByRole("button", { name: "Save AI settings" }).click()
  await expect(settings.getByText(/Could not validate model 'unavailable-model'/)).toBeVisible()
  expect((await (await page.request.get("/api/ai/settings")).json()).features).toEqual(saved)
  await expect(spending.getByLabel("Model ID", { exact: true })).toHaveValue("unavailable-model")
  await spending.getByLabel("Model ID", { exact: true }).fill("custom-model")
  await settings.getByRole("button", { name: "Save AI settings" }).click()
  await expect(settings.getByText("AI settings saved.", { exact: true })).toBeVisible()
  await page.goto("/assistant")
  await expect(page.getByText("Using ChatGPT plan", { exact: false })).toBeVisible()
  await expect(page.getByRole("link", { name: "Manage usage" })).toHaveAttribute(
    "href",
    "https://chatgpt.com/settings/usage"
  )
  await page.goto("/settings")
  await settings.getByRole("button", { name: "Disconnect", exact: true }).click()
  await page
    .getByRole("dialog", { name: "Disconnect ChatGPT?" })
    .getByRole("button", { name: "Disconnect", exact: true })
    .click()
  await expect(settings.getByText("ChatGPT disconnected.", { exact: true })).toBeVisible()
  await expect(settings.getByRole("button", { name: "Continue with ChatGPT" })).toBeVisible()
}
