import { AppSwitch } from "./ui/product-fields"

export function Toggle({
  on,
  onChange,
  disabled,
  ariaLabel,
}: {
  on: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
  ariaLabel?: string
}) {
  return (
    <AppSwitch
      checked={on}
      aria-label={ariaLabel}
      disabled={disabled}
      onCheckedChange={onChange}
    />
  )
}
