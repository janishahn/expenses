import { expect, test, type Locator, type Page } from "./fixtures"

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

const thread = (page: Page) => page.getByRole("log", { name: "Conversation" })
const assistantTurns = (page: Page) => page.getByRole("article", { name: "Assistant" })
const userTurns = (page: Page) => page.getByRole("article", { name: "You" })
const composer = (page: Page) =>
  page.getByRole("textbox", { name: "Message the spending assistant" })

async function sendQuestion(page: Page, text: string) {
  const input = composer(page)
  await input.click()
  await input.fill(text)
  await page.getByRole("button", { name: "Send" }).click()
}

const offsetInThread = (turn: Locator) =>
  turn.evaluate(
    (element) =>
      element.getBoundingClientRect().top -
      element.closest('[role="log"]')!.getBoundingClientRect().top
  )

test.describe("Spending Assistant (mobile)", () => {
  test("docks the composer above the tab bar and hides the tab bar while typing", async ({
    page,
  }) => {
    await page.goto("/assistant")
    await expect(page.locator("main h1")).toHaveText("Assistant")
    await expect(
      page.getByRole("heading", { name: "Ask about your spending" })
    ).toBeVisible()
    await expect(composer(page)).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Add transaction" })
    ).toHaveCount(0)

    // The composer docks just above the tab bar.
    const tabs = page.getByRole("navigation", { name: "Tabs" })
    const composerBounds = await page
      .locator("form")
      .filter({ has: composer(page) })
      .boundingBox()
    const tabBarBounds = await tabs.boundingBox()
    expect(composerBounds).not.toBeNull()
    expect(tabBarBounds).not.toBeNull()
    if (composerBounds && tabBarBounds) {
      const gap = tabBarBounds.y - (composerBounds.y + composerBounds.height)
      expect(gap).toBeGreaterThanOrEqual(0)
      expect(gap).toBeLessThan(48)
    }

    // Typing gives the bottom edge to the keyboard.
    await composer(page).focus()
    await expect(tabs).toBeHidden()
    await composer(page).blur()
    await expect(tabs).toBeVisible()

    // The page action is route-specific: Add returns on other mobile pages.
    await page.goto("/transactions")
    await expect(
      page.getByRole("button", { name: "Add transaction", exact: true })
    ).toBeVisible()
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

    const assistant = assistantTurns(page).last()
    await expect(assistant).toContainText("You spent €1,234.00 last month.")
    await expect(assistant.getByText("Spending overview", { exact: true })).toBeVisible()
    // Touch layouts keep the copy affordances persistent instead of hover-revealed.
    await expect(
      assistant.getByRole("button", { name: "Copy response" })
    ).toBeVisible()
    await expect(
      userTurns(page).last().getByRole("button", { name: "Copy message" })
    ).toBeVisible()
    await expect(page.locator("body")).not.toContainText(HISTORY_MARKER)
    await expect(page.getByRole("button", { name: "New chat" })).toBeVisible()

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
      (_, index) => `Spending detail ${index + 1}.`
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
    await expect(thread(page).getByText("Spending detail 60.")).toBeAttached()

    await expect
      .poll(() => offsetInThread(userTurns(page).last()))
      .toBeLessThan(48)

    const scrollToLatest = page.getByRole("button", {
      name: "Scroll to latest message",
    })
    await expect(scrollToLatest).toBeVisible()
    await scrollToLatest.click()
    await expect(thread(page).getByText("Spending detail 60.")).toBeInViewport()
  })
})
