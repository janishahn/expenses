import { expect, type Page } from "@playwright/test"
import { createTransaction, ensureCategory, loginAsIsolatedUser } from "./helpers"

export async function aiSettingsJourney(page: Page) {
  await page.goto("/settings")
  const { request, csrfToken } = await loginAsIsolatedUser(page)
  try {
    const expense = await ensureCategory(request, csrfToken, "expense", "Assistant expenses")
    const income = await ensureCategory(request, csrfToken, "income", "Assistant income")
    for (const [date, type, amount, category, title] of [
      ["2026-05-03", "expense", 1234, expense, "Assistant groceries"],
      ["2026-05-20", "expense", 567, expense, "Assistant coffee"],
      ["2026-05-01", "income", 25000, income, "Assistant salary"],
      ["2026-06-01", "expense", 99999, expense, "Outside the requested month"],
    ] as const) {
      await createTransaction(request, csrfToken, {
        date,
        occurred_at: `${date}T12:00:00`,
        type,
        amount_cents: amount,
        category_id: category,
        title,
        tags: [],
      })
    }
  } finally {
    await request.dispose()
  }
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
  // Exercise FastAPI's real stream, model adapter, tool execution and database.
  // The provider fixture only asks for a tool and formats its returned amount.
  await page.getByTestId("spending-assistant-input").fill("How much did I spend in May 2026?")
  await page.getByTestId("spending-assistant-send").click()
  await expect(
    page.locator('[data-testid="spending-assistant-message"][data-role="assistant"]').last()
  ).toContainText("Your May 2026 spending was €18.01.")
  const tool = page.getByTestId("spending-assistant-tool")
  await expect(tool).toContainText("Spending overview")
  await expect(tool).toContainText("2026-05-01 to 2026-05-31")
  await expect(tool).toHaveAttribute("data-status", "success")
  await tool.locator("summary").click()
  await expect(page.getByTestId("spending-assistant-tool-summary")).toHaveText(
    "€18.01 spent · €250.00 income"
  )
  await expect(page.getByTestId("spending-assistant-error")).toHaveCount(0)

  // The read-only Assistant leaves the persisted ledger intact.
  await page.goto("/transactions?period=custom&start=2026-05-01&end=2026-05-31")
  const rows = page.locator('[data-testid^="transaction-row-"]')
  await expect(rows).toHaveCount(3)
  await expect(rows.filter({ hasText: "Assistant groceries" })).toContainText("-12,34 €")
  await expect(rows.filter({ hasText: "Assistant coffee" })).toContainText("-5,67 €")
  await expect(rows.filter({ hasText: "Assistant salary" })).toContainText("250,00 €")
  await page.goto("/settings")
  await settings.getByRole("button", { name: "Disconnect", exact: true }).click()
  await page
    .getByRole("dialog", { name: "Disconnect ChatGPT?" })
    .getByRole("button", { name: "Disconnect", exact: true })
    .click()
  await expect(settings.getByText("ChatGPT disconnected.", { exact: true })).toBeVisible()
  await expect(settings.getByRole("button", { name: "Continue with ChatGPT" })).toBeVisible()
}
