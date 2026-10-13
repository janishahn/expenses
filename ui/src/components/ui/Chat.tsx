import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type UIEvent,
} from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkSmartypants from "remark-smartypants"
import { ArrowDownIcon } from "@phosphor-icons/react/ArrowDown"
import { ArrowUpIcon } from "@phosphor-icons/react/ArrowUp"
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight"
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle"
import { ListMagnifyingGlassIcon } from "@phosphor-icons/react/ListMagnifyingGlass"
import { StopIcon } from "@phosphor-icons/react/Stop"
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle"
import clsx from "clsx"
import { Pill } from "./Pill"
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

export function ChatBubble({ children }: { children: ReactNode }) {
  return <div className={s.bubble}>{children}</div>
}

export function ChatMarkdown({ content }: { content: string }) {
  return (
    <div className={clsx(s.md, s.chatMd)}>
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

export function ChatProgress({ children }: { children: ReactNode }) {
  return (
    <div className={s.progress}>
      <span aria-hidden="true" className={s.pulse} />
      <span className={s.progressText}>{children}</span>
    </div>
  )
}

// Copy and retry under a turn. On a pointer device the user's own turn shows them on hover.
export function ChatActions({ children }: { children: ReactNode }) {
  return <div className={s.msgActions}>{children}</div>
}

export type ChatToolStatus = "running" | "success" | "failed"

// Tool activity collapses to one line; opening it lists each ledger view.
export function ChatTools({ summary, failed, children }: { summary: string; failed: boolean; children: ReactNode }) {
  return (
    <details className={s.tools}>
      <summary className={clsx(s.toolSum, failed && s.statusBad)}>
        {failed ? <WarningCircleIcon aria-hidden="true" /> : <ListMagnifyingGlassIcon aria-hidden="true" />}
        <span className={s.progressText}>{summary}</span>
        <CaretRightIcon aria-hidden="true" className={s.toolCaret} />
      </summary>
      <div className={s.toolList}>{children}</div>
    </details>
  )
}

export function ChatToolItem({ status, label, detail, result }: { status: ChatToolStatus; label: string; detail: string; result: string | null }) {
  return (
    <div className={s.toolItem}>
      {status === "running" ? (
        <span role="img" aria-label="Running" className={clsx(s.pulse, s.pulseSmall)} />
      ) : status === "success" ? (
        <CheckCircleIcon role="img" aria-label="Done" className={s.in} />
      ) : (
        <WarningCircleIcon role="img" aria-label="Failed" className={s.over} />
      )}
      <span>
        {label}
        {detail ? <span className={s.faint}> {detail}</span> : null}
        {result ? <span className={s.toolResult}>{result}</span> : null}
      </span>
    </div>
  )
}

export function ChatEmpty({ title, prompts, onPrompt }: { title: string; prompts: string[]; onPrompt: (prompt: string) => void }) {
  return (
    <div className={s.chatEmpty}>
      <h2 className={s.chatEmptyTitle}>{title}</h2>
      <div className={s.prompts}>
        {prompts.map((prompt) => (
          <Pill key={prompt} onClick={() => onPrompt(prompt)}>
            {prompt}
          </Pill>
        ))}
      </div>
    </div>
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
            className={s.send}
            disabled={!busy && !canSend}
            onClick={busy ? onStop : undefined}
          >
            {busy ? <StopIcon aria-hidden="true" weight="fill" /> : <ArrowUpIcon aria-hidden="true" weight="bold" />}
          </button>
        </Tooltip>
      </div>
    </form>
  )
})
