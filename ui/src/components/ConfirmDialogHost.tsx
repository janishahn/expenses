import { useEffect, useRef, useState } from "react"
import { AppButton } from "./ui/product-button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog"
import { registerConfirmHost, type ConfirmRequest } from "./confirm"

function ConfirmDialogHost() {
  // `request` outlives `open` so the dialog keeps its title and labels
  // while the close animation plays; it is cleared only after the exit.
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const [open, setOpen] = useState(false)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    registerConfirmHost((next) => {
      returnFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
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
      onOpenChange={(nextOpen) => {
        if (!nextOpen) settle(false)
      }}
    >
      <DialogContent
        className="max-w-md"
        {...(request?.description ? {} : { "aria-describedby": undefined })}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          returnFocusRef.current?.focus()
          setRequest(null)
        }}
      >
        <DialogHeader className="mb-2">
          <DialogTitle className="text-lg">{request?.title}</DialogTitle>
        </DialogHeader>
        {request?.description ? (
          <DialogDescription>{request.description}</DialogDescription>
        ) : null}
        <DialogFooter className="justify-end">
          <AppButton type="button" tone="ghost" onClick={() => settle(false)}>
            {request?.cancelLabel ?? "Cancel"}
          </AppButton>
          <AppButton
            type="button"
            tone={request?.tone === "primary" ? "primary" : "danger"}
            onClick={() => settle(true)}
          >
            {request?.confirmLabel ?? "Delete"}
          </AppButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ConfirmDialogHost
