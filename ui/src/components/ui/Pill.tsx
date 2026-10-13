import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react"
import type { Icon } from "@phosphor-icons/react"
import { XIcon } from "@phosphor-icons/react/X"
import clsx from "clsx"
import s from "./kit.module.css"

type PillProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: Icon
  // Leading content in place of an icon, such as a category glyph.
  leading?: ReactNode
  // A pill whose value is set shows the selected fill.
  set?: boolean
  // Shows an ✕ that clears the value without opening the pill.
  onClear?: () => void
  clearLabel?: string
}

// Filter pills, entry-dialog chips, and the sort pill.
export const Pill = forwardRef<HTMLButtonElement, PillProps>(function Pill(
  { icon: IconComponent, leading, set = false, onClear, clearLabel, className, children, type = "button", ...props },
  ref
) {
  const pill = (
    <button ref={ref} type={type} className={clsx(s.pill, set && s.pillSet, className)} {...props}>
      {IconComponent ? <IconComponent aria-hidden="true" /> : leading}
      <span className={s.pillLabel}>{children}</span>
    </button>
  )
  if (!onClear) return pill
  return (
    <span className={clsx(s.pill, s.pillSet)}>
      <button ref={ref} type={type} className={s.pillInner} {...props}>
        {IconComponent ? <IconComponent aria-hidden="true" /> : leading}
        <span className={s.pillLabel}>{children}</span>
      </button>
      <button type="button" className={s.pillX} aria-label={clearLabel ?? "Clear"} onClick={onClear}>
        <XIcon aria-hidden="true" />
      </button>
    </span>
  )
})
