import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"

type TransactionDescriptionProps = {
  markdown: string | null | undefined
  compact?: boolean
  clamp?: boolean
  className?: string
}

function TransactionDescription({
  markdown,
  compact = false,
  clamp = false,
  className = "",
}: TransactionDescriptionProps) {
  const content = markdown?.trim()
  if (!content) {
    return null
  }

  const classes = [
    "transaction-markdown",
    compact ? "transaction-markdown-compact" : "",
    clamp ? "transaction-markdown-clamp" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <div className={classes}>
      <Markdown
        remarkPlugins={[remarkGfm]}
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

export default TransactionDescription
