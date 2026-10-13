import { expect, test, type Locator, type Page } from "./fixtures"

// Browser-side hook installed by installStreamHook to drive a real, chunk-by-chunk
// streaming Response so tests can prove progressive rendering (route.fulfill sends
// a complete body and cannot).
declare global {
  interface Window {
    __assistantStreamHook?: {
      ready: boolean
      emit: (line: string) => void
      close: () => void
    }
  }
}

const STREAM_URL = "**/api/ai/spending-chat/stream"

// Markers that the backend may emit but that must never reach the DOM:
// tool result previews are display-only and message_history is opaque state.
const TOOL_PREVIEW_MARKER = "SECRET_TOOL_PREVIEW_DO_NOT_SHOW"
const HISTORY_MARKER = "SECRET_HISTORY_DO_NOT_SHOW"

type StreamEvent = Record<string, unknown>

function ndjson(events: StreamEvent[]): string {
  return events.map((event) => JSON.stringify(event)).join("\n") + "\n"
}

function happyTurn(
  assistantMessage: string,
  history: StreamEvent[]
): string {
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
      result_preview: `${TOOL_PREVIEW_MARKER} {"expense_cents": 123400}`,
      result_summary: "€1,234.00 spent · €2,000.00 income",
      success: true,
    },
    { type: "text_chunk", content: assistantMessage },
    { type: "text_commit" },
    {
      type: "result",
      assistant_message: assistantMessage,
      message_history: history,
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

// Distance from the top of the conversation log to the top of an article.
const offsetInThread = (turn: Locator) =>
  turn.evaluate(
    (element) =>
      element.getBoundingClientRect().top -
      element.closest('[role="log"]')!.getBoundingClientRect().top
  )

// Replace fetch for the stream endpoint with a ReadableStream the test feeds one
// line at a time. Other requests (CSRF, app data) fall through to the real fetch.
async function installStreamHook(page: Page) {
  await page.addInitScript(() => {
    const STREAM_PATH = "/api/ai/spending-chat/stream"
    const realFetch = window.fetch.bind(window)
    const encoder = new TextEncoder()
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null
    window.__assistantStreamHook = {
      ready: false,
      emit(line: string) {
        controllerRef?.enqueue(encoder.encode(line))
      },
      close() {
        controllerRef?.close()
        controllerRef = null
      },
    }
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url
      if (!url.includes(STREAM_PATH)) {
        return realFetch(input, init)
      }
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controllerRef = controller
          if (window.__assistantStreamHook) {
            window.__assistantStreamHook.ready = true
          }
        },
        cancel() {
          controllerRef = null
        },
      })
      return Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { "Content-Type": "application/x-ndjson" },
        })
      )
    }
  })
}

async function emitEvent(page: Page, event: StreamEvent) {
  const line = JSON.stringify(event) + "\n"
  await page.evaluate(
    (value) => window.__assistantStreamHook?.emit(value),
    line
  )
}

