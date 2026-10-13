import type { ReactNode } from "react"
import s from "./kit.module.css"

// A grid of icon choices, such as a category's icon.
export function IconGrid({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className={s.iconGrid}>
      {children}
    </div>
  )
}

export function IconChoice({
  label,
  selected,
  onSelect,
  children,
}: {
  label: string
  selected: boolean
  onSelect: () => void
  children: ReactNode
}) {
  return (
    <button type="button" className={s.iconChoice} aria-label={label} aria-pressed={selected} onClick={onSelect}>
      {children}
    </button>
  )
}
