import { expect, test, type Page } from "./fixtures"

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
      result_summary: "€1,234.00 spent · €2,000.00 income",
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
  test("hides mobile Add and docks the composer on the assistant route", async ({
    page,
  }) => {
    await page.goto("/assistant")
    await expect(
      page
        .getByTestId("app-shell-header")
        .getByRole("heading", { name: "Assistant", level: 1 })
    ).toBeVisible()
    await expect(page.locator("main h1")).toHaveCount(0)
    const composer = page.getByTestId("spending-assistant-composer")
    await expect(page.getByText(/Read-only.*inspect your ledger/)).toHaveCount(0)
    await expect(composer).toBeVisible()
    await expect(page.getByTestId("spending-assistant-input")).toBeVisible()
    await expect(page.getByTestId("app-shell-mobile-add-action")).toHaveCount(0)

    const composerBounds = await composer.boundingBox()
    const viewport = page.viewportSize()
    expect(composerBounds).not.toBeNull()
    expect(viewport).not.toBeNull()
    if (composerBounds && viewport) {
      expect(viewport.height - (composerBounds.y + composerBounds.height)).toBeLessThan(48)
    }

    // The dock action is route-specific: it must return on other mobile pages.
    await page.goto("/transactions")
    await expect(page.getByTestId("app-shell-mobile-add-action")).toBeVisible()
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
    // Touch layouts keep the copy affordances persistent instead of hover-revealed.
    await expect(page.getByTestId("spending-assistant-copy")).toBeVisible()
    await expect(page.getByTestId("spending-assistant-copy-user")).toBeVisible()
    await expect(page.locator("body")).not.toContainText(HISTORY_MARKER)
    await expect(
      page
        .getByTestId("app-shell-header")
        .getByRole("button", { name: "New chat" })
    ).toBeVisible()

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
    )
    expect(overflow).toBeLessThanOrEqual(1)
  })

  test("pins the sent question to the top and offers a return to the newest content", async ({
    page,
  }) => {
    const longAnswer = Array.from(
      { length: 60 },
      (_, index) => `Spending detail ${index + 1}.`,
    ).join("\n\n")
    await page.route(STREAM_URL, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: happyTurn(longAnswer),
      })
    })

    await page.goto("/assistant")
    await sendQuestion(page, "Show me the full breakdown")
    await expect(page.getByTestId("spending-assistant-thread").getByText("Spending detail 60.")).toBeAttached()

    await expect
      .poll(() =>
        page
          .locator(
            '[data-testid="spending-assistant-message"][data-role="user"]',
          )
          .last()
          .evaluate(
            (element) =>
              element.getBoundingClientRect().top -
              element
                .closest('[data-testid="spending-assistant-thread"]')!
                .getBoundingClientRect().top,
          ),
      )
      .toBeLessThan(48)

    const scrollToLatest = page.getByTestId("spending-assistant-scroll-bottom")
    await expect(scrollToLatest).toBeVisible()
    await scrollToLatest.click()
    await expect(page.getByTestId("spending-assistant-thread").getByText("Spending detail 60.")).toBeInViewport()
  })
})