test.describe("Spending Assistant", () => {
  test("streams an answer, lists tool activity, and never reveals raw tool or history data", async ({
    page,
  }) => {
    await page.route(STREAM_URL, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: happyTurn("You spent **€1,234.00** last month.", [
          { kind: "response", note: HISTORY_MARKER },
        ]),
      })
    })

    await page.goto("/assistant")
    await expect(
      page.getByRole("heading", { name: "Assistant", level: 1 })
    ).toBeVisible()
    await expect(
      page.getByRole("heading", { name: "Ask about your spending" })
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "How much did I spend last month?" })
    ).toBeVisible()
    await expect(page.getByRole("button", { name: "New chat" })).toHaveCount(0)

    await sendQuestion(page, "How much did I spend last month?")

    await expect(userTurns(page).last()).toContainText(
      "How much did I spend last month?"
    )
    await expect(assistantTurns(page).last()).toContainText(
      "You spent €1,234.00 last month."
    )
    await expect(
      page.getByRole("heading", { name: "Ask about your spending" })
    ).toHaveCount(0)

    // One tool collapses to its label; opening it lists the call and its summary.
    const assistant = assistantTurns(page).last()
    const toolSummary = assistant.getByText("Spending overview", { exact: true })
    await expect(toolSummary).toBeVisible()
    await expect(assistant.getByRole("img", { name: "Done" })).toBeHidden()
    await toolSummary.click()
    await expect(assistant.getByRole("img", { name: "Done" })).toBeVisible()
    await expect(assistant).toContainText("1 – 31 May 2026")
    await expect(assistant).toContainText("€1,234.00 spent · €2,000.00 income")

    // The bold markdown must render as emphasis, not literal asterisks.
    await expect(assistant.locator("strong")).toHaveText("€1,234.00")

    await expect(page.locator("body")).not.toContainText(TOOL_PREVIEW_MARKER)
    await expect(page.locator("body")).not.toContainText(HISTORY_MARKER)

    // Finished answers offer copy; the copied markdown is the source text.
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"])
    await assistant.hover()
    await assistant.getByRole("button", { name: "Copy response" }).click()
    await expect(
      assistant.getByRole("button", { name: "Copied" })
    ).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      "You spent **€1,234.00** last month."
    )

    // The sent question offers the same copy affordance.
    const question = userTurns(page).last()
    await question.hover()
    await question.getByRole("button", { name: "Copy message" }).click()
    await expect(question.getByRole("button", { name: "Copied" })).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      "How much did I spend last month?"
    )

    const newChat = page.getByRole("button", { name: "New chat" })
    await expect(newChat).toBeVisible()
    await newChat.click()
    await expect(userTurns(page)).toHaveCount(0)
    await expect(
      page.getByRole("button", { name: "How much did I spend last month?" })
    ).toBeVisible()
    await expect(newChat).toHaveCount(0)
    await expect(composer(page)).toBeFocused()
  })

  test("an empty-state prompt sends immediately", async ({ page }) => {
    await page.route(STREAM_URL, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: happyTurn("Housing led your spending.", []),
      })
    })

    await page.goto("/assistant")
    await page
      .getByRole("button", {
        name: "What were my top spending categories this month?",
      })
      .click()

    await expect(userTurns(page).last()).toContainText(
      "What were my top spending categories this month?"
    )
    await expect(assistantTurns(page).last()).toContainText(
      "Housing led your spending."
    )
  })

  test("shows query and type details in transaction search activity", async ({
    page,
  }) => {
    await page.route(STREAM_URL, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: ndjson([
          { type: "turn_started", turn_id: "turn-1" },
          {
            type: "tool_call_start",
            tool_call_id: "call-1",
            tool_name: "search_transactions",
            arguments: { query: "coffee", transaction_type: "expense" },
          },
          {
            type: "tool_call_end",
            tool_call_id: "call-1",
            tool_name: "search_transactions",
            result_preview: "display only",
            success: true,
          },
          {
            type: "result",
            assistant_message: "Coffee spending was concentrated this week.",
            message_history: [],
          },
          { type: "done" },
        ]),
      })
    })

    await page.goto("/assistant")
    await sendQuestion(page, "Find coffee expenses")

    const assistant = assistantTurns(page).last()
    await assistant.getByText("Transaction search", { exact: true }).click()
    await expect(assistant).toContainText("coffee · expense")
  })

  test("summarises several tool calls and flags a failed one", async ({
    page,
  }) => {
    await page.route(STREAM_URL, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: ndjson([
          { type: "turn_started", turn_id: "turn-1" },
          {
            type: "tool_call_start",
            tool_call_id: "call-1",
            tool_name: "get_budget_context",
            arguments: {},
          },
          {
            type: "tool_call_end",
            tool_call_id: "call-1",
            tool_name: "get_budget_context",
            result_preview: "display only",
            success: true,
          },
          {
            type: "tool_call_start",
            tool_call_id: "call-2",
            tool_name: "get_transaction_detail",
            arguments: { transaction_id: 7 },
          },
          {
            type: "tool_call_end",
            tool_call_id: "call-2",
            tool_name: "get_transaction_detail",
            result_preview: "display only",
            success: false,
          },
          { type: "text_chunk", content: "Partial answer." },
          {
            type: "result",
            assistant_message: "Partial answer.",
            message_history: [],
          },
          { type: "done" },
        ]),
      })
    })

    await page.goto("/assistant")
    await sendQuestion(page, "Check my budgets")

    const assistant = assistantTurns(page).last()
    await expect(assistant).toContainText("Partial answer.")
    await assistant
      .getByText("Transaction detail failed", { exact: true })
      .click()
    await expect(assistant.getByRole("img", { name: "Done" })).toBeVisible()
    await expect(assistant.getByRole("img", { name: "Failed" })).toBeVisible()
    await expect(assistant).toContainText("transaction 7")
  })

  test("reuses prior message_history on the next turn and only sends the latest user message", async ({
    page,
  }) => {
    const firstHistory: StreamEvent[] = [{ kind: "first", note: HISTORY_MARKER }]
    const secondHistory: StreamEvent[] = [{ kind: "second" }]
    const posted: Array<{
      messages: Array<{ role: string; content: string }>
      message_history: unknown
    }> = []
    let call = 0

    await page.route(STREAM_URL, async (route) => {
      posted.push(route.request().postDataJSON())
      const isFirst = call === 0
      call += 1
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: ndjson([
          { type: "turn_started", turn_id: `turn-${call}` },
          {
            type: "result",
            assistant_message: isFirst ? "First answer." : "Second answer.",
            message_history: isFirst ? firstHistory : secondHistory,
          },
          { type: "done" },
        ]),
      })
    })

    await page.goto("/assistant")

    await sendQuestion(page, "First question")
    await expect(thread(page).getByText("First answer.")).toBeVisible()

    await sendQuestion(page, "Second question")
    await expect(thread(page).getByText("Second answer.")).toBeVisible()

    expect(posted).toHaveLength(2)
    expect(posted[0].messages).toEqual([
      { role: "user", content: "First question" },
    ])
    expect(posted[0].message_history).toEqual([])
    expect(posted[1].messages).toEqual([
      { role: "user", content: "Second question" },
    ])
    expect(posted[1].message_history).toEqual(firstHistory)
    await expect(page.locator("body")).not.toContainText(HISTORY_MARKER)
  })

  test("surfaces a 503 configuration error and recovers via Try again", async ({
    page,
  }) => {
    let calls = 0
    await page.route(STREAM_URL, async (route) => {
      calls += 1
      if (calls === 1) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ detail: "LLM is not configured" }),
        })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: happyTurn("Recovered answer.", []),
      })
    })

    await page.goto("/assistant")
    await sendQuestion(page, "Am I over budget anywhere?")

    await expect(assistantTurns(page).last()).toContainText(
      "LLM is not configured"
    )
    await expect(userTurns(page).last()).toContainText(
      "Am I over budget anywhere?"
    )
    await expect(composer(page)).toBeEnabled()
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible()

    // Try again reruns the failed turn without duplicating the question.
    await page.getByRole("button", { name: "Try again" }).click()
    await expect(assistantTurns(page).last()).toContainText("Recovered answer.")
    await expect(page.getByText("LLM is not configured")).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0)
    await expect(userTurns(page)).toHaveCount(1)
  })

  test("stops an in-flight response and offers Try again", async ({ page }) => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route(STREAM_URL, async (route) => {
      await gate
      await route
        .fulfill({
          status: 200,
          contentType: "application/x-ndjson",
          body: ndjson([{ type: "done" }]),
        })
        .catch(() => {})
    })

    await page.goto("/assistant")
    await sendQuestion(page, "Summarize my spending")

    const stopButton = page.getByRole("button", { name: "Stop" })
    await expect(stopButton).toBeVisible()
    await stopButton.click()

    await expect(page.getByRole("button", { name: "Send" })).toBeVisible()
    await expect(stopButton).toHaveCount(0)
    await expect(composer(page)).toBeEnabled()
    await expect(assistantTurns(page).last()).toContainText("Stopped")
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible()

    release()
  })

  test("sends on Enter and inserts a newline on Shift+Enter", async ({
    page,
  }) => {
    await page.route(STREAM_URL, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: happyTurn("Here is your answer.", []),
      })
    })

    await page.goto("/assistant")
    const input = composer(page)
    const send = page.getByRole("button", { name: "Send" })
    await expect(send).toBeDisabled()
    await input.click()
    await input.pressSequentially("first line")
    await expect(send).toBeEnabled()
    await input.press("Shift+Enter")
    await input.pressSequentially("second line")

    expect(await input.inputValue()).toContain("\n")
    await expect(userTurns(page)).toHaveCount(0)

    await input.press("Enter")
    await expect(userTurns(page).last()).toContainText("first line")
    await expect(userTurns(page).last()).toContainText("second line")
    await expect(assistantTurns(page).last()).toContainText(
      "Here is your answer."
    )
    await expect(input).toHaveValue("")
  })

  test("renders tool activity and answer text progressively as the stream arrives", async ({
    page,
  }) => {
    await installStreamHook(page)
    await page.goto("/assistant")
    await sendQuestion(page, "How much did I spend last month?")
    await page.waitForFunction(
      () => window.__assistantStreamHook?.ready === true
    )

    const assistant = assistantTurns(page).last()

    // Before any signal, the progress line idles on "Thinking…"; narration
    // replaces it, and a starting tool's verb phrase overrides the narration.
    await emitEvent(page, { type: "turn_started", turn_id: "turn-1" })
    await expect(assistant.getByText("Thinking…")).toBeVisible()
    await emitEvent(page, {
      type: "progress_narration",
      content: "Let me check your groceries.",
    })
    await expect(
      assistant.getByText("Let me check your groceries.")
    ).toBeVisible()
    await emitEvent(page, {
      type: "tool_call_start",
      tool_call_id: "call-1",
      tool_name: "get_spending_overview",
      arguments: { start: "2026-05-01", end: "2026-05-31" },
    })
    await expect(
      assistant.getByText("Getting spending overview…")
    ).toBeVisible()
    const runningSummary = assistant.getByText("Spending overview…", {
      exact: true,
    })
    await expect(runningSummary).toBeVisible()
    await runningSummary.click()
    await expect(assistant.getByRole("img", { name: "Running" })).toBeVisible()
    await expect(assistant).not.toContainText("You spent")

    await emitEvent(page, {
      type: "tool_call_end",
      tool_call_id: "call-1",
      tool_name: "get_spending_overview",
      result_preview: "display only",
      result_summary: "€1,234.00 spent · €0.00 income",
      success: true,
    })
    await expect(assistant.getByRole("img", { name: "Done" })).toBeVisible()
    await expect(assistant).toContainText("€1,234.00 spent · €0.00 income")

    // A slow gap after the tool window falls back to the latest narration.
    await expect(assistant.getByText("Let me check your groceries.")).toBeVisible({
      timeout: 10_000,
    })

    // The first chunk must render before the final result event arrives; the
    // progress line yields to the streaming answer.
    await emitEvent(page, { type: "text_chunk", content: "You spent " })
    await expect(assistant).toContainText("You spent")
    await expect(assistant).not.toContainText("last month")
    await expect(assistant.getByText("Let me check your groceries.")).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Stop" })).toBeVisible()

    // A later chunk extends the same message in place.
    await emitEvent(page, { type: "text_chunk", content: "€1,234 last month." })
    await expect(assistant).toContainText("You spent €1,234 last month.")

    await emitEvent(page, {
      type: "result",
      assistant_message: "You spent €1,234 last month.",
      message_history: [],
    })
    await emitEvent(page, { type: "done" })
    await page.evaluate(() => window.__assistantStreamHook?.close())

    // Closing the stream returns the composer to its idle send state.
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0)
    await expect(assistant.getByRole("button", { name: "Copy response" })).toBeVisible()
    await expect(assistantTurns(page)).toHaveCount(1)
  })

  test("keeps the reader's place during streaming and offers a return to the latest message", async ({
    page,
  }) => {
    await installStreamHook(page)
    await page.goto("/assistant")
    await sendQuestion(page, "Show me a detailed spending review")
    await page.waitForFunction(
      () => window.__assistantStreamHook?.ready === true
    )

    // Sending pins the question near the top of the thread so the reply
    // streams downward in reading position.
    await expect
      .poll(() => offsetInThread(userTurns(page).last()))
      .toBeLessThan(48)

    // The reply reserves the room below the question before any text arrives.
    const reserved = await page.evaluate(() => {
      const log = document.querySelector('[role="log"]')!
      const user = log.querySelector('[aria-label="You"]')!
      const assistant = log.querySelector('[aria-label="Assistant"]')!
      return {
        needed: log.clientHeight - user.clientHeight - 64,
        actual: assistant.getBoundingClientRect().height,
      }
    })
    expect(reserved.actual).toBeGreaterThanOrEqual(reserved.needed - 1)

    const longAnswer = Array.from(
      { length: 80 },
      (_, index) => `Spending detail ${index + 1}.`
    ).join("\n\n")
    await emitEvent(page, { type: "text_chunk", content: longAnswer })
    await expect(thread(page).getByText("Spending detail 80.")).toBeAttached()

    // Streaming never drags the reader; the return control appears once the
    // newest content extends below the viewport.
    const scrollToLatest = page.getByRole("button", {
      name: "Scroll to latest message",
    })
    await expect(scrollToLatest).toBeVisible()
    // Let the send-time smooth scroll settle before measuring.
    const scrollTopBefore = await thread(page).evaluate(async (element) => {
      let last = -1
      while (element.scrollTop !== last) {
        last = element.scrollTop
        await new Promise((resolve) => window.setTimeout(resolve, 100))
      }
      return last
    })
    await emitEvent(page, { type: "text_chunk", content: "\n\nNewest detail." })
    await expect(thread(page).getByText("Newest detail.")).toBeAttached()
    await expect
      .poll(() => thread(page).evaluate((element) => element.scrollTop))
      .toBe(scrollTopBefore)

    await scrollToLatest.click()
    await expect(thread(page).getByText("Newest detail.")).toBeInViewport()
    await expect(scrollToLatest).toHaveCount(0)

    await page.evaluate(() => window.__assistantStreamHook?.close())
  })

  test("scrolls each sent question to the top with earlier turns above", async ({
    page,
  }) => {
    const longAnswer = Array.from(
      { length: 40 },
      (_, index) => `Spending detail ${index + 1}.`
    ).join("\n\n")
    await page.route(STREAM_URL, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: happyTurn(longAnswer, []),
      })
    })

    await page.goto("/assistant")
    await sendQuestion(page, "First question")
    await expect(thread(page).getByText("Spending detail 40.")).toBeAttached()
    await sendQuestion(page, "Second question")

    await expect
      .poll(() => offsetInThread(userTurns(page).last()))
      .toBeLessThan(48)

    // Earlier turns stay reachable by scrolling up.
    await thread(page).evaluate((element) => {
      element.scrollTop = 0
    })
    await expect(userTurns(page).first()).toBeInViewport()
  })
})
