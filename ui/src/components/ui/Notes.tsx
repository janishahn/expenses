import { lazy, Suspense, useRef, useState, type KeyboardEvent, type MouseEvent } from "react"
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import clsx from "clsx"
import { IconButton } from "./Button"
import { PeekSection } from "./Peek"
import s from "./kit.module.css"

const NotesEditor = lazy(() => import("./NotesEditor"))

// The Notes section of a peek or full view: Markdown, edited in place. Blur or ⌘/Ctrl+Enter
// saves, Esc cancels. A failed save keeps the editor open with the entered text.
export function Notes({
  value,
  onSave,
  error,
}: {
  value: string
  // Returns false when the save failed.
  onSave: (next: string) => boolean | void | Promise<boolean | void>
  error?: string | null
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const editing = draft !== null
  // The editor blurs as it unmounts after Esc or a save; only a blur during an open edit may save.
  const open = useRef(false)

  const edit = (text: string) => {
    open.current = true
    setDraft(text)
  }
  const close = () => {
    open.current = false
    setDraft(null)
  }
  const commit = async () => {
    if (draft === null || !open.current) return
    if (draft.trim() === value.trim()) {
      close()
      return
    }
    open.current = false
    const result = await onSave(draft.trim())
    if (result === false) open.current = true
    else close()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      close()
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void commit()
    }
  }
  // Clicking the text edits it too, except on its links.
  const onTextClick = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("a")) return
    edit(value)
  }

  return (
    <PeekSection
      title="Notes"
      action={
        editing || !value ? null : (
          <IconButton icon={PencilSimpleIcon} label="Edit notes" size="small" onClick={() => edit(value)} />
        )
      }
    >
      {editing ? (
        <div className={clsx(s.notes, s.notesEditing)} onKeyDown={onKeyDown}>
          <Suspense fallback={<div className={s.md}>{draft}</div>}>
            <NotesEditor value={draft} label="Notes" onChange={setDraft} onBlur={() => void commit()} />
          </Suspense>
        </div>
      ) : value ? (
        <div className={clsx(s.notes, s.md, s.notesText)} onClick={onTextClick}>
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ node, ...props }) => {
                void node
                return <a {...props} target="_blank" rel="noreferrer" />
              },
            }}
          >
            {value}
          </Markdown>
        </div>
      ) : (
        <button type="button" className={clsx(s.notes, s.ed, s.faint)} onClick={() => edit("")}>
          Add notes
        </button>
      )}
      {error ? (
        <span role="alert" className={s.errText}>
          {error}
        </span>
      ) : null}
    </PeekSection>
  )
}
