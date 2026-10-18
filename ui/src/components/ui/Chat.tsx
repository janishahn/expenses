import {
  forwardRef,
  Fragment,
  memo,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type UIEvent,
} from "react"
import type { Element, ElementContent, Root, RootContent } from "hast"
import Markdown, { defaultUrlTransform, type Components } from "react-markdown"
import { Link, useSearchParams } from "react-router-dom"
import remarkGfm from "remark-gfm"
import remarkSmartypants from "remark-smartypants"
import { ArrowDownIcon } from "@phosphor-icons/react/ArrowDown"
import { ArrowUpIcon } from "@phosphor-icons/react/ArrowUp"
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight"
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle"
import { MinusCircleIcon } from "@phosphor-icons/react/MinusCircle"
import { StopIcon } from "@phosphor-icons/react/Stop"
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle"
import clsx from "clsx"
import type { AssistantItem } from "../../app/api-types"
import { maskedTextParts, maskTextAmounts, usePrivacy } from "../../app/privacy"
import { Amount } from "./Amount"
import { Button } from "./Button"
import { UNCATEGORIZED } from "./nav"
import { CategoryGlyph, UnknownGlyph } from "./CategoryGlyph"
import { Status } from "./EmptyState"
import { Menu, MenuItem } from "./Menu"
import { ErrorBody } from "./Panel"
import { Tooltip } from "./Tooltip"
import s from "./kit.module.css"

// The Assistant: one conversation column above a bottom-fixed composer.

export const ChatThread = forwardRef<
  HTMLDivElement,
  { empty: boolean; announcement: string; onScroll: (event: UIEvent<HTMLDivElement>) => void; children: ReactNode }
>(function ChatThread({ empty, announcement, onScroll, children }, ref) {
  return (
    <>
      <div
        ref={ref}
        role={empty ? undefined : "log"}
        aria-live={empty ? undefined : "off"}
        aria-label={empty ? undefined : "Conversation"}
        className={s.thread}
        onScroll={onScroll}
      >
        <div className={clsx(s.threadCol, !empty && s.threadTurns)}>{children}</div>
      </div>
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </>
  )
})

// The newest assistant turn reserves room below the question so the answer renders in reading position.
export function ChatTurn({ id, from, reserve, children }: { id: string; from: "user" | "assistant"; reserve?: number; children: ReactNode }) {
  return (
    <article
      data-turn-id={id}
      aria-label={from === "user" ? "You" : "Assistant"}
      className={clsx(s.turn, from === "user" && s.turnUser)}
      style={reserve ? { minHeight: reserve } : undefined}
    >
      <div data-turn-body="" className={s.turnBody}>
        {children}
      </div>
    </article>
  )
}

// A question sent from this page rises into place; loaded chats appear as they are.
export function ChatBubble({ enter = false, children }: { enter?: boolean; children: ReactNode }) {
  const [entering] = useState(enter)
  return <div className={clsx(s.bubble, entering && s.bubbleEnter)}>{children}</div>
}

// In privacy mode each amount in the text is covered like an Amount, at about its width.
export function PrivateText({ text }: { text: string }) {
  const privacy = usePrivacy()
  if (!privacy) return <>{text}</>
  return (
    <>
      {maskedTextParts(text).map((part, index) =>
        part.masked ? (
          <Fragment key={index}>
            <span className={s.mask} aria-hidden="true">
              {part.text}
            </span>
            <span className="sr-only">Hidden amount</span>
          </Fragment>
        ) : (
          part.text
        )
      )}
    </>
  )
}

// The same masks inside rendered Markdown.
function maskAmounts(node: Root | Element) {
  const children: (RootContent | ElementContent)[] = []
  for (const child of node.children) {
    if (child.type === "element") maskAmounts(child)
    if (child.type !== "text") {
      children.push(child)
      continue
    }
    for (const part of maskedTextParts(child.value)) {
      if (!part.masked) {
        children.push({ type: "text", value: part.text })
        continue
      }
      children.push(
        { type: "element", tagName: "span", properties: { className: [s.mask], ariaHidden: "true" }, children: [{ type: "text", value: part.text }] },
        { type: "element", tagName: "span", properties: { className: ["sr-only"] }, children: [{ type: "text", value: "Hidden amount" }] }
      )
    }
  }
  node.children = children as Element["children"]
}

