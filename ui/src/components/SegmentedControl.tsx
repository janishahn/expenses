import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { cn } from "../lib/utils"

type SegmentedControlItem<Value extends string | number> = {
  value: Value
  label: ReactNode
  ariaLabel?: string
  disabled?: boolean
}

type SegmentedControlProps<Value extends string | number> = {
  value: Value
  items: ReadonlyArray<SegmentedControlItem<Value>>
  onValueChange: (value: Value) => void
  ariaLabel: string
  className?: string
  equalWidth?: boolean
}

type IndicatorFrame = {
  x: number
  y: number
  width: number
  height: number
}

function SegmentedControl<Value extends string | number>({
  value,
  items,
  onValueChange,
  ariaLabel,
  className,
  equalWidth = false,
}: SegmentedControlProps<Value>) {
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRefs = useRef(new Map<Value, HTMLButtonElement>())
  const [indicatorFrame, setIndicatorFrame] = useState<IndicatorFrame | null>(null)

  const updateIndicator = useCallback(() => {
    const activeButton = buttonRefs.current.get(value)
    if (!activeButton) return
    setIndicatorFrame({
      x: activeButton.offsetLeft,
      y: activeButton.offsetTop,
      width: activeButton.offsetWidth,
      height: activeButton.offsetHeight,
    })
  }, [value])

  useLayoutEffect(() => {
    updateIndicator()
    const root = rootRef.current
    if (!root) return
    const resizeObserver = new ResizeObserver(updateIndicator)
    resizeObserver.observe(root)
    const activeButton = buttonRefs.current.get(value)
    if (activeButton) resizeObserver.observe(activeButton)
    return () => resizeObserver.disconnect()
  }, [items.length, updateIndicator, value])

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "segmented-control",
        equalWidth && "segmented-control-equal",
        className
      )}
    >
      <span
        aria-hidden="true"
        className="segmented-control-indicator"
        style={
          indicatorFrame
            ? {
                width: indicatorFrame.width,
                height: indicatorFrame.height,
                transform: `translate3d(${indicatorFrame.x}px, ${indicatorFrame.y}px, 0)`,
                opacity: 1,
              }
            : undefined
        }
      />
      {items.map((item) => {
        const active = value === item.value
        return (
          <button
            key={item.value}
            ref={(node) => {
              if (node) buttonRefs.current.set(item.value, node)
              else buttonRefs.current.delete(item.value)
            }}
            type="button"
            aria-label={item.ariaLabel}
            aria-pressed={active}
            disabled={item.disabled}
            onClick={() => onValueChange(item.value)}
            className={cn(
              "segmented-control-button",
              active ? "text-text" : "text-muted"
            )}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

export default SegmentedControl
