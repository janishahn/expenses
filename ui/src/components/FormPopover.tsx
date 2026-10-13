import { useState, type FormEvent, type ReactElement, type ReactNode } from "react"
import { Button } from "./ui/Button"
import { Popover, PopoverActions } from "./ui/Popover"
import { Field, FieldError, FieldGrid, TextField } from "./ui/TextField"

// A small editor for one property: fields, an error line, and a submit button. The owner keeps
// the draft; `onOpen` resets it and `onSubmit` returns whether the popover may close.
export function FormPopover({
  label,
  trigger,
  onOpen,
  onSubmit,
  error,
  submitLabel = "Save",
  extraAction,
  children,
}: {
  label: string
  trigger: ReactElement
  onOpen: () => void
  onSubmit: () => boolean
  error: string | null
  submitLabel?: string
  // A second action before the submit button, such as "Turn off"; it closes the popover.
  extraAction?: { label: string; onClick: () => void }
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (onSubmit()) setOpen(false)
  }
  return (
    <Popover
      form
      label={label}
      open={open}
      onOpenChange={(next) => {
        if (next) onOpen()
        setOpen(next)
      }}
      trigger={trigger}
    >
      <form onSubmit={submit}>
        <FieldGrid narrow>
          {children}
          {error ? <FieldError>{error}</FieldError> : null}
        </FieldGrid>
        <PopoverActions
          start={
            extraAction ? (
              <Button
                variant="ghost"
                size="small"
                onClick={() => {
                  setOpen(false)
                  extraAction.onClick()
                }}
              >
                {extraAction.label}
              </Button>
            ) : undefined
          }
        >
          <Button type="submit" variant="primary" size="small">
            {submitLabel}
          </Button>
        </PopoverActions>
      </form>
    </Popover>
  )
}

// One text value. `onSave` returns an error message to keep the popover open.
export function ValuePopover({
  label,
  value,
  inputMode,
  submitLabel,
  trigger,
  onSave,
}: {
  label: string
  value: string
  inputMode?: "decimal" | "numeric"
  submitLabel?: string
  trigger: ReactElement
  onSave: (value: string) => string | null
}) {
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState<string | null>(null)
  return (
    <FormPopover
      label={label}
      trigger={trigger}
      error={error}
      submitLabel={submitLabel}
      onOpen={() => {
        setDraft(value)
        setError(null)
      }}
      onSubmit={() => {
        if (draft === value) return true
        const failure = onSave(draft)
        setError(failure)
        return failure === null
      }}
    >
      <Field label={label}>
        <TextField
          autoFocus
          inputMode={inputMode}
          value={draft}
          aria-invalid={error ? true : undefined}
          onChange={(event) => setDraft(event.target.value)}
        />
      </Field>
    </FormPopover>
  )
}
