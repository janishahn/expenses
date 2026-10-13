import { expect, type Page } from "@playwright/test"

type StoredFeature = { id: string; model: string; reasoning_effort: string }

async function storedFeatures(page: Page): Promise<StoredFeature[]> {
  return (await (await page.request.get("/api/ai/settings")).json()).features
}

export async function aiSettingsJourney(page: Page) {
  await page.goto("/settings/ai")
  const connection = page.getByRole("region", { name: "ChatGPT" })
  const features = page.getByRole("list", { name: "AI features" })
  await expect(connection.getByRole("status")).toHaveText("Not connected")

  await connection.getByRole("button", { name: "Continue with ChatGPT" }).click()
  const code = await connection.getByLabel("ChatGPT pairing code").inputValue()
  await expect(connection.getByLabel("Connection command")).toHaveValue(/connect-chatgpt --server /)
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
  await connection.getByRole("button", { name: "I’ve finished connecting" }).click()
  await expect(connection.getByRole("status")).toHaveText("Connected as test@example.com")

  // Every change saves at once; the select stays disabled until the save finishes.
  for (const [feature, model, thinking] of [
    ["Categorization", "gpt-6-luna", "low"],
    ["Rule suggestions", "gpt-6-luna", "low"],
    ["Spending analysis", "gpt-6.1-sol", "high"],
  ]) {
    const row = features.getByRole("listitem", { name: feature, exact: true })
    await row.getByLabel("Provider", { exact: true }).selectOption("chatgpt")
    await expect(
      row.getByLabel("Model", { exact: true }).locator(`option[value="${model}"]`)
    ).toHaveCount(1)
    await row.getByLabel("Model", { exact: true }).selectOption(model)
    await row.getByLabel("Thinking level").selectOption(thinking)
    await expect(row.getByLabel("Thinking level")).toBeEnabled()
  }
  await expect
    .poll(async () =>
      (await storedFeatures(page)).map((f) => [f.id, f.model, f.reasoning_effort].join(":"))
    )
    .toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^spending_chat:gpt-6\.1-sol:high$/),
        expect.stringMatching(/:gpt-6-luna:low$/),
      ])
    )

  await page.reload()
  const categorization = features.getByRole("listitem", { name: "Categorization", exact: true })
  const spending = features.getByRole("listitem", { name: "Spending analysis", exact: true })
  await expect(categorization.getByLabel("Provider", { exact: true })).toHaveValue("chatgpt")
  await expect(categorization.getByLabel("Model", { exact: true })).toHaveValue("gpt-6-luna")
  await expect(spending.getByLabel("Thinking level")).toHaveValue("high")

  // A model ID that is not in the list is checked by the server before it is stored.
  await spending.getByLabel("Model", { exact: true }).selectOption({ label: "Enter model ID…" })
  await spending.getByLabel("Model ID", { exact: true }).fill("custom-model")
  await spending.getByLabel("Thinking level").selectOption("low")
  await expect
    .poll(async () => (await storedFeatures(page)).find((f) => f.id === "spending_chat")?.model)
    .toBe("custom-model")
  await page.reload()
  await expect(spending.getByLabel("Model ID", { exact: true })).toHaveValue("custom-model")
  await expect(spending.getByLabel("Thinking level")).toHaveValue("low")

  const saved = await storedFeatures(page)
  await spending.getByLabel("Model ID", { exact: true }).fill("unavailable-model")
  await spending.getByLabel("Thinking level").selectOption("high")
  await expect(page.getByRole("alert")).toContainText("Could not validate model 'unavailable-model'")
  expect(await storedFeatures(page)).toEqual(saved)
  await expect(spending.getByLabel("Model ID", { exact: true })).toHaveValue("unavailable-model")

  await spending.getByLabel("Model ID", { exact: true }).fill("custom-model")
  await spending.getByLabel("Model ID", { exact: true }).press("Enter")
  await expect(page.getByRole("alert")).toHaveCount(0)
  await expect
    .poll(async () => {
      const stored = (await storedFeatures(page)).find((f) => f.id === "spending_chat")
      return `${stored?.model}:${stored?.reasoning_effort}`
    })
    .toBe("custom-model:high")

  await page.goto("/assistant")
  await expect(page.getByRole("link", { name: "ChatGPT plan" })).toHaveAttribute(
    "href",
    "https://chatgpt.com/settings/usage"
  )

  await page.goto("/settings/ai")
  await connection.getByRole("button", { name: "Disconnect", exact: true }).click()
  await page
    .getByRole("dialog", { name: "Disconnect ChatGPT?" })
    .getByRole("button", { name: "Disconnect", exact: true })
    .click()
  await expect(page.getByRole("status").filter({ hasText: "ChatGPT disconnected." })).toBeVisible()
  await expect(connection.getByRole("status")).toHaveText("Not connected")
  await expect(connection.getByRole("button", { name: "Continue with ChatGPT" })).toBeVisible()
}
