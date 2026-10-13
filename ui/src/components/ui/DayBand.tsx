import type { ReactNode } from "react"
import clsx from "clsx"
import s from "./kit.module.css"

// Groups rows by date or by kind; the right side carries the group's total or a band action.
export function DayBand({
  label,
  count,
  end,
  ledger = false,
}: {
  label: ReactNode
  // The rows in the group, after the label.
  count?: number
  end?: ReactNode
  // Ledger bands indent to the title column.
  ledger?: boolean
}) {
  return (
    <div className={clsx(s.day, ledger && s.dayLedger)}>
      <span>
        {label}
        {count != null ? <span className={s.dayCount}> {count}</span> : null}
      </span>
      {end != null ? <span className={s.dayEnd}>{end}</span> : null}
    </div>
  )
}
