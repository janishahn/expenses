import { useCallback, useEffect, useRef, useState } from "react"
import type { ChangeEvent, FormEvent, KeyboardEvent } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkSmartypants from "remark-smartypants"
import { ChatCircleDotsIcon } from "@phosphor-icons/react/ChatCircleDots"
import { CheckIcon } from "@phosphor-icons/react/Check"
import { CircleNotchIcon } from "@phosphor-icons/react/CircleNotch"
import { NotePencilIcon } from "@phosphor-icons/react/NotePencil"
import { PaperPlaneTiltIcon } from "@phosphor-icons/react/PaperPlaneTilt"
import { StopIcon } from "@phosphor-icons/react/Stop"
import { WarningIcon } from "@phosphor-icons/react/Warning"
import PageIntro from "../components/PageIntro"
import { streamSpendingChat } from "../app/api"
import type {
  SpendingChatHistoryEntry,
  SpendingChatStreamEvent,
} from "../app/api-types"

type ToolStatus = "running" | "success" | "failed"

type ToolActivity = {
  id: string
  toolName: string
  detail: string
  status: ToolStatus
}

type UserTurn = {
  id: string
  role: "user"
  content: string
}

type AssistantTurn = {
  id: string
  role: "assistant"
  content: string
  tools: ToolActivity[]
  streaming: boolean
  stopped: boolean
  error: string | null
}

type ChatTurn = UserTurn | AssistantTurn

const PROMPT_CHIPS = [
  "How much did I spend last month?",
  "What were my top spending categories this month?",
  "Compare this month's spending to last month",
  "Find my largest expenses this month",
]

const TOOL_LABELS: Record<string, string> = {
  get_spending_overview: "Spending overview",
  compare_spending_periods: "Comparing periods",
  breakdown_spending: "Breaking down spending",
  search_transactions: "Searching transactions",
  get_budget_context: "Budget context",
  get_transaction_detail: "Transaction detail",
}

function toolLabel(toolName: string): string {
  return TOOL_LABELS[toolName] ?? toolName.replace(/_/g, " ")
}

function toolDetail(args: Record<string, unknown>): string {
  const parts: string[] = []
  const start = typeof args.start === "string" ? args.start : null
  const end = typeof args.end === "string" ? args.end : null
  const currentStart =
    typeof args.current_start === "string" ? args.current_start : null
  const currentEnd =
    typeof args.current_end === "string" ? args.current_end : null
  const query = typeof args.query === "string" ? args.query : null
  const transactionType =
    typeof args.transaction_type === "string" ? args.transaction_type : null
  const groupBy = typeof args.group_by === "string" ? args.group_by : null
  const sort = typeof args.sort === "string" ? args.sort : null
  const limit = typeof args.limit === "number" ? args.limit : null
  const transactionId =
    typeof args.transaction_id === "number" ? args.transaction_id : null

  if (start && end) {
    parts.push(`${start} to ${end}`)
  }
  if (currentStart && currentEnd) {
    parts.push(`${currentStart} to ${currentEnd}`)
  }
  if (query) {
    parts.push(query)
  }
  if (transactionType) {
    parts.push(transactionType)
  }
  if (groupBy) {
    parts.push(`by ${groupBy}`)
  }
  if (sort) {
    parts.push(sort.replace(/_/g, " "))
  }
  if (limit) {
    parts.push(`${limit} rows`)
  }
  if (transactionId) {
    parts.push(`transaction ${transactionId}`)
  }
  return parts.join(" · ")
}

let turnIdCounter = 0
function nextTurnId(): string {
  turnIdCounter += 1
  return `turn-${turnIdCounter}`
}

function AssistantMarkdown({ content }: { content: string }) {
  return (
    <div className="transaction-markdown">
      <Markdown
        remarkPlugins={[remarkGfm, remarkSmartypants]}
        components={{
          a: ({ node, ...props }) => {
            void node
            return <a {...props} target="_blank" rel="noreferrer" />
          },
        }}
      >
        {content}
      </Markdown>
    </div>
  )
}

function ToolTicker({ tools }: { tools: ToolActivity[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tools.map((tool) => (
        <span
          key={tool.id}
          data-testid="spending-assistant-tool"
          data-status={tool.status}
          className="inline-flex items-center gap-1.5 rounded-md bg-faint/80 px-2.5 py-1.5 text-xs font-medium text-muted"
        >
          {tool.status === "running" ? (
            <CircleNotchIcon className="h-3.5 w-3.5 animate-spin text-accent" />
          ) : tool.status === "success" ? (
            <CheckIcon className="h-3.5 w-3.5 text-semantic-green" />
          ) : (
            <WarningIcon className="h-3.5 w-3.5 text-semantic-red" />
          )}
          <span className="whitespace-nowrap">{toolLabel(tool.toolName)}</span>
          {tool.detail ? (
            <span
              data-testid="spending-assistant-tool-detail"
              className="max-w-[13rem] truncate text-muted/75 desk:max-w-[26rem]"
            >
              · {tool.detail}
            </span>
          ) : null}
        </span>
      ))}
    </div>
  )
}

