import type { PointerEvent } from "react"

// Where a chart's floating tooltip sits, relative to the chart root. It follows the
// pointer and flips to the pointer's left in the right part of the chart.
export type PointerAt = { x: number; y: number; flip: boolean }

export function pointerAt(event: PointerEvent<Element>, root: Element): PointerAt {
  const box = root.getBoundingClientRect()
  const x = event.clientX - box.left
  return { x, y: event.clientY - box.top, flip: x > box.width * 0.6 }
}
