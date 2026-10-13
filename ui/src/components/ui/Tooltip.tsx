import type { ReactElement, ReactNode } from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"
import clsx from "clsx"
import s from "./kit.module.css"

// The first tooltip waits; neighbours then open instantly (skipDelayDuration).
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={500} skipDelayDuration={400}>
      {children}
    </TooltipPrimitive.Provider>
  )
}

export function Tooltip({
  label,
  children,
  side = "bottom",
}: {
  label: ReactNode
  children: ReactElement
  side?: "top" | "bottom" | "left" | "right"
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className={clsx(s.floatLayer, s.tip)}
        >
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
