"use client"

import * as React from "react"
import { Dialog as SheetPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({ ...props }: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "drawer-overlay fixed inset-0 z-[65] data-[state=closed]:opacity-0 data-[state=open]:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "bottom",
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "fixed z-[65] flex flex-col bg-surface text-text outline-none shadow-[var(--shadow-raised)]",
          "data-[side=bottom]:inset-x-2 data-[side=bottom]:bottom-[calc(0.5rem+env(safe-area-inset-bottom,0px))] data-[side=bottom]:max-h-[calc(88vh-env(safe-area-inset-bottom,0px))] data-[side=bottom]:rounded-[1.75rem] data-[side=bottom]:border",
          "data-[side=top]:inset-x-2 data-[side=top]:top-2 data-[side=top]:max-h-[88vh] data-[side=top]:rounded-[1.75rem] data-[side=top]:border",
          "data-[side=left]:inset-y-2 data-[side=left]:left-2 data-[side=left]:w-[calc(100%-1rem)] data-[side=left]:max-w-sm data-[side=left]:rounded-[1.75rem] data-[side=left]:border",
          "data-[side=right]:inset-y-2 data-[side=right]:right-2 data-[side=right]:w-[calc(100%-1rem)] data-[side=right]:max-w-sm data-[side=right]:rounded-[1.75rem] data-[side=right]:border",
          "data-[state=closed]:opacity-0 data-[state=open]:opacity-100",
          "data-[side=bottom]:data-[state=closed]:translate-y-6 data-[side=bottom]:data-[state=open]:translate-y-0",
          "data-[side=top]:data-[state=closed]:-translate-y-6 data-[side=top]:data-[state=open]:translate-y-0",
          "data-[side=left]:data-[state=closed]:-translate-x-6 data-[side=left]:data-[state=open]:translate-x-0",
          "data-[side=right]:data-[state=closed]:translate-x-6 data-[side=right]:data-[state=open]:translate-x-0",
          "drawer-motion border-border",
          className
        )}
        {...props}
      >
        {children}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex items-center justify-between gap-3 p-5 pb-0", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="sheet-footer" className={cn("mt-auto p-5 pt-0", className)} {...props} />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("font-head text-xl font-bold tracking-tight", className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
}
