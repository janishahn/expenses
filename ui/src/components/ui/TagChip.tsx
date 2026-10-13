import type { ReactNode } from "react"
import { XIcon } from "@phosphor-icons/react/X"
import s from "./kit.module.css"

export function TagChip({
  children,
  leading,
  onRemove,
}: {
  children: ReactNode
  leading?: ReactNode
  onRemove?: () => void
}) {
  return (
    <span className={s.tag}>
      {leading}
      {children}
      {onRemove ? (
        <button type="button" className={s.tagRemove} aria-label={`Remove ${typeof children === "string" ? children : "tag"}`} onClick={onRemove}>
          <XIcon aria-hidden="true" />
        </button>
      ) : null}
    </span>
  )
}

// Up to `max` chips, then "+N".
export function TagChips({ names, max = 2 }: { names: string[]; max?: number }) {
  return (
    <span className={s.tags}>
      {names.slice(0, max).map((name) => (
        <span key={name} className={s.tag}>
          {name}
        </span>
      ))}
      {names.length > max ? <span className={s.more}>+{names.length - max}</span> : null}
    </span>
  )
}
