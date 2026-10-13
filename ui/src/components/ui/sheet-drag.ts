import { useRef, type PointerEvent } from "react"

// Mobile sheets dismiss on a downward flick or a long drag from their top row.
export function useSheetDrag(enabled: boolean, onDismiss: () => void) {
  const ref = useRef<HTMLDivElement | null>(null)
  const start = useRef<{ y: number; t: number; id: number } | null>(null)

  const reset = () => {
    const el = ref.current
    if (!el) return
    el.style.transition = "transform 200ms var(--ease-drawer)"
    el.style.transform = ""
  }

  const handleProps = enabled
    ? {
        onPointerDown: (event: PointerEvent<HTMLElement>) => {
          if (start.current || (event.target as HTMLElement).closest("button, input, a")) return
          start.current = { y: event.clientY, t: event.timeStamp, id: event.pointerId }
          event.currentTarget.setPointerCapture(event.pointerId)
          if (ref.current) ref.current.style.transition = "none"
        },
        onPointerMove: (event: PointerEvent<HTMLElement>) => {
          if (!start.current || event.pointerId !== start.current.id || !ref.current) return
          const dy = event.clientY - start.current.y
          // Dragging up is damped instead of stopped.
          const offset = dy > 0 ? dy : -Math.sqrt(-dy) * 2
          ref.current.style.transform = `translateY(${offset}px)`
        },
        onPointerUp: (event: PointerEvent<HTMLElement>) => {
          if (!start.current || event.pointerId !== start.current.id) return
          const dy = event.clientY - start.current.y
          const velocity = dy / Math.max(event.timeStamp - start.current.t, 1)
          start.current = null
          if (dy > 120 || (dy > 12 && velocity > 0.11)) {
            onDismiss()
          } else {
            reset()
          }
        },
        onPointerCancel: () => {
          start.current = null
          reset()
        },
      }
    : {}

  return { ref, handleProps }
}
