import type { ReactNode } from "react"
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown"
import { XIcon } from "@phosphor-icons/react/X"
import clsx from "clsx"
import { IconButton } from "./Button"
import { useBottomLayer } from "./layout-state"
import { Menu } from "./Menu"
import s from "./kit.module.css"

// Floating actions for the selected rows. On mobile it replaces the tab bar.
export function BulkBar({
  count,
  active = false,
  onClear,
  selectionMenu,
  children,
}: {
  count: number
  // Mobile selection mode shows the bar before the first row is picked.
  active?: boolean
  onClear: () => void
  // Items behind the count, such as "Select all 214 matching".
  selectionMenu?: ReactNode
  children: ReactNode
}) {
  const shown = active || count > 0
  useBottomLayer(shown)
  if (!shown) return null
  return (
    <div role="toolbar" aria-label="Selected rows" className={clsx(s.floatLayer, s.bulk)}>
      {selectionMenu ? (
        <Menu
          label="Selection"
          align="start"
          trigger={
            <button type="button" className={clsx(s.btn, s.btnGhost, s.bulkN)}>
              {count} selected
              <CaretDownIcon aria-hidden="true" />
            </button>
          }
        >
          {selectionMenu}
        </Menu>
      ) : (
        <span className={s.bulkN}>{count} selected</span>
      )}
      {children}
      <IconButton icon={XIcon} label="Clear selection" onClick={onClear} />
    </div>
  )
}
