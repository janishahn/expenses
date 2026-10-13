import type { ReactElement, ReactNode } from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import clsx from "clsx"
import { useBottomLayer } from "./layout-state"
import { useSheetDrag } from "./sheet-drag"
import s from "./kit.module.css"

// A mobile sheet anchored to the bottom edge. Menus and popovers use it below the desktop breakpoint.
export function BottomSheet({
  open,
  onOpenChange,
  title,
  trigger,
  children,
  form = false,
  onCloseAutoFocus,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  trigger?: ReactElement
  children: ReactNode
  form?: boolean
  onCloseAutoFocus?: (event: Event) => void
}) {
  useBottomLayer(open)
  const { ref: dragRef, handleProps: dragHandleProps } = useSheetDrag(true, () => onOpenChange(false))
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger> : null}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={s.scrim} />
        <DialogPrimitive.Content
          ref={dragRef}
          aria-describedby={undefined}
          className={clsx(s.floatLayer, s.dialog, s.dialogNarrow)}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <div {...dragHandleProps}>
            <div className={s.grabber} />
            <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          </div>
          <div className={form ? s.sheetForm : s.sheetMenu}>{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
