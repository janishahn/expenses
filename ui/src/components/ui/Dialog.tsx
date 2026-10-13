import { useEffect, useRef, useState, type ReactNode } from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { XIcon } from "@phosphor-icons/react/X"
import clsx from "clsx"
import { registerConfirmHost, type ConfirmRequest } from "../confirm"
import { Button, IconButton } from "./Button"
import { useBottomLayer, useIsDesktop } from "./layout-state"
import { useSheetDrag } from "./sheet-drag"
import s from "./kit.module.css"

type DialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  // Replaces the visible title in the top row (e.g. the Expense/Income control); the title stays as the accessible name.
  header?: ReactNode
  size?: "narrow" | "default" | "wide"
  // One line on a consequence ("This cannot be undone."); it is the dialog's accessible description.
  warning?: ReactNode
  // Confirmations have no ✕; Cancel and Esc dismiss them.
  closable?: boolean
  footer?: ReactNode
  // A destructive action at the left end of the footer, such as Delete in an edit dialog.
  footerStart?: ReactNode
  children?: ReactNode
  onCloseAutoFocus?: (event: Event) => void
}

const sizeClass = { narrow: s.dialogNarrow, default: undefined, wide: s.dialogWide }

// Centered on desktop, a bottom sheet on mobile (kit CSS handles the placement).
export function Dialog({
  open,
  onOpenChange,
  title,
  header,
  size = "default",
  warning,
  closable = true,
  footer,
  footerStart,
  children,
  onCloseAutoFocus,
}: DialogProps) {
  const isDesktop = useIsDesktop()
  useBottomLayer(open && !isDesktop)
  const { ref: dragRef, handleProps: dragHandleProps } = useSheetDrag(!isDesktop, () => onOpenChange(false))
  // Dialogs open without a Radix trigger, so focus returns to whatever had it as the dialog opened.
  // It is read while rendering the open state, before an autofocused field inside takes focus.
  const [opener, setOpener] = useState(() => ({ open, element: open ? document.activeElement : null }))
  if (opener.open !== open) setOpener({ open, element: open ? document.activeElement : opener.element })
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={s.scrim} />
        <DialogPrimitive.Content
          ref={dragRef}
          {...(warning ? {} : { "aria-describedby": undefined })}
          className={clsx(s.floatLayer, s.dialog, sizeClass[size])}
          onCloseAutoFocus={(event) => {
            onCloseAutoFocus?.(event)
            if (event.defaultPrevented) return
            event.preventDefault()
            if (opener.element instanceof HTMLElement) opener.element.focus()
          }}
        >
          <div className={s.dgTop} {...dragHandleProps}>
            {header ?? <DialogPrimitive.Title className={s.dgTitle}>{title}</DialogPrimitive.Title>}
            {header ? <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title> : null}
            <span className={s.sp} />
            {closable ? (
              <DialogPrimitive.Close asChild>
                <IconButton icon={XIcon} label="Close" tooltip={false} />
              </DialogPrimitive.Close>
            ) : null}
          </div>
          {warning ? <DialogPrimitive.Description className={s.warn}>{warning}</DialogPrimitive.Description> : null}
          {children != null ? <div className={s.dgBody}>{children}</div> : null}
          {footer ? (
            <div className={s.dgFoot}>
              {footerStart ? (
                <>
                  {footerStart}
                  <span className={s.sp} />
                </>
              ) : null}
              {footer}
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

// The shared confirmation dialog behind confirmDialog() in ../confirm.
export function ConfirmDialogHost() {
  // The request outlives `open` so the text stays while the close animation plays.
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const [open, setOpen] = useState(false)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    registerConfirmHost((next) => {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setRequest(next)
      setOpen(true)
    })
    return () => registerConfirmHost(null)
  }, [])

  const settle = (confirmed: boolean) => {
    if (!open) return
    setOpen(false)
    request?.resolve(confirmed)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) settle(false)
      }}
      title={request?.title ?? ""}
      size="narrow"
      warning={request?.description}
      closable={false}
      onCloseAutoFocus={(event) => {
        event.preventDefault()
        returnFocusRef.current?.focus()
        setRequest(null)
      }}
      footer={
        <>
          <span className={s.sp} />
          <Button variant="ghost" onClick={() => settle(false)}>
            {request?.cancelLabel ?? "Cancel"}
          </Button>
          <Button
            variant={request?.tone === "primary" ? "primary" : "dangerFill"}
            onClick={() => settle(true)}
          >
            {request?.confirmLabel ?? "Delete"}
          </Button>
        </>
      }
    />
  )
}
