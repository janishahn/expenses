import type { ReactNode } from "react"
import { RadioGroup as RadioPrimitive } from "radix-ui"
import s from "./kit.module.css"

export function RadioGroup({
  value,
  onValueChange,
  label,
  children,
}: {
  value: string | null
  onValueChange: (value: string) => void
  label: string
  children: ReactNode
}) {
  return (
    <RadioPrimitive.Root value={value ?? ""} onValueChange={onValueChange} aria-label={label}>
      {children}
    </RadioPrimitive.Root>
  )
}

// The radio dot alone, for rows whose content is laid out by the row (candidates, choices).
export function Radio({ value, label }: { value: string; label: string }) {
  return <RadioPrimitive.Item value={value} aria-label={label} className={s.radio} />
}

export function RadioField({ value, children }: { value: string; children: ReactNode }) {
  return (
    <label className={s.chk}>
      <RadioPrimitive.Item value={value} className={s.radio} />
      <span>{children}</span>
    </label>
  )
}
