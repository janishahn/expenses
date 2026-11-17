import { useEffect, useState, type PointerEvent, type RefObject } from "react"

// Where a chart's floating tooltip sits, relative to the chart root. It follows the
// pointer and flips to the pointer's left when the right side is short of room for it.
export type PointerAt = { x: number; y: number; flip: boolean }

// About the width of a tooltip with a category name and an amount.
const TIP_ROOM = 220

export function pointerAt(event: PointerEvent<Element>, root: Element): PointerAt {
  const box = root.getBoundingClientRect()
  const x = event.clientX - box.left
  const right = box.width - x
  return { x, y: event.clientY - box.top, flip: x > box.width * 0.6 || (right < TIP_ROOM && x > right) }
}

// The element's content width, 0 until measured. `active` re-attaches once a chart that
// rendered nothing gets data.
export function useInlineSize(ref: RefObject<HTMLElement | null>, active = true): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, active])
  return width
}
