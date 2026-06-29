import { expect, test, type Page } from "@playwright/test"

const STREAM_URL = "**/api/ai/spending-chat/stream"
const HISTORY_MARKER = "SECRET_HISTORY_DO_NOT_SHOW"

type StreamEvent = Record<string, unknown>

function ndjson(events: StreamEvent[]): string {
  return events.map((event) => JSON.stringify(event)).join("\n") + "\n"
}

function happyTurn(assistantMessage: string): string {
  return ndjson([
    { type: "turn_started", turn_id: "turn-1" },
    {
      type: "tool_call_start",
      tool_call_id: "call-1",
      tool_name: "get_spending_overview",
      arguments: { start: "2026-05-01", end: "2026-05-31" },
    },
    {
      type: "tool_call_end",
      tool_call_id: "call-1",
      tool_name: "get_spending_overview",
      result_preview: "display only",
      success: true,
    },
    { type: "text_chunk", content: assistantMessage },
    { type: "text_commit" },
    {
      type: "result",
      assistant_message: assistantMessage,
      message_history: [{ kind: "response", note: HISTORY_MARKER }],
    },
    { type: "done" },
  ])
}

async function sendQuestion(page: Page, text: string) {
  const input = page.getByTestId("spending-assistant-input")
  await input.click()
  await input.fill(text)
  await page.getByTestId("spending-assistant-send").click()
}

test.describe("Spending Assistant (mobile)", () => {
  test("hides the add FAB and docks the composer on the assistant route", async ({
    page,
  }) => {
    await page.goto("/assistant")
    await expect(page.locator("main h1")).toContainText("Assistant")
    await expect(page.getByTestId("spending-assistant-composer")).toBeVisible()
    await expect(page.getByTestId("spending-assistant-input")).toBeVisible()
    await expect(page.getByTestId("app-shell-mobile-add-fab")).toHaveCount(0)

    // The FAB is route-specific: it must return on other mobile pages.
    await page.goto("/transactions")
    await expect(page.getByTestId("app-shell-mobile-add-fab")).toBeVisible()
  })

  test("streams an answer without horizontal overflow", async ({ page }) => {
    await page.route(STREAM_URL, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: happyTurn("You spent **€1,234.00** last month."),
      })
    })

    await page.goto("/assistant")
    await sendQuestion(page, "How much did I spend last month?")

    const assistantMessage = page
      .locator('[data-testid="spending-assistant-message"][data-role="assistant"]')
      .last()
    await expect(assistantMessage).toContainText("You spent €1,234.00 last month.")
    await expect(page.getByTestId("spending-assistant-tool")).toContainText(
      "Spending overview"
    )
    await expect(page.locator("body")).not.toContainText(HISTORY_MARKER)

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
    )
    expect(overflow).toBeLessThanOrEqual(1)
  })
})
