import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { ArrowClockwiseIcon } from "@phosphor-icons/react/ArrowClockwise"
import { CheckIcon } from "@phosphor-icons/react/Check"
import { CopyIcon } from "@phosphor-icons/react/Copy"
import { NotePencilIcon } from "@phosphor-icons/react/NotePencil"
import { WarningIcon } from "@phosphor-icons/react/Warning"
import { streamSpendingChat } from "../app/api"
import { formatDateRange } from "../app/format"
import type { SpendingChatHistoryEntry, SpendingChatStreamEvent } from "../app/api-types"
import { ChatGPTPlanLink } from "../components/AISettingsPanel"
import { Button, IconButton } from "../components/ui/Button"
import {
  ChatActions,
  ChatBubble,
  ChatComposer,
  ChatEmpty,
  ChatMarkdown,
  ChatProgress,
  ChatThread,
  ChatToolItem,
  ChatTools,
  ChatTurn,
  type ChatToolStatus,
} from "../components/ui/Chat"
import { Status } from "../components/ui/EmptyState"
import { Panel } from "../components/ui/Panel"

type ToolActivity = {
  id: string
  toolName: string
  detail: string
  summary: string | null
  status: ChatToolStatus
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
  narration: string
  tools: ToolActivity[]
  streaming: boolean
  stopped: boolean
  error: string | null
}

type Turn = UserTurn | AssistantTurn

const PROMPT_CHIPS = [
  "How much did I spend last month?",
  "What were my top spending categories this month?",
  "Compare this month's spending to last month",
  "Find my largest expenses this month",
]

const TOOL_LABELS: Record<string, string> = {
  get_spending_overview: "Spending overview",
  compare_spending_periods: "Period comparison",
  breakdown_spending: "Spending breakdown",
  search_transactions: "Transaction search",
  get_budget_context: "Budget context",
  get_transaction_detail: "Transaction detail",
}

// Verb phrases for the live progress line, kept separate from the shorter noun
// labels used in the collapsed activity disclosure. Mirrors the iOS app.
const TOOL_VERB_PHRASES: Record<string, string> = {
  get_spending_overview: "Getting spending overview…",
  compare_spending_periods: "Comparing periods…",
  breakdown_spending: "Breaking down spending…",
  search_transactions: "Searching transactions…",
  get_budget_context: "Checking your budgets…",
  get_transaction_detail: "Looking up the transaction…",
}

function toolLabel(toolName: string): string {
  return TOOL_LABELS[toolName] ?? toolName.replace(/_/g, " ")
}

function toolVerbPhrase(toolName: string): string {
  return TOOL_VERB_PHRASES[toolName] ?? "Working on your request…"
}

