import type { ReactNode } from "react"
import clsx from "clsx"
import s from "./kit.module.css"

// "72 %" for a 0–1 confidence.
function percent(confidence: number): string {
  return `${Math.round(confidence * 100)}\u00a0%`
}

// A suggested value at the top of a peek, with its confidence and the accept and reject buttons.
export function SuggestionBox({
  leading,
  name,
  confidence,
  children,
}: {
  leading?: ReactNode
  name: string
  confidence: number
  // Accept and Reject.
  children: ReactNode
}) {
  return (
    <div className={s.sugg}>
      <div className={s.suggLabel}>Suggestion</div>
      <div className={s.suggHead}>
        {leading}
        <b>{name}</b>
        <span className={s.sp} />
        <span className={s.tab}>{percent(confidence)} confidence</span>
      </div>
      <div className={s.suggActs}>{children}</div>
    </div>
  )
}

// The confidence column of a triage row.
export function Confidence({ value }: { value: number | null }) {
  return (
    <span className={clsx(s.cell, s.cellR, s.muted, s.tab)}>
      {value === null ? null : (
        <>
          {percent(value)}
          <span className="sr-only"> confidence</span>
        </>
      )}
    </span>
  )
}
