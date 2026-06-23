import { useEffect } from "react"
import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { Markdown } from "tiptap-markdown"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import type { Editor } from "@tiptap/core"

type DescriptionEditorProps = {
  value: string
  onChange: (md: string) => void
  placeholder?: string
  className?: string
  minHeight?: string
}

type MarkdownStorage = {
  markdown: {
    getMarkdown: () => string
  }
}

const placeholderKey = new PluginKey("placeholder")

function placeholderPlugin(text: string) {
  return new Plugin({
    key: placeholderKey,
    props: {
      decorations(state) {
        const doc = state.doc
        if (
          doc.childCount === 1 &&
          doc.firstChild?.isTextblock &&
          doc.firstChild.content.size === 0
        ) {
          return DecorationSet.create(doc, [
            Decoration.node(0, doc.firstChild.nodeSize, {
              class: "is-placeholder",
              "data-placeholder": text,
            }),
          ])
        }
        return DecorationSet.empty
      },
    },
  })
}

function getMarkdown(editor: Editor): string {
  const md = editor.storage as unknown as MarkdownStorage
  return md.markdown.getMarkdown()
}

function DescriptionEditor({
  value,
  onChange,
  placeholder = "",
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

  useEffect(() => {
    if (!editor || !placeholder || placeholderKey.get(editor.view.state)) {
      return
    }
    editor.registerPlugin(placeholderPlugin(placeholder))
  }, [editor, placeholder])

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
