import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useSearchParams } from "react-router-dom"
import { ArrowClockwiseIcon } from "@phosphor-icons/react/ArrowClockwise"
import { CheckIcon } from "@phosphor-icons/react/Check"
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/ClockCounterClockwise"
import { CopyIcon } from "@phosphor-icons/react/Copy"
import { NotePencilIcon } from "@phosphor-icons/react/NotePencil"
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle"
import {
  fetchAssistantChat,
  fetchAssistantChats,
  getApiErrorMessage,
  streamAssistantDecision,
  streamAssistantMessage,
  streamAssistantRetry,
} from "../app/api"
import type { AssistantChat, AssistantChatSummary, AssistantItem, AssistantStreamEvent, AssistantTurnStatus } from "../app/api-types"
import { copyText } from "../app/clipboard"
import { invalidateTransactionData } from "../app/transactions"
import { maskTextAmounts, usePrivacy } from "../app/privacy"
import { Button, IconButton } from "../components/ui/Button"
import {
  ChatActions,
  ChatActivity,
  ChatApproval,
  ChatBubble,
  ChatComposer,
  ChatMarkdown,
  ChatRecent,
  ChatRecentMenu,
  ChatThread,
  ChatTurn,
  type ChatRecentEntry,
} from "../components/ui/Chat"
import { Status } from "../components/ui/EmptyState"
import { LoadingBody, Panel } from "../components/ui/Panel"
import { PeekLayout } from "../components/ui/Peek"

type Turn = {
  key: string
  userText: string
  items: AssistantItem[]
  status: AssistantTurnStatus | "streaming"
  error: string | null
  // Streamed on this page, so its question and words animate in.
  live: boolean
  // The server has the question, so Retry answers it again there.
  received: boolean
}

type ActivityItem = Exclude<AssistantItem, { kind: "text" } | { kind: "approval" }>
type TextItem = Extract<AssistantItem, { kind: "text" }>
type ApprovalItem = Extract<AssistantItem, { kind: "approval" }>
type Segment =
  | { kind: "activity"; key: string; items: ActivityItem[] }
  | { kind: "text"; key: string; item: TextItem }
  | { kind: "approval"; key: string; item: ApprovalItem }

const CHATS_KEY = ["assistant", "chats"]
const SAVED_FAILURE = "This answer didn't finish."
const LOST_CONNECTION = "The connection to the server was lost. Try again."

let turnCounter = 0
function nextTurnKey(): string {
  turnCounter += 1
  return `live-${turnCounter}`
}

function savedTurns(chat: AssistantChat): Turn[] {
  return chat.turns.map((turn) => ({
    key: `turn-${turn.id}`,
    userText: turn.user_text,
    items: turn.items,
    status: turn.status,
    error: turn.status === "failed" ? SAVED_FAILURE : null,
    live: false,
    received: true,
  }))
}

// Steps between answer text and approval cards fold into one activity line each.
function segments(items: AssistantItem[]): Segment[] {
  const result: Segment[] = []
  for (const item of items) {
    if (item.kind === "text" || item.kind === "approval") {
      result.push(item.kind === "text" ? { kind: "text", key: item.id, item } : { kind: "approval", key: item.id, item })
      continue
    }
    const last = result[result.length - 1]
    if (last?.kind === "activity") last.items.push(item)
    else result.push({ kind: "activity", key: item.id, items: [item] })
  }
  return result
}

function applyEvents(turn: Turn, events: AssistantStreamEvent[]): Turn {
  let { items, status, error } = turn
  for (const event of events) {
    if (event.type === "item") {
      const found = items.some((item) => item.id === event.item.id)
      items = found ? items.map((item) => (item.id === event.item.id ? event.item : item)) : [...items, event.item]
    } else if (event.type === "delta") {
      items = items.map((item) =>
        item.id === event.id && item.kind !== "tool" && item.kind !== "approval" ? { ...item, text: item.text + event.text } : item
      )
    } else if (event.type === "end") {
      status = event.status
      error = event.status === "failed" ? (event.message ?? SAVED_FAILURE) : null
    }
  }
  return { ...turn, items, status, error }
}

// What a stopped or broken stream leaves open, settled the way the server saves it.
function settle(items: AssistantItem[], status: AssistantTurnStatus): AssistantItem[] {
  return items.map((item) => {
    if (item.kind === "tool" && item.state === "running") return { ...item, state: status === "stopped" ? "stopped" : "failed" }
    if ((item.kind === "thinking" || item.kind === "note") && item.state === "active") return { ...item, state: "done" }
    if (item.kind === "text" && item.state === "streaming") return { ...item, state: "done" }
    return item
  })
}