function SpendingAssistantPage() {
  const [messages, setMessages] = useState<ChatTurn[]>([])
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState(false)
  const historyRef = useRef<SpendingChatHistoryEntry[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const threadRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const thread = threadRef.current
      if (thread) {
        thread.scrollTop = thread.scrollHeight
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [messages])

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  const updateAssistant = useCallback(
    (assistantId: string, updater: (turn: AssistantTurn) => AssistantTurn) => {
      setMessages((prev) =>
        prev.map((turn) =>
          turn.id === assistantId && turn.role === "assistant"
            ? updater(turn)
            : turn
        )
      )
    },
    []
  )

  const applyEvent = useCallback(
    (assistantId: string, event: SpendingChatStreamEvent) => {
      switch (event.type) {
        case "tool_call_start":
          updateAssistant(assistantId, (turn) => ({
            ...turn,
            tools: [
              ...turn.tools,
              {
                id: event.tool_call_id,
                toolName: event.tool_name,
                detail: toolDetail(event.arguments),
                status: "running",
              },
            ],
          }))
          break
        case "tool_call_end":
          updateAssistant(assistantId, (turn) => ({
            ...turn,
            tools: turn.tools.map((tool) =>
              tool.id === event.tool_call_id
                ? { ...tool, status: event.success ? "success" : "failed" }
                : tool
            ),
          }))
          break
        case "progress_narration":
          break
        case "text_chunk":
          updateAssistant(assistantId, (turn) => ({
            ...turn,
            content: turn.content + event.content,
          }))
          break
        case "result":
          historyRef.current = event.message_history
          updateAssistant(assistantId, (turn) => ({
            ...turn,
            content: event.assistant_message,
          }))
          break
        case "error":
          updateAssistant(assistantId, (turn) => ({
            ...turn,
            error: event.message,
            streaming: false,
          }))
          break
        case "turn_started":
        case "text_commit":
        case "done":
          break
      }
    },
    [updateAssistant]
  )

  const sendMessage = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (!text || abortRef.current) {
        return
      }

      const assistantId = nextTurnId()
      setMessages((prev) => [
        ...prev,
        { id: nextTurnId(), role: "user", content: text },
        {
          id: assistantId,
          role: "assistant",
          content: "",
          tools: [],
          streaming: true,
          stopped: false,
          error: null,
        },
      ])
      setInput("")
      if (inputRef.current) {
        inputRef.current.style.height = "auto"
      }
      setStreaming(true)

      const controller = new AbortController()
      abortRef.current = controller
      try {
        for await (const event of streamSpendingChat(
          {
            messages: [{ role: "user", content: text }],
            message_history: historyRef.current,
          },
          controller.signal
        )) {
          applyEvent(assistantId, event)
        }
      } catch (error) {
        if (controller.signal.aborted) {
          updateAssistant(assistantId, (turn) => ({
            ...turn,
            stopped: true,
            streaming: false,
          }))
        } else {
          const message =
            error instanceof Error
              ? error.message
              : "The spending assistant is unavailable."
          updateAssistant(assistantId, (turn) => ({
            ...turn,
            error: message,
            streaming: false,
          }))
        }
      } finally {
        updateAssistant(assistantId, (turn) =>
          turn.streaming ? { ...turn, streaming: false } : turn
        )
        if (abortRef.current === controller) {
          abortRef.current = null
          setStreaming(false)
        }
      }
    },
    [applyEvent, updateAssistant]
  )

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const handleNewChat = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    historyRef.current = []
    setMessages([])
    setInput("")
    setStreaming(false)
  }, [])

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      void sendMessage(input)
    },
    [input, sendMessage]
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.nativeEvent.isComposing
      ) {
        event.preventDefault()
        void sendMessage(input)
      }
    },
    [input, sendMessage]
  )

  const handleInput = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const element = event.target
      setInput(element.value)
      element.style.height = "auto"
      element.style.height = `${Math.min(element.scrollHeight, 160)}px`
    },
    []
  )

  const canSend = input.trim().length > 0 && !streaming

  return (
    <section
      data-testid="spending-assistant-page"
      className="flex h-[calc(100dvh-5.75rem)] min-h-[32rem] flex-col desk:h-[calc(100dvh-7.75rem)] desk:min-h-[34rem]"
    >
      <PageIntro
        title="Assistant"
        titleAccessoryAlign="end"
        titleAccessory={
          messages.length > 0 ? (
            <button
              type="button"
              onClick={handleNewChat}
              className="inline-flex h-11 w-11 items-center justify-center rounded-md bg-surface text-muted shadow-[var(--shadow-soft)] transition hover:bg-surface-hi hover:text-text"
              aria-label="New chat"
              data-testid="spending-assistant-new-chat"
            >
              <NotePencilIcon className="h-4 w-4" />
            </button>
          ) : undefined
        }
      />

      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col">
        <div
          ref={threadRef}
          data-testid="spending-assistant-thread"
          role="log"
          aria-live="polite"
          aria-label="Conversation"
          className="financial-panel financial-panel-message mt-3 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pt-5 pb-4 md:px-6 md:pt-6"
        >
          {messages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-5 py-8 text-center md:py-12">
              <span className="flex h-12 w-12 items-center justify-center rounded-sm bg-signal-blue-soft text-accent">
                <ChatCircleDotsIcon className="h-6 w-6" />
              </span>
              <div className="max-w-lg space-y-1.5">
                <p className="font-head text-xl font-bold text-text">
                  What should we inspect?
                </p>
                <p className="text-sm text-muted">
                  Ask about spending, budgets, and transactions in your private ledger.
                </p>
              </div>
              <div className="grid w-full max-w-2xl gap-2 sm:grid-cols-2">
                {PROMPT_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    data-testid="spending-assistant-prompt"
                    onClick={() => void sendMessage(chip)}
                    className="min-h-11 rounded-lg bg-faint/75 px-4 py-3 text-left text-sm font-medium text-text transition hover:bg-signal-blue-soft focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((turn) =>
              turn.role === "user" ? (
                <div key={turn.id} className="flex justify-end">
                  <div
                    data-testid="spending-assistant-message"
                    data-role="user"
                    className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg rounded-br-sm bg-signal-blue-soft px-4 py-3 text-sm text-text"
                  >
                    {turn.content}
                  </div>
                </div>
              ) : (
                <div key={turn.id} className="flex gap-3">
                  <span
                    data-testid="spending-assistant-avatar"
                    className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-signal-purple-soft text-semantic-purple"
                  >
                    <ChatCircleDotsIcon className="h-4 w-4" />
                  </span>
                  <div
                    data-testid="spending-assistant-message"
                    data-role="assistant"
                    className="min-w-0 flex-1 space-y-2.5 pt-1"
                  >
                    {turn.tools.length > 0 ? (
                      <ToolTicker tools={turn.tools} />
                    ) : null}
                    {turn.content ? (
                      <AssistantMarkdown content={turn.content} />
                    ) : turn.streaming &&
                      turn.tools.every((tool) => tool.status !== "running") ? (
                      <span
                        data-testid="spending-assistant-thinking"
                        className="inline-flex min-h-7 items-center gap-2 text-muted"
                      >
                        <CircleNotchIcon className="h-4 w-4 animate-spin" />
                        <span className="loading-hint">Thinking…</span>
                      </span>
                    ) : null}
                    {turn.stopped ? (
                      <span className="loading-hint">Stopped</span>
                    ) : null}
                    {turn.error ? (
                      <div
                        data-testid="spending-assistant-error"
                        className="flex items-start gap-2 rounded-lg bg-signal-red-soft px-3 py-2.5 text-sm text-semantic-red"
                      >
                        <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{turn.error}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            )
          )}
        </div>

        <form
          data-testid="spending-assistant-composer"
          onSubmit={handleSubmit}
          className="z-10 shrink-0 bg-bg pt-3 pb-[env(safe-area-inset-bottom,0px)]"
        >
          <div className="composer-surface flex items-end gap-2 rounded-lg border p-2">
            <textarea
              ref={inputRef}
              data-testid="spending-assistant-input"
              aria-label="Message the spending assistant"
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your spending…"
              rows={1}
              className="max-h-40 min-h-[2.5rem] w-full resize-none bg-transparent px-2.5 py-2 text-[0.95rem] leading-6 text-text outline-none placeholder:text-muted"
            />
            {streaming ? (
              <button
                type="button"
                onClick={handleStop}
                aria-label="Stop"
                data-testid="spending-assistant-stop"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-signal-red-soft text-semantic-red transition hover:brightness-95"
              >
                <StopIcon className="h-4 w-4" weight="fill" />
              </button>
            ) : (
              <button
                type="submit"
                aria-label="Send"
                data-testid="spending-assistant-send"
                disabled={!canSend}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-accent text-white shadow-[var(--shadow-accent)] transition hover:brightness-105 disabled:opacity-50"
              >
                <PaperPlaneTiltIcon className="h-4 w-4" weight="fill" />
              </button>
            )}
          </div>
        </form>
      </div>
    </section>
  )
}

export default SpendingAssistantPage
