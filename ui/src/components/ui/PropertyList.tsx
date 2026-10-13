import { createContext, forwardRef, useContext, useId, useState, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from "react"
import type { Icon } from "@phosphor-icons/react"
import { Link } from "react-router-dom"
import clsx from "clsx"
import s from "./kit.module.css"

// The property's label id, so a value button reads as "Type Expense".
const PropertyLabelContext = createContext<string | undefined>(undefined)

export function PropertyList({ wide = false, children }: { wide?: boolean; children: ReactNode }) {
  return <div className={clsx(s.props, wide && s.propsWide)}>{children}</div>
}

// One label and value. Editable values pass a PropertyButton (usually a picker trigger) or an
// InlineText as children and set `editable`; static values are plain children.
export function Property({
  label,
  editable = false,
  empty = false,
  strong = false,
  icon: IconComponent,
  error,
  children,
}: {
  label: string
  editable?: boolean
  // A static value that reads "None" or similar, in ink-3.
  empty?: boolean
  // The value that sums up the others, such as Net.
  strong?: boolean
  // A faint leading icon for a static value, such as the pin before coordinates.
  icon?: Icon
  // A failed save keeps the entered value and shows the error at the field.
  error?: string | null
  children: ReactNode
}) {
  const labelId = useId()
  return (
    <>
      <span className={s.pl} id={labelId}>
        {label}
      </span>
      <div className={s.pvCell}>
        {editable ? (
          <PropertyLabelContext.Provider value={labelId}>{children}</PropertyLabelContext.Provider>
        ) : (
          <div className={clsx(s.pv, empty && s.faint, strong && s.pvStrong)}>
            {IconComponent ? <IconComponent aria-hidden="true" className={s.faint} /> : null}
            {children}
          </div>
        )}
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
  function PropertyButton({ empty = false, className, children, type = "button", id, ...props }, ref) {
    const labelId = useContext(PropertyLabelContext)
    const ownId = useId()
    // Menu and popover triggers bring their own id.
    const buttonId = id ?? ownId
    return (
      <button
        ref={ref}
        type={type}
        id={buttonId}
        aria-labelledby={labelId ? `${labelId} ${buttonId}` : undefined}
        className={clsx(s.pv, s.ed, empty && s.faint, className)}
        {...props}
      >
        {children}
      </button>
    )
  }
)

// A linked record inside a value: a reimbursement, an allocation, the bank row.
export function PropertyLink({
  to,
  icon: IconComponent,
  iconTone,
  end,
  children,
}: {
  to: string
  icon?: Icon
  iconTone?: "income"
  // Trailing figure, such as the linked amount.
  end?: ReactNode
  children: ReactNode
}) {
  return (
    <Link to={to} className={s.recLink}>
      {IconComponent ? <IconComponent aria-hidden="true" className={iconTone === "income" ? s.in : s.faint} /> : null}
      <span className={s.recLinkText}>{children}</span>
      {end != null ? <span className={s.recLinkEnd}>{end}</span> : null}
    </Link>
  )
}

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
  detail,
  error,
  onCancel,
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
  // Muted text after the shown value, such as "every month" after an amount.
  detail?: ReactNode
  error?: string | null
  // Esc discards the entered text; the owner clears its error here.
  onCancel?: () => void
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
      onCancel?.()
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
        {detail != null ? <span className={s.pkAmtDetail}> {detail}</span> : null}
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