function answerText(items: AssistantItem[]): string {
  return items
    .filter((item) => item.kind === "text")
    .map((item) => item.text)
    .join("\n\n")
}

function maskItem(item: AssistantItem): AssistantItem {
  if (item.kind === "tool") return { ...item, label: maskTextAmounts(item.label), detail: item.detail === null ? null : maskTextAmounts(item.detail) }
  if (item.kind === "approval") {
    const mask = (text: string | null) => (text === null ? null : maskTextAmounts(text))
    return {
      ...item,
      message: mask(item.message),
      card: {
        ...item.card,
        title: maskTextAmounts(item.card.title),
        meta: mask(item.card.meta),
        rows: item.card.rows.map((row) => ({ ...row, detail: mask(row.detail) })),
      },
    }
  }
  return { ...item, text: maskTextAmounts(item.text) }
}

// Sending a new message leaves open cards undecided; the server dismisses them the same way.
function dismissPending(turn: Turn): Turn {
  if (!turn.items.some((item) => item.kind === "approval" && item.state === "pending")) return turn
  return { ...turn, items: turn.items.map((item) => (item.kind === "approval" && item.state === "pending" ? { ...item, state: "dismissed" } : item)) }
}

function changedData(items: AssistantItem[]): boolean {
  return items.some((item) => item.kind === "approval" && item.state === "applied")
}

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short" })
// en-US, because en-GB writes September as "Sept".
const SHORT_MONTH = new Intl.DateTimeFormat("en-US", { month: "short" })

// "Today", "Yesterday", "Mon", "8 Oct", "8 Oct 2025". The server stores UTC without a zone.
function chatWhen(updatedAt: string, now: Date): string {
  const date = new Date(/(Z|[+-]\d\d:\d\d)$/.test(updatedAt) ? updatedAt : `${updatedAt}Z`)
  const days = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) /
      86_400_000
  )
  if (days <= 0) return "Today"
  if (days === 1) return "Yesterday"
  if (days < 7) return WEEKDAY.format(date)
  const dayMonth = `${date.getDate()} ${SHORT_MONTH.format(date)}`
  return date.getFullYear() === now.getFullYear() ? dayMonth : `${dayMonth} ${date.getFullYear()}`
}

function recentEntries(chats: AssistantChatSummary[] | undefined): ChatRecentEntry[] {
  const now = new Date()
  return (chats ?? []).map((chat) => ({ id: chat.id, title: chat.title, when: chatWhen(chat.updated_at, now) }))
}

function CopyButton({ copied, label, onCopy }: { copied: boolean; label: string; onCopy: () => void }) {
  return <IconButton icon={copied ? CheckIcon : CopyIcon} size="small" label={copied ? "Copied" : label} onClick={onCopy} />
}

