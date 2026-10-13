import type { Icon } from "@phosphor-icons/react"
import { useRef, type KeyboardEvent } from "react"
import s from "./kit.module.css"

export type SegmentOption<T extends string> = {
  value: T
  label: string
  icon?: Icon
  // Icon-only segments still need a name.
  iconOnly?: boolean
  // A count after the label, such as the rows left to review.
  count?: number
}

// A radio group drawn as segments: page views, ranges, Expense/Income.
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  fullWidth = false,
}: {
  value: T
  options: ReadonlyArray<SegmentOption<T>>
  onChange: (value: T) => void
  label: string
  fullWidth?: boolean
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0
    if (!step) return
    event.preventDefault()
    const next = (index + step + options.length) % options.length
    onChange(options[next].value)
    refs.current[next]?.focus()
  }
  return (
    <span role="radiogroup" aria-label={label} className={s.seg} data-full={fullWidth || undefined}>
      {options.map((option, index) => {
        const checked = option.value === value
        const IconComponent = option.icon
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.iconOnly ? option.label : undefined}
            tabIndex={checked ? 0 : -1}
            className={s.segItem}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {IconComponent ? <IconComponent aria-hidden="true" /> : null}
            {option.iconOnly ? null : option.label}
            {option.count != null ? <span className={s.segCount}>{option.count}</span> : null}
          </button>
        )
      })}
    </span>
  )
}
