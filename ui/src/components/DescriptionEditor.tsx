import { useEffect } from "react"
import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { Markdown } from "tiptap-markdown"
import type { Editor } from "@tiptap/core"

type DescriptionEditorProps = {
  value: string
  onChange: (md: string) => void
  className?: string
  minHeight?: string
}

type MarkdownStorage = {
  markdown: {
    getMarkdown: () => string
  }
}

function getMarkdown(editor: Editor): string {
  const md = editor.storage as unknown as MarkdownStorage
  return md.markdown.getMarkdown()
}

function DescriptionEditor({
  value,
  onChange,
  className = "",
  minHeight,
}: DescriptionEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown.configure({ html: false }),
    ],
    content: value,
    onUpdate({ editor }) {
      onChange(getMarkdown(editor))
    },
    editorProps: {
      attributes: {
        class: "transaction-markdown",
      },
    },
  })

  useEffect(() => {
    if (!editor || value === getMarkdown(editor)) {
      return
    }
    editor.commands.setContent(value)
  }, [editor, value])

  return (
    <div
      className={`description-editor ${className}`}
      style={minHeight ? { minHeight } : undefined}
    >
      <EditorContent editor={editor} style={minHeight ? { minHeight } : undefined} />
    </div>
  )
}

export default DescriptionEditor
