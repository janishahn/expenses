import { Switch as SwitchPrimitive } from "radix-ui"
import s from "./kit.module.css"

export function Switch({
  checked,
  onCheckedChange,
  label,
  labelledBy,
  disabled,
  id,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  // Accessible name when no visible label is linked by id.
  label?: string
  labelledBy?: string
  disabled?: boolean
  id?: string
}) {
  return (
    <SwitchPrimitive.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={label}
      aria-labelledby={labelledBy}
      disabled={disabled}
      className={s.sw}
    />
  )
}
