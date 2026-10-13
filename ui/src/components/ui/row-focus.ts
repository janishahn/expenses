// Puts focus back on a list row when the element that held or should get focus is gone:
// a deleted row, a closed peek or bulk bar, or a confirm dialog's removed opener.

export const ROW = "[role='listitem']"

export type LastRow = { row: HTMLElement; index: number }

// The last row used, or the row now in its place; a row without its own focus gives it to its first control.
export function focusRow(list: HTMLElement, last: LastRow) {
  const rows = [...list.querySelectorAll<HTMLElement>(ROW)]
  const row = last.row.isConnected ? last.row : rows[Math.min(last.index, rows.length - 1)]
  const target = row?.matches("[tabindex]") ? row : row?.querySelector<HTMLElement>("button, a[href], [tabindex]")
  target?.focus()
}

// Only the list whose row was used last takes focus back.
let restoreLastList: (() => void) | null = null

export function setRowFocusRestorer(restore: (() => void) | null) {
  restoreLastList = restore
}

export function clearRowFocusRestorer(restore: () => void) {
  if (restoreLastList === restore) restoreLastList = null
}

export function restoreRowFocus() {
  restoreLastList?.()
}
