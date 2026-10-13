import { useEffect, useRef } from "react"
import type { Editor } from "@tiptap/core"
import { EditorContent, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { Markdown } from "tiptap-markdown"
import s from "./kit.module.css"

type MarkdownStorage = { markdown: { getMarkdown: () => string } }

function getMarkdown(editor: Editor): string {
  return (editor.storage as unknown as MarkdownStorage).markdown.getMarkdown()
}

// The rich-text editor behind Notes, loaded only when someone edits.
export default function NotesEditor({
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