// One chat. The page remounts it to open another chat, so its state never mixes two chats.
function Conversation({
  initialChat,
  recent,
  onOpen,
  onChatStarted,
}: {
  initialChat: string | null
  recent: ChatRecentEntry[]
  onOpen: (id: string) => void
  onChatStarted: (id: string) => void
}) {
  const queryClient = useQueryClient()
  const [turns, setTurns] = useState<Turn[]>([])
  const [loading, setLoading] = useState(initialChat !== null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState("")
  const [answerReserve, setAnswerReserve] = useState<{ key: string; px: number } | null>(null)
  const chatIdRef = useRef(initialChat)
  const abortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const threadRef = useRef<HTMLDivElement | null>(null)
  const pendingScrollRef = useRef<string | null>(null)
  const scrollToEndRef = useRef(false)
  const copyTimerRef = useRef<number | null>(null)
  const queueRef = useRef<AssistantStreamEvent[]>([])
  const frameRef = useRef<number | null>(null)
  // Privacy mode masks amounts in the conversation; copying keeps the exact text.
  const privacy = usePrivacy()
  const shown = (text: string) => (privacy ? maskTextAmounts(text) : text)

  // Leaving the chat stops its answer; the server keeps what was written so far.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current)
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
    }
  }, [])

  useEffect(() => {
    if (!initialChat) return
    let cancelled = false
    fetchAssistantChat(initialChat)
      .then((chat) => {
        if (cancelled) return
        scrollToEndRef.current = true
        setTurns(savedTurns(chat))
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(getApiErrorMessage(error, "This chat couldn't be loaded."))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [initialChat])

  // Sending scrolls the question to the top of the thread and reserves just enough
  // space below it for the reply to render in reading position; the reserve is
  // consumed as the answer grows. An opened chat starts at its latest turn.
  useLayoutEffect(() => {
    const thread = threadRef.current
    if (!thread) return
    if (scrollToEndRef.current) {
      scrollToEndRef.current = false
      thread.scrollTop = thread.scrollHeight
      return
    }
    const key = pendingScrollRef.current
    const userEl = key ? thread.querySelector<HTMLElement>(`[data-turn-id="${key}-q"]`) : null
    if (!key || !userEl) return
    pendingScrollRef.current = null
    setAnswerReserve({ key, px: Math.max(0, thread.clientHeight - userEl.offsetHeight - 64) })
    window.requestAnimationFrame(() => {
      const top = userEl.getBoundingClientRect().top - thread.getBoundingClientRect().top + thread.scrollTop - 20
      thread.scrollTo({ top: Math.max(0, top), behavior: "smooth" })
    })
  }, [turns])

  // The newest turn can be taller than its content (the answer reserve),
  // so the return-to-latest control keys off where rendered content actually ends.
  const latestContentOverflow = useCallback(() => {
    const thread = threadRef.current
    const body = thread?.querySelector("[data-turn-id]:last-of-type > [data-turn-body]")
    if (!thread || !body) return null
    return body.getBoundingClientRect().bottom - thread.getBoundingClientRect().bottom
  }, [])

  const updateScrollPill = useCallback(() => {
    const overflow = latestContentOverflow()
    setShowScrollToBottom(overflow !== null && overflow > 48)
  }, [latestContentOverflow])

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateScrollPill)
    return () => window.cancelAnimationFrame(frame)
  }, [turns, updateScrollPill])

  const scrollToBottom = useCallback(() => {
    const thread = threadRef.current
    const overflow = latestContentOverflow()
    if (!thread || overflow === null) return
    thread.scrollTo({ top: thread.scrollTop + overflow + 24, behavior: "smooth" })
    setShowScrollToBottom(false)
  }, [latestContentOverflow])

  // Stream events land once per frame, so a fast stream renders at most one update per frame.
  const flush = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    const events = queueRef.current
    if (events.length === 0) return
    queueRef.current = []
    setTurns((prev) => prev.map((turn, index) => (index === prev.length - 1 ? applyEvents(turn, events) : turn)))
  }, [])

  const runStream = useCallback(
    async (stream: (signal: AbortSignal) => AsyncGenerator<AssistantStreamEvent>) => {
      const controller = new AbortController()
      abortRef.current = controller
      setBusy(true)
      setAnnouncement("Assistant is working")
      // A copy of the turn's events, for the announcement once it ends.
      let local: Turn = { key: "", userText: "", items: [], status: "streaming", error: null, live: true, received: true }
      let failure: string | null = null
      try {
        for await (const event of stream(controller.signal)) {
          if (event.type === "start") {
            chatIdRef.current = event.chat_id
            onChatStarted(event.chat_id)
            setTurns((prev) => prev.map((turn, index) => (index === prev.length - 1 ? { ...turn, received: true } : turn)))
            continue
          }
          local = applyEvents(local, [event])
          queueRef.current.push(event)
          if (frameRef.current === null) frameRef.current = window.requestAnimationFrame(flush)
        }
      } catch (error) {
        if (!controller.signal.aborted) failure = error instanceof Error ? error.message : LOST_CONNECTION
      }
      flush()
      abortRef.current = null
      setBusy(false)
      void queryClient.invalidateQueries({ queryKey: CHATS_KEY })
      // An approved change touched the ledger, so the views showing it refetch.
      if (local.items.some((item) => item.kind === "approval" && item.state === "applied")) invalidateTransactionData(queryClient)
      let status: AssistantTurnStatus = "failed"
      let error = failure ?? LOST_CONNECTION
      if (local.status !== "streaming") {
        status = local.status
        error = local.error ?? SAVED_FAILURE
      } else if (controller.signal.aborted) {
        status = "stopped"
      }
      setTurns((prev) =>
        prev.map((turn, index) =>
          index === prev.length - 1
            ? { ...turn, status, error: status === "failed" ? error : null, items: status === "completed" ? turn.items : settle(turn.items, status) }
            : turn
        )
      )
      if (status === "completed") setAnnouncement(answerText(local.items))
      else if (status === "stopped") setAnnouncement("Response stopped")
      else setAnnouncement(error)
    },
    [flush, onChatStarted, queryClient]
  )

  const sendMessage = useCallback(
    (raw: string) => {
      const text = raw.trim()
      if (!text || abortRef.current) return
      const key = nextTurnKey()
      pendingScrollRef.current = key
      setTurns((prev) => [...prev.map(dismissPending), { key, userText: text, items: [], status: "streaming", error: null, live: true, received: false }])
      setInput("")
      if (window.matchMedia("(min-width: 861px)").matches) {
        window.requestAnimationFrame(() => inputRef.current?.focus())
      }
      const id = chatIdRef.current
      void runStream((signal) => streamAssistantMessage(id, text, signal))
    },
    [runStream]
  )

  // Answers the last question again, replacing its answer.
  const retryLast = useCallback(() => {
    const id = chatIdRef.current
    const last = turns[turns.length - 1]
    if (!last || abortRef.current) return
    // A message the server never received has no turn to retry, so it is sent again.
    if (!id || !last.received) {
      setTurns((prev) => prev.slice(0, -1))
      sendMessage(last.userText)
      return
    }
    pendingScrollRef.current = last.key
    setTurns((prev) =>
      prev.map((turn, index) => (index === prev.length - 1 ? { ...turn, items: [], status: "streaming", error: null, live: true } : turn))
    )
    void runStream((signal) => streamAssistantRetry(id, signal))
  }, [runStream, sendMessage, turns])

  // Approving applies the change on the server before the same turn continues.
  const decide = useCallback(
    (itemId: string, approve: boolean) => {
      const id = chatIdRef.current
      if (!id || abortRef.current) return
      setTurns((prev) => prev.map((turn, index) => (index === prev.length - 1 ? { ...turn, status: "streaming", error: null, live: true } : turn)))
      void runStream((signal) => streamAssistantDecision(id, itemId, approve, signal))
    },
    [runStream]
  )

  const handleCopy = useCallback((key: string, content: string) => {
    copyText(content)
    setCopiedKey(key)
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current)
    copyTimerRef.current = window.setTimeout(() => setCopiedKey(null), 2000)
  }, [])

  const empty = turns.length === 0
  const lastIndex = turns.length - 1
  let body: ReactNode
  if (loading) {
    body = <LoadingBody label="Loading chat" />
  } else if (loadError) {
    body = (
      <Status icon={WarningCircleIcon} tone="bad" wrap>
        {loadError}
      </Status>
    )
  } else if (empty) {
    body = <ChatRecent chats={recent.slice(0, 5)} onOpen={onOpen} />
  } else {
    body = turns.map((turn, index) => {
      const streaming = turn.status === "streaming"
      const parts = segments(privacy ? turn.items.map(maskItem) : turn.items)
      const answer = answerText(turn.items)
      const isLast = index === lastIndex
      // An answer that changed data can't run again; undoing goes through the Assistant.
      const canRetry = isLast && !changedData(turn.items)
      return [
        <ChatTurn key={`${turn.key}-q`} id={`${turn.key}-q`} from="user">
          <ChatBubble enter={turn.live}>{shown(turn.userText)}</ChatBubble>
          <ChatActions>
            <CopyButton copied={copiedKey === `${turn.key}-q`} label="Copy message" onCopy={() => handleCopy(`${turn.key}-q`, turn.userText)} />
          </ChatActions>
        </ChatTurn>,
        <ChatTurn key={turn.key} id={turn.key} from="assistant" reserve={answerReserve?.key === turn.key ? answerReserve.px : undefined}>
          {streaming && parts.length === 0 ? <ChatActivity items={[]} working /> : null}
          {parts.map((part, partIndex) =>
            part.kind === "activity" ? (
              <ChatActivity key={part.key} items={part.items} working={streaming && partIndex === parts.length - 1} />
            ) : part.kind === "approval" ? (
              <ChatApproval
                key={part.key}
                item={part.item}
                enter={turn.live}
                disabled={busy}
                onDecide={(approve) => decide(part.item.id, approve)}
              />
            ) : (
              <ChatMarkdown key={part.key} content={part.item.text} animate={turn.live} partial={part.item.state === "streaming"} />
            )
          )}
          {turn.status === "stopped" ? <Status>Stopped</Status> : null}
          {turn.status === "failed" ? (
            <Status icon={WarningCircleIcon} tone="bad" wrap>
              {turn.error ?? SAVED_FAILURE}
            </Status>
          ) : null}
          {!streaming && (answer || canRetry) ? (
            <ChatActions>
              {answer ? (
                <CopyButton copied={copiedKey === turn.key} label="Copy response" onCopy={() => handleCopy(turn.key, answer)} />
              ) : null}
              {canRetry && turn.status === "failed" ? (
                <Button variant="ghost" size="small" icon={ArrowClockwiseIcon} disabled={busy} onClick={retryLast}>
                  Retry
                </Button>
              ) : canRetry ? (
                <IconButton icon={ArrowClockwiseIcon} size="small" label="Retry" disabled={busy} onClick={retryLast} />
              ) : null}
            </ChatActions>
          ) : null}
        </ChatTurn>,
      ]
    })
  }

  return (
    <>
      <ChatThread ref={threadRef} empty={empty} announcement={shown(announcement)} onScroll={updateScrollPill}>
        {body}
      </ChatThread>
      <ChatComposer
        ref={inputRef}
        value={input}
        onChange={setInput}
        onSend={() => sendMessage(input)}
        onStop={() => abortRef.current?.abort()}
        busy={busy}
        label="Message the Assistant"
        placeholder="Ask anything"
        onScrollToLatest={showScrollToBottom ? scrollToBottom : undefined}
      />
    </>
  )
}

