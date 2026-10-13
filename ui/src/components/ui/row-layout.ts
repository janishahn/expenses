import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from "react"

export type Columns = {
  // CSS grid columns for desktop.
  columns: string
  // Below 780px of list width (for example with the peek open).
  narrowColumns?: string
  // Below the desktop breakpoint.
  mobileColumns?: string
}

export function columnStyle({ columns, narrowColumns, mobileColumns }: Columns): CSSProperties {
  return {
    "--cols": columns,
    "--cols-narrow": narrowColumns,
    "--cols-mobile": mobileColumns ?? narrowColumns,
  } as CSSProperties
}

export function columnAttrs({ narrowColumns, mobileColumns }: Columns) {
  return {
    "data-cols-narrow": narrowColumns ? "" : undefined,
    "data-cols-mobile": mobileColumns || narrowColumns ? "" : undefined,
  }
}

export type RowProps = Columns & {
  children: ReactNode
  // Opens the row's peek or detail. Rows without it are static.
  onOpen?: () => void
  selected?: boolean
  // Archived or inactive records.
  dim?: boolean
  // Accessible name for the row when it opens something.
  label?: string
}

// The attributes a row shares with its sortable variant.
export function rowProps({ onOpen, selected = false, label, ...columns }: Omit<RowProps, "children" | "dim">) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      onOpen?.()
    }
  }
  return {
    role: "listitem",
    ...columnAttrs(columns),
    "data-clickable": onOpen ? "" : undefined,
    "data-selected": selected ? "" : undefined,
    "aria-current": selected ? ("true" as const) : undefined,
    "aria-label": label,
    tabIndex: onOpen ? 0 : undefined,
    onClick: onOpen
      ? (event: MouseEvent<HTMLDivElement>) => {
          // Clicks in a row's menus and dialogs arrive through React portals from outside the row.
          if (!event.currentTarget.contains(event.target as Node)) return
          if ((event.target as HTMLElement).closest("button, a, input, [role='checkbox'], [role='switch']") && event.target !== event.currentTarget) return
          onOpen()
        }
      : undefined,
    onKeyDown: onOpen ? onKeyDown : undefined,
  }
}