function rehypeMaskAmounts() {
  return (tree: Root) => maskAmounts(tree)
}

// Splits text into word spans so streamed words fade in. Elements are keyed by their
// position among same-named siblings, so words already shown keep their spans and only
// new words mount.
function splitWords(node: Root | Element) {
  if (node.type === "element" && (node.tagName === "code" || node.tagName === "pre")) return
  const children: (RootContent | ElementContent)[] = []
  for (const child of node.children) {
    if (child.type === "element") splitWords(child)
    if (child.type !== "text") {
      children.push(child)
      continue
    }
    for (const part of child.value.split(/(\s+)/)) {
      if (!part) continue
      children.push(
        /^\s+$/.test(part)
          ? { type: "text", value: part }
          : { type: "element", tagName: "span", properties: { className: [s.word] }, children: [{ type: "text", value: part }] }
      )
    }
  }
  node.children = children as Element["children"]
}

function rehypeWords() {
  return (tree: Root) => splitWords(tree)
}

// Closes markup the stream has opened but not yet closed, so half-written bold or code
// does not flash as literal characters.
function healPartial(text: string): string {
  if ((text.match(/```/g)?.length ?? 0) % 2) return `${text}\n\`\`\``
  let healed = text
  if ((healed.match(/`/g)?.length ?? 0) % 2) healed += "`"
  if ((healed.match(/\*\*/g)?.length ?? 0) % 2) healed = healed.endsWith("**") ? healed.slice(0, -2) : `${healed}**`
  return healed
}

// The Assistant links a transaction a tool returned as [title](transaction:<id>).
const TRANSACTION_HREF = /^transaction:(\d+)$/

// Opens the transaction in the page's peek, which the URL names as on the ledger.
function TransactionLink({ id, children }: { id: string; children: ReactNode }) {
  const [searchParams] = useSearchParams()
  const next = new URLSearchParams(searchParams)
  next.set("peek", id)
  return (
    <Link to={{ search: next.toString() }} replace={searchParams.has("peek")}>
      {children}
    </Link>
  )
}

// The Assistant links a page as [Budgets](page:budgets).
const PAGE_PREFIX = "page:"
const PAGE_PATHS = new Map([
  ["dashboard", "/"],
  ["transactions", "/transactions"],
  ["uncategorized", UNCATEGORIZED],
  ["trash", "/transactions/deleted"],
  ["budgets", "/budgets"],
  ["insights", "/insights"],
  ["forecast", "/forecast"],
  ["recurring", "/recurring"],
  ["templates", "/templates"],
  ["rules", "/rules"],
  ["categories", "/categories"],
  ["tags", "/tags"],
  ["what-if", "/scenarios"],
  ["reconcile", "/reconciliation"],
  ["reports", "/reports/builder"],
  ["digest", "/digest"],
  ["settings", "/settings"],
])

const urlTransform = (url: string) =>
  TRANSACTION_HREF.test(url) || url.startsWith(PAGE_PREFIX) ? url : defaultUrlTransform(url)
const REMARK_PLUGINS = [remarkGfm, remarkSmartypants]
const WORD_PLUGINS = [rehypeWords]
const MASK_PLUGINS = [rehypeMaskAmounts]
const MASK_WORD_PLUGINS = [rehypeMaskAmounts, rehypeWords]
// Answers can quote imported transaction text, so they never load images: an image
// URL would send whatever it carries to another server as soon as it renders.
const NO_IMAGES = ["img"]
function heading(Tag: "h3" | "h4" | "h5" | "h6"): Components["h1"] {
  return ({ node, ...props }) => {
    void node
    return <Tag {...props} />
  }
}

const MARKDOWN_COMPONENTS: Components = {
  a: ({ node, href, ...props }) => {
    void node
    const transaction = href?.match(TRANSACTION_HREF)
    if (transaction) return <TransactionLink id={transaction[1]}>{props.children}</TransactionLink>
    if (href?.startsWith(PAGE_PREFIX)) {
      const path = PAGE_PATHS.get(href.slice(PAGE_PREFIX.length))
      return path ? <Link to={path}>{props.children}</Link> : <>{props.children}</>
    }
    return <a href={href} {...props} target="_blank" rel="noreferrer" />
  },
  // Answer headings rank below the page title and section headings.
  h1: heading("h3"),
  h2: heading("h4"),
  h3: heading("h5"),
  h4: heading("h6"),
  h5: heading("h6"),
  // Wide tables scroll sideways instead of breaking amounts.
  table: ({ node, ...props }) => {
    void node
    return (
      <div className={s.chatTable}>
        <table {...props} />
      </div>
    )
  },
}

export const ChatMarkdown = memo(function ChatMarkdown({
  content,
  animate = false,
  partial = false,
}: {
  content: string
  // Fade in words as they arrive. Only for answers streamed on this page; an answer
  // shown before keeps its words in place when the turn continues.
  animate?: boolean
  // The text is still streaming.
  partial?: boolean
}) {
  const [fadeWords] = useState(animate)
  const privacy = usePrivacy()
  return (
    <div className={clsx(s.md, s.chatMd)}>
      <Markdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={privacy ? (fadeWords ? MASK_WORD_PLUGINS : MASK_PLUGINS) : fadeWords ? WORD_PLUGINS : undefined}
        components={MARKDOWN_COMPONENTS}
        urlTransform={urlTransform}
        disallowedElements={NO_IMAGES}
      >
        {partial ? healPartial(content) : content}
      </Markdown>
    </div>
  )
})

// Copy and retry under a turn. On a pointer device the user's own turn shows them on hover.
export function ChatActions({ children }: { children: ReactNode }) {
  return <div className={s.msgActions}>{children}</div>
}

type ActivityItem = Exclude<AssistantItem, { kind: "text" } | { kind: "approval" }>
type ApprovalItem = Extract<AssistantItem, { kind: "approval" }>

function liveLabel(item: ActivityItem): string {
  if (item.kind === "thinking") return "Thinking"
  if (item.kind === "note") return item.text
  return item.label
}

function doneLabel(items: ActivityItem[]): string {
  const reads = items.filter((item) => item.kind === "tool").filter((item) => item.state === "done")
  if (reads.length > 1) return `Reviewed ${reads.length} ledger views`
  if (reads.length === 1) return reads[0].label
  const seconds = items.reduce((total, item) => total + (item.kind === "thinking" ? (item.seconds ?? 0) : 0), 0)
  if (seconds > 0) return `Thought for ${seconds}s`
  const last = items[items.length - 1]
  return !last || last.kind === "thinking" ? "Thought" : liveLabel(last)
}

// A new label rises in while the old one leaves upward. A note that grows, or a step that
// reads the same as the last, keeps its label.
function ActivityLabel({ labelKey, text, working }: { labelKey: string; text: string; working: boolean }) {
  // n counts the labels shown, so each one mounts once.
  const [shown, setShown] = useState({ key: labelKey, text, n: 0 })
  const [leaving, setLeaving] = useState<{ text: string; n: number } | null>(null)
  const [changed, setChanged] = useState(false)
  if (shown.key !== labelKey && shown.text !== text) {
    setLeaving(shown)
    setShown({ key: labelKey, text, n: shown.n + 1 })
    setChanged(true)
  } else if (shown.key !== labelKey || shown.text !== text) {
    setShown({ ...shown, key: labelKey, text })
  }
  return (
    <span className={s.actLabel}>
      {leaving ? (
        <span key={`out-${leaving.n}`} aria-hidden="true" className={clsx(s.actText, s.actOut)} onAnimationEnd={() => setLeaving(null)}>
          <PrivateText text={leaving.text} />
        </span>
      ) : null}
      <span key={shown.n} className={clsx(s.actText, changed && s.actIn, working && s.working)}>
        <PrivateText text={shown.text} />
      </span>
    </span>
  )
}

function StepLead({ item }: { item: ActivityItem }) {
  if (item.kind === "note") return <span className={s.stepLead} />
  if ((item.kind === "tool" && item.state === "running") || (item.kind === "thinking" && item.state === "active")) {
    return <span role="img" aria-label="Running" className={s.stepLead} />
  }
  if (item.kind === "tool" && item.state === "failed") {
    return <WarningCircleIcon role="img" aria-label="Failed" className={clsx(s.stepLead, s.stepFailed)} />
  }
  if (item.kind === "tool" && item.state === "stopped") {
    return <MinusCircleIcon role="img" aria-label="Stopped" className={s.stepLead} />
  }
  return <CheckCircleIcon role="img" aria-label="Done" className={s.stepLead} />
}

function ActivityStep({ item, enter, working }: { item: ActivityItem; enter: boolean; working: boolean }) {
  // Steps that arrive while the list is open rise in; the ones already there stay put.
  const [entering] = useState(enter)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const running = working && ((item.kind === "tool" && item.state === "running") || (item.kind === "thinking" && item.state === "active"))
  const privacy = usePrivacy()
  let label: ReactNode
  if (item.kind !== "thinking") label = <PrivateText text={liveLabel(item)} />
  else label = item.state === "active" ? "Thinking" : item.seconds === null ? "Thought" : `Thought for ${item.seconds}s`
  if (item.kind === "thinking" && item.text) {
    label = (
      <button type="button" className={s.stepToggle} aria-expanded={summaryOpen} onClick={() => setSummaryOpen((open) => !open)}>
        {label}
        <CaretRightIcon aria-hidden="true" className={s.actCaret} />
      </button>
    )
  }
  return (
    <div className={clsx(s.step, entering && s.stepEnter)}>
      <StepLead item={item} />
      <div>
        <div className={clsx(s.stepLabel, running && s.working)}>{label}</div>
        {item.kind === "tool" && item.detail ? (
          <div className={s.stepDetail}>
            <PrivateText text={item.detail} />
          </div>
        ) : null}
        {item.kind === "thinking" && item.text && summaryOpen ? (
          <div className={clsx(s.md, s.stepDetail, s.stepSummary)}>
            <Markdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={privacy ? MASK_PLUGINS : undefined} disallowedElements={NO_IMAGES}>
              {item.text}
            </Markdown>
          </div>
        ) : null}
      </div>
    </div>
  )
}

// Reasoning, progress notes, and ledger reads in one line. While the Assistant works the
// line names the current step; when the answer starts it folds into a summary. Opening it
// lists every step.
export function ChatActivity({ items, working }: { items: ActivityItem[]; working: boolean }) {
  const [open, setOpen] = useState(false)
  // The steps listed when the user opened the list; later ones rise in as they arrive.
  const [openedWith, setOpenedWith] = useState<ReadonlySet<string>>(new Set())
  const last = items[items.length - 1]
  const labelKey = working ? (last?.id ?? "start") : "done"
  const text = working ? (last ? liveLabel(last) : "Thinking") : doneLabel(items)
  const expandable = items.length > 1 || (last?.kind === "thinking" && last.text !== "") || last?.kind === "tool"
  // A retried answer starts over in the same line, closed.
  if (open && items.length === 0) setOpen(false)
  const head = (
    <>
      <ActivityLabel labelKey={labelKey} text={text} working={working} />
      <CaretRightIcon aria-hidden="true" className={clsx(s.actCaret, !expandable && s.actCaretHidden)} />
    </>
  )
  return (
    <div className={s.act}>
      {expandable ? (
        <button
          type="button"
          className={s.actHead}
          aria-expanded={open}
          onClick={() => {
            setOpenedWith(new Set(items.map((item) => item.id)))
            setOpen(!open)
          }}
        >
          {head}
        </button>
      ) : (
        <div className={s.actHead}>{head}</div>
      )}
      {open && expandable ? (
        <div className={s.steps}>
          {items.map((item) => (
            <ActivityStep key={item.id} item={item} enter={working && !openedWith.has(item.id)} working={working} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

// en-US, because en-GB writes September as "Sept".
const CARD_MONTH = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" })

// "15 Oct", or "15 Oct 2025" outside the current year.
function cardDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  const dayMonth = `${date.getUTCDate()} ${CARD_MONTH.format(date)}`
  return date.getUTCFullYear() === new Date().getFullYear() ? dayMonth : `${dayMonth} ${date.getUTCFullYear()}`
}

// A change the Assistant proposed. Nothing changes until the user approves it; the card
// then keeps the outcome in place of its buttons.
// Rows a card lists before the rest open on request.
const CARD_ROWS = 8

export function ChatApproval({
  item,
  enter,
  disabled,
  onDecide,
}: {
  item: ApprovalItem
  // Cards streamed on this page rise in; loaded chats show them as they are.
  enter: boolean
  disabled: boolean
  onDecide: (approve: boolean) => void
}) {
  const [entering] = useState(enter)
  // The outcome fades in only when it changes while the card is on screen.
  const [decidedHere] = useState(item.state === "pending")
  const [allRows, setAllRows] = useState(false)
  const privacy = usePrivacy()
  const { card } = item
  const rows = allRows ? card.rows : card.rows.slice(0, CARD_ROWS)
  let outcome: ReactNode = null
  if (item.state === "applied") {
    outcome = (
      <Status icon={CheckCircleIcon} tone="ok">
        {card.done}
      </Status>
    )
  } else if (item.state === "dismissed") {
    outcome = <Status icon={MinusCircleIcon}>Dismissed</Status>
  } else if (item.state === "failed") {
    outcome = (
      <Status icon={WarningCircleIcon} tone="bad" wrap>
        <PrivateText text={item.message ?? "Not applied"} />
      </Status>
    )
  }
  return (
    <section aria-label={privacy ? maskTextAmounts(card.title) : card.title} data-state={item.state} className={clsx(s.approval, entering && s.approvalEnter)}>
      <div className={s.approvalHead}>
        <b>
          <PrivateText text={card.title} />
        </b>
        {card.meta ? (
          <span>
            <PrivateText text={card.meta} />
          </span>
        ) : null}
      </div>
      <div className={s.approvalRows}>
        {rows.map((row, index) => (
          <div key={index} className={s.approvalRow}>
            {row.category ? (
              <CategoryGlyph categoryId={row.category.id} icon={row.category.icon} name={row.category.name} />
            ) : row.date ? (
              // A transaction without a category yet; rows such as the overall budget have no glyph.
              <UnknownGlyph />
            ) : (
              <span />
            )}
            <span className={s.approvalText}>
              <b>
                <PrivateText text={row.title} />
              </b>
              {row.detail || row.date ? (
                <span>
                  {row.detail ? <PrivateText text={row.detail} /> : null}
                  {row.date ? (
                    <span className={s.approvalSubDate}>
                      {row.detail ? " · " : ""}
                      {cardDate(row.date)}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </span>
            <span className={s.approvalDate}>{row.date ? cardDate(row.date) : null}</span>
            <span className={s.approvalAmount}>
              {row.amount_cents !== null ? <Amount cents={row.amount_cents} kind={row.income ? "income" : "expense"} /> : null}
              {row.of_cents !== null ? (
                <span className={s.approvalOf}>
                  {" of "}
                  <Amount cents={row.of_cents} kind="expense" />
                </span>
              ) : null}
            </span>
          </div>
        ))}
        {rows.length < card.rows.length ? (
          <div className={s.approvalMore}>
            <Button variant="ghost" size="small" onClick={() => setAllRows(true)}>
              Show {card.rows.length - rows.length} more
            </Button>
          </div>
        ) : null}
      </div>
      <div className={s.approvalFoot}>
        <span className={s.approvalTotal}>
          {card.total_cents !== null && card.total_of_cents !== null ? (
            <>
              <b>
                <Amount cents={card.total_cents} kind="expense" />
              </b>
              <span className={s.approvalOf}>
                {" of "}
                <Amount cents={card.total_of_cents} kind="expense" />
              </span>
            </>
          ) : null}
        </span>
        {item.state === "pending" ? (
          <div className={s.approvalChoices}>
            <Button variant="ghost" disabled={disabled} onClick={() => onDecide(false)}>
              Dismiss
            </Button>
            <Button variant="primary" disabled={disabled} onClick={() => onDecide(true)}>
              {card.verb}
            </Button>
          </div>
        ) : (
          <span className={clsx(s.approvalStatus, decidedHere && s.approvalStatusEnter)}>{outcome}</span>
        )}
      </div>
    </section>
  )
}

export type ChatRecentEntry = { id: string; title: string; when: string }

// The empty Assistant lists recent chats instead of suggested questions.
export function ChatRecent({ chats, onOpen }: { chats: ChatRecentEntry[]; onOpen: (id: string) => void }) {
  return (
    <div className={s.chatEmpty}>
      {chats.length > 0 ? (
        <section aria-labelledby="chat-recent-title" className={s.recent}>
          <h2 id="chat-recent-title" className={s.recentTitle}>
            Recent chats
          </h2>
          {chats.map((chat) => (
            <button key={chat.id} type="button" className={s.recentRow} onClick={() => onOpen(chat.id)}>
              <span className={s.recentText}>
                <PrivateText text={chat.title} />
              </span>
              <span className={s.recentWhen}>{chat.when}</span>
            </button>
          ))}
        </section>
      ) : null}
    </div>
  )
}

// A chat that failed to load, in the place of its turns. A missing one leads to a new chat.
export function ChatLoadError({ message, missing }: { message: string; missing: boolean }) {
  return (
    <div className={s.chatEmpty}>
      <ErrorBody message={message} returnTo={missing ? { label: "New chat", to: "/assistant" } : undefined} />
    </div>
  )
}

export function ChatRecentMenu({
  chats,
  status,
  onOpen,
  trigger,
}: {
  chats: ChatRecentEntry[]
  status: "loading" | "failed" | "loaded"
  onOpen: (id: string) => void
  trigger: ReactElement
}) {
  let placeholder = "No chats yet"
  if (status === "loading") placeholder = "Loading chats"
  else if (status === "failed") placeholder = "Couldn't load chats"
  return (
    <Menu label="Recent chats" trigger={trigger}>
      {chats.length > 0 ? (
        chats.map((chat) => (
          <MenuItem key={chat.id} end={<span className={s.tab}>{chat.when}</span>} onSelect={() => onOpen(chat.id)}>
            <span className={s.recentText}>
              <PrivateText text={chat.title} />
            </span>
          </MenuItem>
        ))
      ) : (
        <MenuItem disabled>{placeholder}</MenuItem>
      )}
    </Menu>
  )
}

const MAX_COMPOSER_HEIGHT = 160

// Enter sends and Shift+Enter starts a new line. While an answer streams, the send button stops it.
export const ChatComposer = forwardRef<
  HTMLTextAreaElement,
  {
    value: string
    onChange: (value: string) => void
    onSend: () => void
    onStop: () => void
    busy: boolean
    // Sending waits, such as while the chat loads.
    disabled: boolean
    label: string
    placeholder: string
    // Shown above the composer when the newest content is below the fold.
    onScrollToLatest?: () => void
  }
>(function ChatComposer({ value, onChange, onSend, onStop, busy, disabled, label, placeholder, onScrollToLatest }, ref) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle(ref, () => inputRef.current as HTMLTextAreaElement)

  // The field grows with its text up to a limit, and shrinks back once the message is sent.
  useLayoutEffect(() => {
    const element = inputRef.current
    if (!element) return
    element.style.height = "auto"
    element.style.height = `${Math.min(element.scrollHeight, MAX_COMPOSER_HEIGHT)}px`
  }, [value])

  const canSend = value.trim().length > 0 && !busy && !disabled
  return (
    <form
      className={s.composer}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        onSend()
      }}
    >
      {onScrollToLatest ? (
        <Tooltip label="Scroll to latest message" side="top">
          <button type="button" aria-label="Scroll to latest message" className={s.toLatest} onClick={onScrollToLatest}>
            <ArrowDownIcon aria-hidden="true" />
          </button>
        </Tooltip>
      ) : null}
      <div className={s.cmp}>
        <textarea
          ref={inputRef}
          aria-label={label}
          placeholder={placeholder}
          rows={1}
          value={value}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
          onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              onSend()
            }
          }}
        />
        <Tooltip label={busy ? "Stop" : "Send"} side="top">
          <button
            type={busy ? "button" : "submit"}
            aria-label={busy ? "Stop" : "Send"}
            data-busy={busy}
            className={s.send}
            disabled={!busy && !canSend}
            onClick={busy ? onStop : undefined}
          >
            <ArrowUpIcon aria-hidden="true" weight="bold" className={s.sendGo} />
            <StopIcon aria-hidden="true" weight="fill" className={s.sendStop} />
          </button>
        </Tooltip>
      </div>
    </form>
  )
})
