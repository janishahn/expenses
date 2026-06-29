import { expect, test, type Page } from "@playwright/test"

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

const assistantMessages = (page: Page) =>
  page.locator('[data-testid="spending-assistant-message"][data-role="assistant"]')
const userMessages = (page: Page) =>
  page.locator('[data-testid="spending-assistant-message"][data-role="user"]')

async function sendQuestion(page: Page, text: string) {
  const input = page.getByTestId("spending-assistant-input")
  await input.click()
  await input.fill(text)
  await page.getByTestId("spending-assistant-send").click()
}

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
  test("streams an answer, shows the tool ticker, and never reveals raw tool or history data", async ({
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
    await expect(page.locator("main h1")).toContainText("Assistant")
    await expect(page.getByTestId("spending-assistant-prompt").first()).toBeVisible()

    await sendQuestion(page, "How much did I spend last month?")

    await expect(userMessages(page).last()).toContainText(
      "How much did I spend last month?"
    )
    await expect(assistantMessages(page).last()).toContainText(
      "You spent €1,234.00 last month."
    )

    const ticker = page.getByTestId("spending-assistant-tool")
    await expect(ticker).toContainText("Spending overview")
    await expect(ticker).toContainText("2026-05-01 to 2026-05-31")
    await expect(ticker).toHaveAttribute("data-status", "success")

    // The bold markdown must render as emphasis, not literal asterisks.
    await expect(assistantMessages(page).last().locator("strong")).toHaveText(
      "€1,234.00"
    )

    await expect(page.locator("body")).not.toContainText(TOOL_PREVIEW_MARKER)
    await expect(page.locator("body")).not.toContainText(HISTORY_MARKER)
  })

  test("shows query and type details in transaction search tool chips", async ({
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

    const ticker = page.getByTestId("spending-assistant-tool")
    await expect(ticker).toContainText("Searching transactions")
    await expect(ticker).toContainText("coffee")
    await expect(ticker).toContainText("expense")
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
    await expect(page.getByText("First answer.")).toBeVisible()

    await sendQuestion(page, "Second question")
    await expect(page.getByText("Second answer.")).toBeVisible()

    expect(posted).toHaveLength(2)
    expect(posted[0].messages).toEqual([
      { role: "user", content: "First question" },
    ])
    expect(posted[0].message_history).toEqual([])
    expect(posted[1].messages).toEqual([
      { role: "user", content: "Second question" },
    ])
    expect(posted[1].message_history).toEqual(firstHistory)
  })

  test("surfaces a 503 configuration error and keeps the composer usable", async ({
    page,
  }) => {
    await page.route(STREAM_URL, async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detail: "LLM is not configured" }),
      })
    })

    await page.goto("/assistant")
    await sendQuestion(page, "Am I over budget anywhere?")

    await expect(page.getByTestId("spending-assistant-error")).toContainText(
      "LLM is not configured"
    )
    await expect(userMessages(page).last()).toContainText(
      "Am I over budget anywhere?"
    )
    await expect(page.getByTestId("spending-assistant-input")).toBeEnabled()
    await expect(page.getByTestId("spending-assistant-send")).toBeVisible()
  })

  test("stops an in-flight response and returns to an idle composer", async ({
    page,
  }) => {
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

    const stopButton = page.getByTestId("spending-assistant-stop")
    await expect(stopButton).toBeVisible()
    await stopButton.click()

    await expect(page.getByTestId("spending-assistant-send")).toBeVisible()
    await expect(stopButton).toHaveCount(0)
    await expect(page.getByTestId("spending-assistant-input")).toBeEnabled()
    await expect(assistantMessages(page).last()).toContainText("Stopped")

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
    const input = page.getByTestId("spending-assistant-input")
    await input.click()
    await input.pressSequentially("first line")
    await input.press("Shift+Enter")
    await input.pressSequentially("second line")

    expect(await input.inputValue()).toContain("\n")
    await expect(userMessages(page)).toHaveCount(0)

    await input.press("Enter")
    await expect(userMessages(page).last()).toContainText("first line")
    await expect(assistantMessages(page).last()).toContainText(
      "Here is your answer."
    )
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

    const assistant = assistantMessages(page).last()
    const ticker = page.getByTestId("spending-assistant-tool")

    // Tool activity must appear before any answer text exists.
    await emitEvent(page, { type: "turn_started", turn_id: "turn-1" })
    await emitEvent(page, {
      type: "tool_call_start",
      tool_call_id: "call-1",
      tool_name: "get_spending_overview",
      arguments: { start: "2026-05-01", end: "2026-05-31" },
    })
    await expect(ticker).toContainText("Spending overview")
    await expect(ticker).toHaveAttribute("data-status", "running")
    await expect(assistant).not.toContainText("You spent")

    await emitEvent(page, {
      type: "tool_call_end",
      tool_call_id: "call-1",
      tool_name: "get_spending_overview",
      result_preview: "display only",
      success: true,
    })
    await expect(ticker).toHaveAttribute("data-status", "success")

    // The first chunk must render before the final result event arrives.
    await emitEvent(page, { type: "text_chunk", content: "You spent " })
    await expect(assistant).toContainText("You spent")
    await expect(assistant).not.toContainText("last month")

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
    await expect(page.getByTestId("spending-assistant-send")).toBeVisible()
  })
})
