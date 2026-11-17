import { useEffect, useRef, useState } from "react"
import type { Editor } from "@tiptap/core"
import { EditorContent, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { Markdown } from "tiptap-markdown"
import s from "./kit.module.css"

type MarkdownStorage = { markdown: { getMarkdown: () => string } }

function getMarkdown(editor: Editor): string {
  return (editor.storage as unknown as MarkdownStorage).markdown.getMarkdown()
}

// StarterKit has no table or task-list nodes, so the rich editor would flatten them.
const UNSUPPORTED_GFM = /^\s*\|.*\|\s*$|^\s*[-*+]\s+\[[ xX]\]\s/m

// The rich-text editor behind Notes, loaded only when someone edits. Notes with GFM tables or
// task lists are edited as plain Markdown so saving keeps them intact.
export default function NotesEditor(props: { value: string; label: string; onChange: (markdown: string) => void; onBlur: () => void }) {
  const [plain] = useState(() => UNSUPPORTED_GFM.test(props.value))
  return plain ? <PlainNotesEditor {...props} /> : <RichNotesEditor {...props} />
}

function PlainNotesEditor({
  value,
  label,
  onChange,
  onBlur,
}: {
  value: string
  label: string
  onChange: (markdown: string) => void
  onBlur: () => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const field = ref.current
    if (!field) return
    field.focus()
    field.setSelectionRange(field.value.length, field.value.length)
  }, [])
  return (
    <textarea
      ref={ref}
      className={s.notesSource}
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
    />
  )
}

function RichNotesEditor({
  value,
  label,
  onChange,
  onBlur,
}: {
  value: string
  label: string
  onChange: (markdown: string) => void
  onBlur: () => void
}) {
  const callbacks = useRef({ onChange, onBlur })
  useEffect(() => {
    callbacks.current = { onChange, onBlur }
  })
  const editor = useEditor({
    extensions: [StarterKit, Markdown.configure({ html: false })],
    content: value,
    autofocus: "end",
    onUpdate: ({ editor: current }) => callbacks.current.onChange(getMarkdown(current)),
    onBlur: () => callbacks.current.onBlur(),
    editorProps: {
      attributes: { class: s.md, role: "textbox", "aria-multiline": "true", "aria-label": label },
    },
  })
  return <EditorContent editor={editor} />
}
