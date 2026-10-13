import type { ReactNode } from "react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"
import { CheckIcon } from "@phosphor-icons/react/Check"
import { MinusIcon } from "@phosphor-icons/react/Minus"
import clsx from "clsx"
import s from "./kit.module.css"

export function Checkbox({
  checked,
  onCheckedChange,
  label,
  disabled,
  rowSelect = false,
}: {
  checked: boolean | "indeterminate"
  onCheckedChange: (checked: boolean) => void
  label: string
  disabled?: boolean
  // Row selection boxes stay hidden until the row is hovered or a selection exists.
  rowSelect?: boolean
}) {
  return (
    <CheckboxPrimitive.Root
      checked={checked}
      onCheckedChange={(next) => onCheckedChange(next === true)}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => event.stopPropagation()}
      className={clsx(s.cbx, rowSelect && s.cb)}
    >
      <CheckboxPrimitive.Indicator>
        {checked === "indeterminate" ? <MinusIcon aria-hidden="true" weight="bold" /> : <CheckIcon aria-hidden="true" weight="bold" />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

// A checkbox with a visible label, for option groups.
export function CheckboxField({
  checked,
  onCheckedChange,
  children,
  disabled,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  children: ReactNode
  disabled?: boolean
}) {
  return (
    <label className={s.chk}>
      <CheckboxPrimitive.Root
        checked={checked}
        onCheckedChange={(next) => onCheckedChange(next === true)}
        disabled={disabled}
        className={s.cbx}
      >
        <CheckboxPrimitive.Indicator>
          <CheckIcon aria-hidden="true" weight="bold" />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <span>{children}</span>
    </label>
  )
}
