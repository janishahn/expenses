import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react"
import type { Icon } from "@phosphor-icons/react"
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown"
import clsx from "clsx"
import s from "./kit.module.css"

const FieldContext = createContext<{ id?: string; errorId?: string; invalid: boolean }>({ invalid: false })

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  icon?: Icon
  // Unit or trailing text inside the field, such as "%" or "€".
  suffix?: ReactNode
  invalid?: boolean
  // A few characters wide, such as a percentage or a number of days.
  short?: boolean
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { icon: IconComponent, suffix, invalid, short, id, className, ...props },
  ref
) {
  const field = useContext(FieldContext)
  const isInvalid = invalid ?? field.invalid
  return (
    <span className={clsx(s.input, isInvalid && s.inputErr, short && s.inputShort, className)}>
      {IconComponent ? <IconComponent aria-hidden="true" /> : null}
      <input
        ref={ref}
        id={id ?? field.id}
        aria-invalid={isInvalid || undefined}
        aria-describedby={isInvalid ? field.errorId : undefined}
        {...props}
      />
      {suffix != null ? <span className={s.inputSuffix}>{suffix}</span> : null}
    </span>
  )
})

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function TextArea({ invalid, id, ...props }, ref) {
    const field = useContext(FieldContext)
    const isInvalid = invalid ?? field.invalid
    return (
      <span className={clsx(s.textarea, isInvalid && s.inputErr)}>
        <textarea
          ref={ref}
          id={id ?? field.id}
          aria-invalid={isInvalid || undefined}
          aria-describedby={isInvalid ? field.errorId : undefined}
          {...props}
        />
      </span>
    )
  }
)

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { id, children, ...props },
  ref
) {
  const field = useContext(FieldContext)
  return (
    <span className={clsx(s.input, field.invalid && s.inputErr)}>
      <select ref={ref} id={id ?? field.id} {...props}>
        {children}
      </select>
      <CaretDownIcon aria-hidden="true" />
    </span>
  )
})

// Label column plus control column; one column on mobile. `stacked` puts labels above
// their controls on every layout, for narrow sheets such as sign in.
export function FieldGrid({
  narrow = false,
  stacked = false,
  children,
}: {
  narrow?: boolean
  stacked?: boolean
  children: ReactNode
}) {
  return <div className={clsx(s.form, narrow && s.formNarrow, stacked && s.formStacked)}>{children}</div>
}

export function Field({
  label,
  error,
  full = false,
  children,
}: {
  label: ReactNode
  // Shown under the control; the control is marked invalid.
  error?: string | null
  // Spans both columns, for controls such as notes that need the width.
  full?: boolean
  children: ReactNode
}) {
  const id = useId()
  const errorId = `${id}-error`
  return (
    <FieldContext.Provider value={{ id, errorId, invalid: Boolean(error) }}>
      <label htmlFor={id} className={clsx(s.fl, full && s.formFull)}>
        {label}
      </label>
      <div className={clsx(s.fieldCtl, full && s.formFull)}>
        {children}
        {error ? (
          <span id={errorId} role="alert" className={s.errText}>
            {error}
          </span>
        ) : null}
      </div>
    </FieldContext.Provider>
  )
}

// A standalone error line, for errors that belong to a control outside a Field.
export function FieldError({ children }: { children: ReactNode }) {
  return (
    <span role="alert" className={s.errText}>
      {children}
    </span>
  )
}
