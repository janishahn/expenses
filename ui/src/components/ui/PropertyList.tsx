import { forwardRef, useState, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from "react"
import clsx from "clsx"
import s from "./kit.module.css"

export function PropertyList({ wide = false, children }: { wide?: boolean; children: ReactNode }) {
  return <div className={clsx(s.props, wide && s.propsWide)}>{children}</div>
}

// One label and value. Editable values pass a PropertyButton (usually a picker trigger) or an
// InlineText as children and set `editable`; static values are plain children.
export function Property({
  label,
  editable = false,
  error,
  children,
}: {
  label: string
  editable?: boolean
  // A failed save keeps the entered value and shows the error at the field.
  error?: string | null
  children: ReactNode
}) {
  return (
    <>
      <span className={s.pl}>{label}</span>
      <div className={s.pvCell}>
        {editable ? children : <div className={s.pv}>{children}</div>}
        {error ? (
          <span role="alert" className={s.errText}>
            {error}
          </span>
        ) : null}
      </div>
    </>
  )
}

// A value that opens its editor. Empty values read "None" in ink-3.
export const PropertyButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { empty?: boolean }>(
  function PropertyButton({ empty = false, className, children, type = "button", ...props }, ref) {
    return (
      <button ref={ref} type={type} className={clsx(s.pv, s.ed, empty && s.faint, className)} {...props}>
        {children}
      </button>
    )
  }
)

// Text edited in place: click to edit, Enter or blur saves, Esc cancels. Used for titles,
// amounts, and notes in peeks and full views.
export function InlineText({
  value,
  onSave,
  label,
  variant = "plain",
  multiline = false,
  placeholder,
  inputMode,
  display,
  error,
}: {
  value: string
  // Returns false when the value is invalid; the editor then stays open with the entered text.
  onSave: (next: string) => boolean | void | Promise<boolean | void>
  label: string
  variant?: "title" | "amount" | "plain"
  multiline?: boolean
  placeholder?: string
  inputMode?: "decimal" | "text"
  // How the value reads when not editing; defaults to the raw value.
  display?: ReactNode
  error?: string | null
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const className = clsx(variant === "title" && s.pkTitle, variant === "amount" && s.pkAmt, variant === "plain" && s.notes)

  const commit = async () => {
    if (draft === null) return
    if (draft === value) {
      setDraft(null)
      return
    }
    const result = await onSave(draft)
    if (result !== false) setDraft(null)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      setDraft(null)
    } else if (event.key === "Enter" && (!multiline || event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void commit()
    }
  }

  if (draft === null && !error) {
    return (
      <button
        type="button"
        aria-label={`Edit ${label}`}
        className={clsx(className, s.ed, !value && s.faint)}
        onClick={() => setDraft(value)}
      >
        {value ? (display ?? value) : placeholder}
      </button>
    )
  }
  const shared = {
    autoFocus: true,
    "aria-label": label,
    "aria-invalid": error ? true : undefined,
    value: draft ?? value,
    placeholder,
    onBlur: () => void commit(),
    onKeyDown,
  }
  return (
    <div>
      {multiline ? (
        <textarea
          {...shared}
          rows={3}
          className={clsx(className, s.inlineInput)}
          onChange={(event) => setDraft(event.target.value)}
        />
      ) : (
        <input
          {...shared}
          inputMode={inputMode}
          className={clsx(className, s.inlineInput)}
          onChange={(event) => setDraft(event.target.value)}
        />
      )}
      {error ? (
        <span role="alert" className={s.errText}>
          {error}
        </span>
      ) : null}
    </div>
  )
}
