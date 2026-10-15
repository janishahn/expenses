import { forwardRef, useId, type FormEvent, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react"
import clsx from "clsx"
import { Button } from "./Button"
import { Dialog } from "./Dialog"
import s from "./kit.module.css"

// Every create action: the Expense/Income control in the header, amount first in the large
// entry style, then the name, chips for the other properties, a preview line, and notes.
export function EntryDialog({
  open,
  onOpenChange,
  title,
  direction,
  templates,
  submitLabel,
  onSubmit,
  pending = false,
  submitDisabled = false,
  error,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  // The dialog's accessible name, shown when there is no direction control.
  title: string
  direction?: ReactNode
  // Template pills above the amount.
  templates?: ReactNode
  submitLabel: string
  onSubmit: () => void
  pending?: boolean
  submitDisabled?: boolean
  error?: string | null
  children: ReactNode
}) {
  const formId = useId()
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!pending && !submitDisabled) onSubmit()
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return
        onOpenChange(next)
      }}
      title={title}
      header={direction}
      footer={
        <>
          <span className={s.sp} />
          <Button variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" disabled={pending || submitDisabled}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit}>
        {templates ? <div className={s.tplRow}>{templates}</div> : null}
        {children}
        {error ? (
          <div className={s.dgPreview}>
            <span role="alert" className={s.errText}>
              {error}
            </span>
          </div>
        ) : null}
      </form>
    </Dialog>
  )
}

type EntryInputProps = InputHTMLAttributes<HTMLInputElement> & { error?: string | null; income?: boolean }

// The amount in the large entry style; income reads in the income tone.
export const EntryAmount = forwardRef<HTMLInputElement, EntryInputProps>(function EntryAmount(
  { error, income = false, ...props },
  ref
) {
  const errorId = useId()
  return (
    <>
      <input
        ref={ref}
        inputMode="decimal"
        autoComplete="off"
        aria-label="Amount"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={clsx(s.dgAmt, income && s.dgAmtIn)}
        {...props}
      />
      {error ? (
        <div className={s.dgPreview}>
          <span id={errorId} role="alert" className={s.errText}>
            {error}
          </span>
        </div>
      ) : null}
    </>
  )
})

export const EntryName = forwardRef<HTMLInputElement, EntryInputProps>(function EntryName({ error, ...props }, ref) {
  const errorId = useId()
  return (
    <>
      <input
        ref={ref}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={s.dgName}
        {...props}
      />
      {error ? (
        <div className={s.dgPreview}>
          <span id={errorId} role="alert" className={s.errText}>
            {error}
          </span>
        </div>
      ) : null}
    </>
  )
})

// Pills for the remaining properties; a set pill shows its value with the selected fill.
export function EntryChips({ children }: { children: ReactNode }) {
  return <div className={s.dgChips}>{children}</div>
}

// Derived values (next dates, matched count) in one muted line.
export function EntryPreview({ children }: { children: ReactNode }) {
  return <div className={s.dgPreview}>{children}</div>
}

export function EntryNotes(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={2} aria-label="Notes" placeholder="Notes" className={s.dgNotes} {...props} />
}