// Tool arguments come from the model, so only well-formed dates get the readable range.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function rangeText(start: string, end: string): string {
  return ISO_DATE.test(start) && ISO_DATE.test(end) ? formatDateRange(start, end) : `${start} to ${end}`
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
    parts.push(rangeText(start, end))
  }
  if (currentStart && currentEnd) {
    parts.push(rangeText(currentStart, currentEnd))
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

function copyTextToClipboard(text: string) {
  // Self-hosted plain-HTTP deployments have no navigator.clipboard.
  if (navigator.clipboard) {
    void navigator.clipboard.writeText(text)
    return
  }
  const area = document.createElement("textarea")
  area.value = text
  area.setAttribute("readonly", "")
  area.style.position = "fixed"
  area.style.opacity = "0"
  document.body.append(area)
  area.select()
  document.execCommand("copy")
  area.remove()
}

let turnIdCounter = 0
function nextTurnId(): string {
  turnIdCounter += 1
  return `turn-${turnIdCounter}`
}

function CopyButton({ copied, label, onCopy }: { copied: boolean; label: string; onCopy: () => void }) {
  return <IconButton icon={copied ? CheckIcon : CopyIcon} size="small" label={copied ? "Copied" : label} onClick={onCopy} />
}

// A freshly started tool's verb phrase overrides the line for a bounded window so
// a slow tool cannot pin its label; it then falls back to the latest narration,
// then "Thinking…". Each new tool resets the window. Mirrors the iOS progress line.
const TOOL_PHRASE_WINDOW_MS = 3000

function AssistantProgressLine({ narration, tools }: { narration: string; tools: ToolActivity[] }) {
  const lastTool = tools.length > 0 ? tools[tools.length - 1] : null
  const lastToolId = lastTool?.id ?? null
  const [expiredToolId, setExpiredToolId] = useState<string | null>(null)

  useEffect(() => {
    if (!lastToolId) {
      return
    }
    const timer = window.setTimeout(() => setExpiredToolId(lastToolId), TOOL_PHRASE_WINDOW_MS)
    return () => window.clearTimeout(timer)
  }, [lastToolId])

  const overrideTool = lastTool && lastTool.id !== expiredToolId ? lastTool : null
  return <ChatProgress>{overrideTool ? toolVerbPhrase(overrideTool.toolName) : narration || "Thinking…"}</ChatProgress>
}

function ToolActivityDisclosure({ tools }: { tools: ToolActivity[] }) {
  const runningTool = tools.find((tool) => tool.status === "running")
  const failedTool = tools.find((tool) => tool.status === "failed")
  const summary = runningTool
    ? `${toolLabel(runningTool.toolName)}…`
    : failedTool
      ? `${toolLabel(failedTool.toolName)} failed`
      : tools.length === 1
        ? toolLabel(tools[0].toolName)
        : `Reviewed ${tools.length} ledger views`

  return (
    <ChatTools summary={summary} failed={!runningTool && Boolean(failedTool)}>
      {tools.map((tool) => (
        <ChatToolItem key={tool.id} status={tool.status} label={toolLabel(tool.toolName)} detail={tool.detail} result={tool.summary} />
      ))}
    </ChatTools>
  )
}

function SpendingAssistantPage() {
  const [messages, setMessages] = useState<Turn[]>([])
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState(false)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const [copiedTurnId, setCopiedTurnId] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState("")
  const [answerReserve, setAnswerReserve] = useState<{ turnId: string; px: number } | null>(null)
  const historyRef = useRef<SpendingChatHistoryEntry[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const threadRef = useRef<HTMLDivElement | null>(null)
  const pendingScrollRef = useRef<{ userId: string; assistantId: string } | null>(null)
  const copyTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      if (copyTimerRef.current) {
        window.clearTimeout(copyTimerRef.current)
      }
    }
  }, [])

  // Sending scrolls the question to the top of the thread and reserves just enough
  // space below it for the reply to render in reading position; the reserve is
  // consumed as the answer grows.
  useLayoutEffect(() => {
    const pending = pendingScrollRef.current
    const thread = threadRef.current
    if (!pending || !thread) {
      return
    }
    const userEl = thread.querySelector<HTMLElement>(`[data-turn-id="${pending.userId}"]`)
    if (!userEl) {
      return
    }
    pendingScrollRef.current = null
    setAnswerReserve({
      turnId: pending.assistantId,
      px: Math.max(0, thread.clientHeight - userEl.offsetHeight - 64),
    })
    window.requestAnimationFrame(() => {
      const top = userEl.getBoundingClientRect().top - thread.getBoundingClientRect().top + thread.scrollTop - 20
      thread.scrollTo({ top: Math.max(0, top), behavior: "smooth" })
    })
  }, [messages])

  // The newest turn can be taller than its content (the answer reserve),
  // so the return-to-latest control keys off where rendered content actually ends.
  const latestContentOverflow = useCallback(() => {
    const thread = threadRef.current
    const body = thread?.querySelector("[data-turn-id]:last-of-type > [data-turn-body]")
    if (!thread || !body) {
      return null
    }
    return body.getBoundingClientRect().bottom - thread.getBoundingClientRect().bottom
  }, [])

  const updateScrollPill = useCallback(() => {
    const overflow = latestContentOverflow()
    setShowScrollToBottom(overflow !== null && overflow > 48)
  }, [latestContentOverflow])

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateScrollPill)
    return () => window.cancelAnimationFrame(frame)
  }, [messages, updateScrollPill])

  const scrollToBottom = useCallback(() => {
    const thread = threadRef.current
    const overflow = latestContentOverflow()
    if (!thread || overflow === null) {
      return
    }
    thread.scrollTo({ top: thread.scrollTop + overflow + 24, behavior: "smooth" })
    setShowScrollToBottom(false)
  }, [latestContentOverflow])

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
                summary: null,
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
                ? {
                    ...tool,
                    summary: event.result_summary,
                    status: event.success ? "success" : "failed",
                  }
                : tool
            ),
          }))
          break
        case "progress_narration":
          updateAssistant(assistantId, (turn) => ({
            ...turn,
            narration: event.content,
          }))
          break
        case "text_chunk":
          updateAssistant(assistantId, (turn) => ({
            ...turn,
            content: turn.content + event.content,
          }))
          break
        case "result":
          historyRef.current = event.message_history
          setAnnouncement(event.assistant_message)
          updateAssistant(assistantId, (turn) => ({
            ...turn,
            content: event.assistant_message,
          }))
          break
        case "error":
          setAnnouncement(event.message)
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

  const runStream = useCallback(
    async (assistantId: string, text: string) => {
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
          setAnnouncement("Response stopped")
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
          setAnnouncement(message)
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

  const sendMessage = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (!text || abortRef.current) {
        return
      }

      const userId = nextTurnId()
      const assistantId = nextTurnId()
      pendingScrollRef.current = { userId, assistantId }
      setMessages((prev) => [
        ...prev,
        { id: userId, role: "user", content: text },
        {
          id: assistantId,
          role: "assistant",
          content: "",
          narration: "",
          tools: [],
          streaming: true,
          stopped: false,
          error: null,
        },
      ])
      setInput("")
      if (window.matchMedia("(min-width: 861px)").matches) {
        window.requestAnimationFrame(() => inputRef.current?.focus())
      }
      setAnnouncement("Assistant is working")
      await runStream(assistantId, text)
    },
    [runStream]
  )

  const retryTurn = useCallback(
    (assistantId: string) => {
      if (abortRef.current) {
        return
      }
      const index = messages.findIndex((turn) => turn.id === assistantId)
      const userTurn = index > 0 ? messages[index - 1] : undefined
      if (!userTurn || userTurn.role !== "user") {
        return
      }
      setMessages((prev) =>
        prev.map((turn) =>
          turn.id === assistantId && turn.role === "assistant"
            ? {
                ...turn,
                content: "",
                narration: "",
                tools: [],
                streaming: true,
                stopped: false,
                error: null,
              }
            : turn
        )
      )
      setAnnouncement("Assistant is working")
      void runStream(assistantId, userTurn.content)
    },
    [messages, runStream]
  )

  const handleCopy = useCallback((turnId: string, content: string) => {
    copyTextToClipboard(content)
    setCopiedTurnId(turnId)
    if (copyTimerRef.current) {
      window.clearTimeout(copyTimerRef.current)
    }
    copyTimerRef.current = window.setTimeout(() => setCopiedTurnId(null), 2000)
  }, [])

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const handleNewChat = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    historyRef.current = []
    pendingScrollRef.current = null
    setMessages([])
    setInput("")
    setStreaming(false)
    setShowScrollToBottom(false)
    setAnswerReserve(null)
    setCopiedTurnId(null)
    setAnnouncement("")
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  return (
    <Panel
      title="Assistant"
      layout="fill"
      actions={
        <>
          <ChatGPTPlanLink />
          {messages.length > 0 ? <IconButton icon={NotePencilIcon} label="New chat" onClick={handleNewChat} /> : null}
        </>
      }
    >
      <ChatThread ref={threadRef} empty={messages.length === 0} announcement={announcement} onScroll={updateScrollPill}>
        {messages.length === 0 ? (
          <ChatEmpty title="Ask about your spending" prompts={PROMPT_CHIPS} onPrompt={(prompt) => void sendMessage(prompt)} />
        ) : (
          messages.map((turn) =>
            turn.role === "user" ? (
              <ChatTurn key={turn.id} id={turn.id} from="user">
                <ChatBubble>{turn.content}</ChatBubble>
                <ChatActions>
                  <CopyButton copied={copiedTurnId === turn.id} label="Copy message" onCopy={() => handleCopy(turn.id, turn.content)} />
                </ChatActions>
              </ChatTurn>
            ) : (
              <ChatTurn key={turn.id} id={turn.id} from="assistant" reserve={answerReserve?.turnId === turn.id ? answerReserve.px : undefined}>
                {turn.tools.length > 0 ? <ToolActivityDisclosure tools={turn.tools} /> : null}
                {turn.content ? (
                  <ChatMarkdown content={turn.content} />
                ) : turn.streaming ? (
                  <AssistantProgressLine narration={turn.narration} tools={turn.tools} />
                ) : null}
                {turn.stopped ? <Status>Stopped</Status> : null}
                {turn.error ? (
                  <Status icon={WarningIcon} tone="bad" wrap>
                    {turn.error}
                  </Status>
                ) : null}
                {!turn.streaming && (turn.stopped || turn.error || turn.content) ? (
                  <ChatActions>
                    {turn.stopped || turn.error ? (
                      <Button variant="ghost" size="small" icon={ArrowClockwiseIcon} onClick={() => retryTurn(turn.id)}>
                        Try again
                      </Button>
                    ) : null}
                    {turn.content ? (
                      <CopyButton copied={copiedTurnId === turn.id} label="Copy response" onCopy={() => handleCopy(turn.id, turn.content)} />
                    ) : null}
                  </ChatActions>
                ) : null}
              </ChatTurn>
            )
          )
        )}
      </ChatThread>
      <ChatComposer
        ref={inputRef}
        value={input}
        onChange={setInput}
        onSend={() => void sendMessage(input)}
        onStop={handleStop}
        busy={streaming}
        label="Message the spending assistant"
        placeholder="Ask about your spending"
        onScrollToLatest={showScrollToBottom ? scrollToBottom : undefined}
      />
    </Panel>
  )
}

export default SpendingAssistantPage
