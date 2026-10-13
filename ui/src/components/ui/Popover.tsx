import { useState, type ReactElement, type ReactNode } from "react"
import { Popover as PopoverPrimitive } from "radix-ui"
import clsx from "clsx"
import { BottomSheet } from "./BottomSheet"
import { useIsDesktop } from "./layout-state"
import s from "./kit.module.css"

// Pickers anchored to a value or control. Mobile shows the same content in a bottom sheet.
export function Popover({
  trigger,
  label,
  align = "start",
  open: controlledOpen,
  onOpenChange,
  children,
  className,
}: {
  trigger: ReactElement
  // Accessible name of the popover and of the mobile sheet.
  label: string
  align?: "start" | "center" | "end"
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: ReactNode | ((close: () => void) => ReactNode)
  className?: string
}) {
  const isDesktop = useIsDesktop()
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = (next: boolean) => {
    setUncontrolledOpen(next)
    onOpenChange?.(next)
  }
  const content = typeof children === "function" ? children(() => setOpen(false)) : children
  if (!isDesktop) {
    return (
      <BottomSheet open={open} onOpenChange={setOpen} title={label} trigger={trigger}>
        {content}
      </BottomSheet>
    )
  }
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align={align}
          sideOffset={4}
          collisionPadding={8}
          aria-label={label}
          className={clsx(s.floatLayer, s.popover, className)}
        >
          {content}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
