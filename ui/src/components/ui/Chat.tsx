import {
  forwardRef,
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
import Markdown, { type Components } from "react-markdown"
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
import { Menu, MenuItem } from "./Menu"
import { Tooltip } from "./Tooltip"
import s from "./kit.module.css"

// The Assistant: one conversation column above a bottom-fixed composer.

export const ChatThread = forwardRef<
  HTMLDivElement,
  { empty: boolean; announcement: string; onScroll: (event: UIEvent<HTMLDivElement>) => void; children: ReactNode }
>(function ChatThread({ empty, announcement, onScroll, children }, ref) {
  return (
    <>
      <div ref={ref} role="log" aria-live="off" aria-label="Conversation" className={s.thread} onScroll={onScroll}>
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

const REMARK_PLUGINS = [remarkGfm, remarkSmartypants]
const WORD_PLUGINS = [rehypeWords]
const MARKDOWN_COMPONENTS: Components = {
  a: ({ node, ...props }) => {
    void node
    return <a {...props} target="_blank" rel="noreferrer" />
  },
}

export const ChatMarkdown = memo(function ChatMarkdown({
  content,
  animate = false,
  partial = false,
}: {
  content: string
  // Fade in words as they arrive. Only for answers streamed on this page.
  animate?: boolean
  // The text is still streaming.
  partial?: boolean
}) {
  return (
    <div className={clsx(s.md, s.chatMd)}>
      <Markdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={animate ? WORD_PLUGINS : undefined} components={MARKDOWN_COMPONENTS}>
        {partial ? healPartial(content) : content}
      </Markdown>
    </div>
  )
})

// Copy and retry under a turn. On a pointer device the user's own turn shows them on hover.
export function ChatActions({ children }: { children: ReactNode }) {
  return <div className={s.msgActions}>{children}</div>
}

type ActivityItem = Exclude<AssistantItem, { kind: "text" }>

function liveLabel(item: ActivityItem): string {
  if (item.kind === "thinking") return "Thinking"
  if (item.kind === "note") return item.text
  return item.label
}

function doneLabel(items: ActivityItem[]): string {
  const tools = items.filter((item) => item.kind === "tool")
  if (tools.length > 1) return `Reviewed ${tools.length} ledger views`
  if (tools.length === 1) return tools[0].label
  const seconds = items.reduce((total, item) => total + (item.kind === "thinking" ? (item.seconds ?? 0) : 0), 0)
  if (seconds > 0) return `Thought for ${seconds}s`
  const last = items[items.length - 1]
  return last ? liveLabel(last) : "Thought"
}

// A new label rises in while the old one leaves upward. A note that grows keeps its label.
function ActivityLabel({ labelKey, text, working }: { labelKey: string; text: string; working: boolean }) {
  const [shown, setShown] = useState({ key: labelKey, text })
  const [leaving, setLeaving] = useState<{ key: string; text: string } | null>(null)
  const [changed, setChanged] = useState(false)
  if (shown.key !== labelKey) {
    setLeaving(shown)
    setShown({ key: labelKey, text })
    setChanged(true)
  } else if (shown.text !== text) {
    setShown({ key: labelKey, text })
  }
  return (
    <span className={s.actLabel}>
      {leaving ? (
        <span key={`out-${leaving.key}`} aria-hidden="true" className={clsx(s.actText, s.actOut)} onAnimationEnd={() => setLeaving(null)}>
          {leaving.text}
        </span>
      ) : null}
      <span key={shown.key} className={clsx(s.actText, changed && s.actIn, working && s.working)}>
        {shown.text}
      </span>
    </span>
  )
}

function StepLead({ item }: { item: ActivityItem }) {
  if (item.kind === "note" || (item.kind === "tool" && item.state === "running") || (item.kind === "thinking" && item.state === "active")) {
    return <span className={s.stepLead} />
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
  let label: ReactNode = item.kind === "thinking" ? (item.state === "active" ? "Thinking" : `Thought for ${item.seconds ?? 1}s`) : liveLabel(item)
  if (item.kind === "thinking" && item.text) {
    label = (
      <button type="button" className={s.stepToggle} aria-expanded={summaryOpen} onClick={() => setSummaryOpen((open) => !open)}>
        {label}
      </button>
    )
  }
  return (
    <div className={clsx(s.step, entering && s.stepEnter, item.kind === "note" && s.stepNote)}>
      <StepLead item={item} />
      <div>
        <div className={clsx(s.stepLabel, running && s.working)}>{label}</div>
        {item.kind === "tool" && item.detail ? <div className={s.stepDetail}>{item.detail}</div> : null}
        {item.kind === "thinking" && item.text && summaryOpen ? (
          <div className={clsx(s.md, s.stepDetail, s.stepSummary)}>
            <Markdown remarkPlugins={REMARK_PLUGINS}>{item.text}</Markdown>
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

export type ChatRecentEntry = { id: string; title: string; when: string }

// The empty Assistant lists recent chats instead of suggested questions.
export function ChatRecent({ chats, onOpen }: { chats: ChatRecentEntry[]; onOpen: (id: string) => void }) {
  return (
    <div className={s.chatEmpty}>
      {chats.length > 0 ? (
        <section aria-labelledby="chat-recent-title" className={s.recent}>
          <h2 id="chat-recent-title" className={s.recentTitle}>
            Recent
          </h2>
          {chats.map((chat) => (
            <button key={chat.id} type="button" className={s.recentRow} onClick={() => onOpen(chat.id)}>
              <span className={s.recentText}>{chat.title}</span>
              <span className={s.recentWhen}>{chat.when}</span>
            </button>
          ))}
        </section>
      ) : null}
    </div>
  )
}

export function ChatRecentMenu({
  chats,
  onOpen,
  trigger,
}: {
  chats: ChatRecentEntry[]
  onOpen: (id: string) => void
  trigger: ReactElement
}) {
  return (
    <Menu label="Recent chats" trigger={trigger}>
      {chats.length > 0 ? (
        chats.map((chat) => (
          <MenuItem key={chat.id} end={chat.when} onSelect={() => onOpen(chat.id)}>
            <span className={s.recentText}>{chat.title}</span>
          </MenuItem>
        ))
      ) : (
        <MenuItem disabled>No chats yet</MenuItem>
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
    label: string
    placeholder: string
    // Shown above the composer when the newest content is below the fold.
    onScrollToLatest?: () => void
  }
>(function ChatComposer({ value, onChange, onSend, onStop, busy, label, placeholder, onScrollToLatest }, ref) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle(ref, () => inputRef.current as HTMLTextAreaElement)

  // The field grows with its text up to a limit, and shrinks back once the message is sent.
  useLayoutEffect(() => {
    const element = inputRef.current
    if (!element) return
    element.style.height = "auto"
    element.style.height = `${Math.min(element.scrollHeight, MAX_COMPOSER_HEIGHT)}px`
  }, [value])

  const canSend = value.trim().length > 0 && !busy
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
