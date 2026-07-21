import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import type { ChangeEvent, FormEvent, KeyboardEvent } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkSmartypants from "remark-smartypants"
import { ArrowClockwiseIcon } from "@phosphor-icons/react/ArrowClockwise"
import { ArrowDownIcon } from "@phosphor-icons/react/ArrowDown"
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown"
import { ChatCircleDotsIcon } from "@phosphor-icons/react/ChatCircleDots"
import { CheckIcon } from "@phosphor-icons/react/Check"
import { CircleNotchIcon } from "@phosphor-icons/react/CircleNotch"
import { CopyIcon } from "@phosphor-icons/react/Copy"
import { NotePencilIcon } from "@phosphor-icons/react/NotePencil"
import { PaperPlaneTiltIcon } from "@phosphor-icons/react/PaperPlaneTilt"
import { StopIcon } from "@phosphor-icons/react/Stop"
import { WarningIcon } from "@phosphor-icons/react/Warning"
import { useOutletContext } from "react-router-dom"
import { streamSpendingChat } from "../app/api"
import type {
  SpendingChatHistoryEntry,
  SpendingChatStreamEvent,
} from "../app/api-types"
import type { AppShellOutletContext } from "../app/AppShell"

type ToolStatus = "running" | "success" | "failed"

type ToolActivity = {
  id: string
  toolName: string
  detail: string
  summary: string | null
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
  narration: string
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

function CopyButton({
  copied,
  label,
  testId,
  onCopy,
}: {
  copied: boolean
  label: string
  testId: string
  onCopy: () => void
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={copied ? "Copied" : label}
      onClick={onCopy}
      className="relative inline-flex h-11 w-11 items-center justify-center rounded-md text-muted transition-[background-color,color,scale] duration-150 ease-out hover:bg-faint/70 hover:text-text active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring desk:h-9 desk:w-9 desk:after:absolute desk:after:-inset-1 desk:after:content-['']"
    >
      <span
        className={`absolute inset-0 flex items-center justify-center transition-[opacity,filter,scale] duration-200 ease-[cubic-bezier(0.2,0,0,1)] ${
          copied
            ? "scale-100 opacity-100 blur-0"
            : "scale-[0.25] opacity-0 blur-[4px]"
        }`}
      >
        <CheckIcon className="h-4 w-4 text-semantic-green" />
      </span>
      <span
        className={`flex items-center justify-center transition-[opacity,filter,scale] duration-200 ease-[cubic-bezier(0.2,0,0,1)] ${
          copied
            ? "scale-[0.25] opacity-0 blur-[4px]"
            : "scale-100 opacity-100 blur-0"
        }`}
      >
        <CopyIcon className="h-4 w-4" />
      </span>
    </button>
  )
}

function AssistantMarkdown({
  content,
  streaming,
}: {
  content: string
  streaming: boolean
}) {
  return (
    <div
      className={`assistant-markdown transaction-markdown${
        streaming ? " assistant-markdown-streaming" : ""
      }`}
    >
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

// A freshly started tool's verb phrase overrides the line for a bounded window so
// a slow tool cannot pin its label; it then falls back to the latest narration,
// then "Thinking…". Each new tool resets the window. Mirrors the iOS progress line.
const TOOL_PHRASE_WINDOW_MS = 3000

function AssistantProgressLine({
  narration,
  tools,
}: {
  narration: string
  tools: ToolActivity[]
}) {
  const lastTool = tools.length > 0 ? tools[tools.length - 1] : null
  const lastToolId = lastTool?.id ?? null
  const [expiredToolId, setExpiredToolId] = useState<string | null>(null)

  useEffect(() => {
    if (!lastToolId) {
      return
    }
    const timer = window.setTimeout(
      () => setExpiredToolId(lastToolId),
      TOOL_PHRASE_WINDOW_MS
    )
    return () => window.clearTimeout(timer)
  }, [lastToolId])

  const overrideTool =
    lastTool && lastTool.id !== expiredToolId ? lastTool : null
  const phrase = overrideTool
    ? toolVerbPhrase(overrideTool.toolName)
    : narration || "Thinking…"

  return (
    <div
      data-testid="spending-assistant-progress"
      className="flex min-h-7 items-center gap-2 text-[0.95rem] leading-6 text-muted"
    >
      <CircleNotchIcon className="hidden h-4 w-4 shrink-0 animate-spin motion-reduce:inline-block" />
      <span key={phrase} className="progress-phrase min-w-0 truncate">
        {phrase}
      </span>
    </div>
  )
}

function ToolActivityDisclosure({ tools }: { tools: ToolActivity[] }) {
  const runningTool = tools.find((tool) => tool.status === "running")
  const failedTool = tools.find((tool) => tool.status === "failed")
  const status = runningTool ? "running" : failedTool ? "failed" : "success"
  const summary = runningTool
    ? `${toolLabel(runningTool.toolName)}…`
    : failedTool
      ? `${toolLabel(failedTool.toolName)} failed`
      : tools.length === 1
        ? toolLabel(tools[0].toolName)
        : `Reviewed ${tools.length} ledger views`

  return (
    <details
      data-testid="spending-assistant-tool"
      data-status={status}
      className="assistant-activity max-w-full text-xs text-muted"
    >
      <summary className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-md px-2.5 font-medium transition-[background-color,color] duration-150 ease-out hover:bg-faint/70 hover:text-text">
        {status === "running" ? (
          <CircleNotchIcon className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
        ) : status === "success" ? (
          <CheckIcon className="h-3.5 w-3.5 shrink-0 text-semantic-green" />
        ) : (
          <WarningIcon className="h-3.5 w-3.5 shrink-0 text-semantic-red" />
        )}
        <span className="truncate">{summary}</span>
        <CaretDownIcon className="assistant-activity-caret h-3.5 w-3.5 shrink-0" />
      </summary>
      <div className="assistant-activity-content ml-2 border-l border-border/80 py-1.5 pl-4">
        {tools.map((tool) => (
          <div key={tool.id} className="flex min-w-0 items-start gap-2 py-1.5">
            <span
              className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                tool.status === "failed"
                  ? "bg-semantic-red"
                  : tool.status === "running"
                    ? "bg-accent"
                    : "bg-semantic-green"
              }`}
            />
            <span className="min-w-0">
              <span className="font-medium text-text/85">
                {toolLabel(tool.toolName)}
              </span>
              {tool.detail ? (
                <span
                  data-testid="spending-assistant-tool-detail"
                  className="block break-words pt-0.5 text-muted/80"
                >
                  {tool.detail}
                </span>
              ) : null}
              {tool.summary ? (
                <span
                  data-testid="spending-assistant-tool-summary"
                  className="block break-words pt-0.5 font-medium text-text/75"
                >
                  {tool.summary}
                </span>
              ) : null}
            </span>
          </div>
        ))}
      </div>
    </details>
  )
}

function SpendingAssistantPage() {
  const { setUtilityAction } = useOutletContext<AppShellOutletContext>()
  const [messages, setMessages] = useState<ChatTurn[]>([])
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState(false)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const [copiedTurnId, setCopiedTurnId] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState("")
  const [answerReserve, setAnswerReserve] = useState<{
    turnId: string
    px: number
  } | null>(null)
  const historyRef = useRef<SpendingChatHistoryEntry[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const threadRef = useRef<HTMLDivElement | null>(null)
  const pendingScrollRef = useRef<{ userId: string; assistantId: string } | null>(
    null
  )
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
    const userEl = thread.querySelector<HTMLElement>(
      `[data-turn-id="${pending.userId}"]`
    )
    if (!userEl) {
      return
    }
    pendingScrollRef.current = null
    setAnswerReserve({
      turnId: pending.assistantId,
      px: Math.max(0, thread.clientHeight - userEl.offsetHeight - 64),
    })
    window.requestAnimationFrame(() => {
      const top =
        userEl.getBoundingClientRect().top -
        thread.getBoundingClientRect().top +
        thread.scrollTop -
        20
      thread.scrollTo({ top: Math.max(0, top), behavior: "smooth" })
    })
  }, [messages])

  // The newest turn's wrapper can be taller than its content (the answer reserve),
  // so the return-to-latest control keys off where rendered content actually ends.
  const latestContentOverflow = useCallback(() => {
    const thread = threadRef.current
    const lastTurn = thread?.firstElementChild?.lastElementChild
    if (!thread || !lastTurn || !lastTurn.hasAttribute("data-turn-id")) {
      return null
    }
    const message =
      lastTurn.querySelector('[data-testid="spending-assistant-message"]') ??
      lastTurn
    const content = message.lastElementChild ?? message
    return (
      content.getBoundingClientRect().bottom -
      thread.getBoundingClientRect().bottom
    )
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
    thread.scrollTo({
      top: thread.scrollTop + overflow + 24,
      behavior: "smooth",
    })
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
      if (inputRef.current) {
        inputRef.current.style.height = "auto"
      }
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

  useEffect(() => {
    if (messages.length === 0) {
      setUtilityAction(null)
      return
    }
    setUtilityAction({
      label: "New chat",
      onClick: handleNewChat,
      icon: NotePencilIcon,
      presentation: "quiet",
    })
    return () => setUtilityAction(null)
  }, [handleNewChat, messages.length, setUtilityAction])

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
      aria-label="Assistant conversation"
      className="relative flex h-[calc(100dvh-5.75rem)] min-h-[32rem] flex-col desk:h-[calc(100dvh-7.75rem)] desk:min-h-[34rem]"
    >
      <div
        ref={threadRef}
        data-testid="spending-assistant-thread"
        role="log"
        aria-live="off"
        aria-label="Conversation"
        onScroll={updateScrollPill}
        className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-y-contain"
      >
        <div
          className={`mx-auto flex min-h-full w-full max-w-4xl flex-col px-1 desk:px-4 ${
            messages.length === 0 ? "justify-center" : "gap-6 py-5 desk:gap-8 desk:py-7"
          }`}
        >
          {messages.length === 0 ? (
            <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-5 py-8 text-center md:py-12">
              <span className="flex h-12 w-12 items-center justify-center rounded-md bg-signal-blue-soft text-accent">
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
                    className="min-h-11 rounded-lg bg-faint/70 px-4 py-3 text-left text-sm font-medium text-text transition-[background-color,scale] duration-150 ease-out hover:bg-signal-blue-soft active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((turn) =>
              turn.role === "user" ? (
                <div
                  key={turn.id}
                  data-turn-id={turn.id}
                  className="chat-turn-enter group flex justify-end"
                >
                  <div className="flex max-w-[88%] flex-col items-end gap-1 desk:max-w-[72%]">
                    <div
                      data-testid="spending-assistant-message"
                      data-role="user"
                      className="whitespace-pre-wrap break-words rounded-xl rounded-br-sm bg-signal-blue-soft px-4 py-3 text-[0.95rem] leading-6 text-text"
                    >
                      {turn.content}
                    </div>
                    <div className="flex items-center opacity-100 transition-opacity duration-150 ease-out desk:opacity-0 desk:group-focus-within:opacity-100 desk:group-hover:opacity-100">
                      <CopyButton
                        copied={copiedTurnId === turn.id}
                        label="Copy message"
                        testId="spending-assistant-copy-user"
                        onCopy={() => handleCopy(turn.id, turn.content)}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  key={turn.id}
                  data-turn-id={turn.id}
                  style={
                    answerReserve?.turnId === turn.id
                      ? { minHeight: answerReserve.px }
                      : undefined
                  }
                  className="chat-turn-enter group flex justify-start"
                >
                  <div
                    data-testid="spending-assistant-message"
                    data-role="assistant"
                    className="min-w-0 max-w-[65ch] flex-1 space-y-2.5"
                  >
                    {turn.tools.length > 0 ? (
                      <ToolActivityDisclosure tools={turn.tools} />
                    ) : null}
                    {turn.content ? (
                      <AssistantMarkdown
                        content={turn.content}
                        streaming={turn.streaming}
                      />
                    ) : turn.streaming ? (
                      <AssistantProgressLine
                        narration={turn.narration}
                        tools={turn.tools}
                      />
                    ) : null}
                    {turn.stopped ? (
                      <p className="text-sm text-muted">Stopped</p>
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
                    {!turn.streaming && (turn.stopped || turn.error) ? (
                      <button
                        type="button"
                        data-testid="spending-assistant-retry"
                        onClick={() => retryTurn(turn.id)}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-muted transition-[background-color,color,scale] duration-150 ease-out hover:bg-faint/70 hover:text-text active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring desk:min-h-9"
                      >
                        <ArrowClockwiseIcon className="h-3.5 w-3.5" />
                        Try again
                      </button>
                    ) : null}
                    {!turn.streaming && turn.content ? (
                      <div className="flex items-center opacity-100 transition-opacity duration-150 ease-out desk:opacity-0 desk:group-focus-within:opacity-100 desk:group-hover:opacity-100">
                        <CopyButton
                          copied={copiedTurnId === turn.id}
                          label="Copy response"
                          testId="spending-assistant-copy"
                          onCopy={() => handleCopy(turn.id, turn.content)}
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            )
          )}
        </div>
      </div>

      <button
        type="button"
        aria-label="Scroll to latest message"
        data-testid="spending-assistant-scroll-bottom"
        tabIndex={showScrollToBottom ? 0 : -1}
        onClick={scrollToBottom}
        className={`absolute bottom-[5.75rem] left-1/2 z-20 inline-flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full bg-surface text-muted shadow-[var(--shadow-soft)] transition-[opacity,scale,background-color,color] duration-200 ease-out hover:bg-surface-hi hover:text-text active:scale-[0.96] ${
          showScrollToBottom
            ? "pointer-events-auto scale-100 opacity-100"
            : "pointer-events-none scale-[0.85] opacity-0"
        }`}
      >
        <ArrowDownIcon className="h-4 w-4" />
      </button>

      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>

      <div className="mx-auto w-full max-w-4xl shrink-0 px-0 desk:px-4">
        <form
          data-testid="spending-assistant-composer"
          onSubmit={handleSubmit}
          className="z-10 shrink-0 bg-bg pt-3 pb-[env(safe-area-inset-bottom,0px)]"
        >
          <div className="composer-surface flex items-end gap-2 rounded-xl border p-2">
            <textarea
              ref={inputRef}
              data-testid="spending-assistant-input"
              aria-label="Message the spending assistant"
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your spending…"
              rows={1}
              className="max-h-40 min-h-11 w-full resize-none bg-transparent px-2.5 py-2.5 text-[0.95rem] leading-6 text-text outline-none placeholder:text-muted"
            />
            <button
              type={streaming ? "button" : "submit"}
              onClick={streaming ? handleStop : undefined}
              aria-label={streaming ? "Stop" : "Send"}
              data-testid={
                streaming ? "spending-assistant-stop" : "spending-assistant-send"
              }
              disabled={!streaming && !canSend}
              className={`relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md shadow-[var(--shadow-accent)] transition-[background-color,color,opacity,scale] duration-200 ease-out enabled:active:scale-[0.96] disabled:opacity-50 ${
                streaming
                  ? "bg-signal-red-soft text-semantic-red"
                  : "bg-accent text-[rgb(var(--accent-contrast))]"
              }`}
            >
              <span
                className={`absolute inset-0 flex items-center justify-center transition-[opacity,filter,scale] duration-200 ease-[cubic-bezier(0.2,0,0,1)] ${
                  streaming
                    ? "scale-100 opacity-100 blur-0"
                    : "scale-[0.25] opacity-0 blur-[4px]"
                }`}
              >
                <StopIcon className="h-4 w-4" weight="fill" />
              </span>
              <span
                className={`flex items-center justify-center transition-[opacity,filter,scale] duration-200 ease-[cubic-bezier(0.2,0,0,1)] ${
                  streaming
                    ? "scale-[0.25] opacity-0 blur-[4px]"
                    : "scale-100 opacity-100 blur-0"
                }`}
              >
                <PaperPlaneTiltIcon className="h-4 w-4" weight="fill" />
              </span>
            </button>
          </div>
        </form>
      </div>
    </section>
  )
}

export default SpendingAssistantPage