// Loaded on first use: the transaction record brings the map library.
const TransactionPeek = lazy(() => import("./TransactionRecord").then((module) => ({ default: module.TransactionPeek })))

// The URL names the open chat and the transaction open beside it, so a reload returns to both.
function AssistantPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedChat = searchParams.get("chat")
  const peekId = Number(searchParams.get("peek")) || null
  const chatsQuery = useQuery({ queryKey: CHATS_KEY, queryFn: fetchAssistantChats })
  const recent = recentEntries(chatsQuery.data)
  const [view, setView] = useState({ key: 0, chat: requestedChat })
  // The chat the conversation shows. A chat it starts gets its id after the first message.
  const [openChatId, setOpenChatId] = useState(requestedChat)
  const [seenChat, setSeenChat] = useState(requestedChat)
  // Back, forward, and links change the URL without going through this page.
  if (requestedChat !== seenChat) {
    setSeenChat(requestedChat)
    if (requestedChat !== openChatId) {
      setOpenChatId(requestedChat)
      setView({ key: view.key + 1, chat: requestedChat })
    }
  }

  const open = (id: string | null) => {
    setOpenChatId(id)
    setView({ key: view.key + 1, chat: id })
    setSearchParams(id ? { chat: id } : {})
  }

  const closePeek = () => {
    const next = new URLSearchParams(searchParams)
    next.delete("peek")
    setSearchParams(next, { replace: true })
  }
  const peekLink = (id: number) => {
    const next = new URLSearchParams(searchParams)
    next.set("peek", String(id))
    return `/assistant?${next.toString()}`
  }
  const chatHref = requestedChat ? `/assistant?chat=${requestedChat}` : "/assistant"

  // The id is recorded before the URL changes, so the URL change is not taken for a new chat.
  const onChatStarted = useCallback(
    (id: string) => {
      setOpenChatId(id)
      setSearchParams({ chat: id }, { replace: true })
    },
    [setSearchParams]
  )

  return (
    <Panel
      title="Assistant"
      layout="fill"
      peekOpen={peekId !== null}
      actions={
        <>
          <ChatRecentMenu chats={recent} onOpen={open} trigger={<IconButton icon={ClockCounterClockwiseIcon} label="Recent chats" />} />
          <IconButton icon={NotePencilIcon} label="New chat" onClick={() => open(null)} />
        </>
      }
    >
      <PeekLayout
        flush
        main={<Conversation key={view.key} initialChat={view.chat} recent={recent} onOpen={open} onChatStarted={onChatStarted} />}
        peek={
          peekId ? (
            <Suspense fallback={null}>
              <TransactionPeek
                key={peekId}
                id={peekId}
                onClose={closePeek}
                linkTo={peekLink}
                fullViewTo={`/transactions/${peekId}`}
                fullViewState={{ returnTo: chatHref, returnLabel: "Assistant" }}
                parent="Assistant"
              />
            </Suspense>
          ) : null
        }
      />
    </Panel>
  )
}

export default AssistantPage
