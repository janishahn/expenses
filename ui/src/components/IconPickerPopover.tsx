import { lazy, Suspense, type ReactElement } from "react"
import { EmptyState } from "./ui/EmptyState"
import { Popover } from "./ui/Popover"

const IconPicker = lazy(() => import("./IconPicker"))

// Picks a category icon; the picker and its icon search load when first opened.
export function IconPickerPopover({
  value,
  onChange,
  trigger,
}: {
  value: string | null
  onChange: (iconKey: string) => void
  trigger: ReactElement
}) {
  return (
    <Popover form label="Icon" trigger={trigger}>
      {(close) => (
        <Suspense fallback={<EmptyState inline>Loading icons…</EmptyState>}>
          <IconPicker
            value={value}
            onPick={(iconKey) => {
              onChange(iconKey)
              close()
            }}
          />
        </Suspense>
      )}
    </Popover>
  )
}
