import { useEffect, useSyncExternalStore } from "react"
import clsx from "clsx"
import { Button } from "./Button"
import { currentToast, dismissToast, subscribeToasts } from "./toast-store"
import s from "./kit.module.css"

// Mounted once by the app frame; shows the latest toast from showToast().
export function ToastHost() {
  const toast = useSyncExternalStore(subscribeToasts, currentToast, currentToast)

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => dismissToast(toast.id), toast.action ? 6000 : 4000)
    return () => window.clearTimeout(timer)
  }, [toast])

  // The live region stays mounted so screen readers announce each new message.
  return (
    <div role="status" aria-live="polite" className={toast ? clsx(s.floatLayer, s.toast) : "sr-only"}>
      {toast ? (
        <>
          <span className={s.toastText}>{toast.message}</span>
          {toast.action ? (
            <Button
              variant="quiet"
              onClick={() => {
                dismissToast(toast.id)
                toast.action?.onClick()
              }}
            >
              {toast.action.label}
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
