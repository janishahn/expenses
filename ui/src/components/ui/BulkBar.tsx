import type { ReactNode } from "react"
import { XIcon } from "@phosphor-icons/react/X"
import clsx from "clsx"
import { IconButton } from "./Button"
import { useBottomLayer } from "./layout-state"
import s from "./kit.module.css"

// Floating actions for the selected rows. On mobile it replaces the tab bar.
export function BulkBar({
  count,
  onClear,
  children,
}: {
  count: number
  onClear: () => void
  children: ReactNode
}) {
  useBottomLayer(count > 0)
  if (count === 0) return null
  return (
    <div role="toolbar" aria-label="Selected rows" className={clsx(s.floatLayer, s.bulk)}>
      <span className={s.bulkN}>{count} selected</span>
      {children}
      <IconButton icon={XIcon} label="Clear selection" onClick={onClear} />
    </div>
  )
}
