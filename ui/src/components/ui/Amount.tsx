import clsx from "clsx"
import { formatAmount, type AmountKind } from "../../app/format"
import { usePrivacy } from "../../app/privacy"
import s from "./kit.module.css"

export function Amount({
  cents,
  kind = "balance",
  decimals = true,
  tone,
  currency = "EUR",
  className,
}: {
  cents: number
  kind?: AmountKind
  decimals?: boolean
  // Override the tone, e.g. "over" for an exceeded budget or "muted" for secondary figures.
  tone?: "income" | "over" | "muted" | "faint"
  // Recurring rules may be kept in US dollars; everything else is in euros.
  currency?: "EUR" | "USD"
  className?: string
}) {
  const hidden = usePrivacy()
  const text = formatAmount(cents, kind, decimals, currency === "USD" ? "$" : "€")
  const toneClass =
    tone === "income" || (!tone && kind === "income")
      ? s.in
      : tone === "over"
        ? s.over
        : tone === "muted"
          ? s.muted
          : tone === "faint"
            ? s.faint
            : undefined
  if (hidden) {
    return (
      <span className={clsx(s.tab, className)}>
        <span className={s.mask} aria-hidden="true">
          {text}
        </span>
        <span className="sr-only">Hidden amount</span>
      </span>
    )
  }
  return <span className={clsx(s.tab, toneClass, className)}>{text}</span>
}
