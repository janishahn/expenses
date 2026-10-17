import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import type { TransactionsResponse, TransactionsSummary } from "../../app/api-types"
import { formatAmountPrivate, formatDateRange } from "../../app/format"
import { currentLocalDateTime, dayLabel, dayNet, groupByDay, occurredLabel, rowTitle } from "../../app/transactions"
import { categoryColor } from "./tokens"
import s from "./kit.module.css"

// The Transactions ledger on paper: every row of `list`, then the server's totals for the
// same period and filters. It shows only in print, opens the print dialog when it mounts,
// and calls onDone when the dialog closes.
export function PrintLedger({
  list,
  summary,
  onDone,
}: {
  list: TransactionsResponse
  summary: TransactionsSummary
  onDone: () => void
}) {
  const [printedAt] = useState(() => occurredLabel(currentLocalDateTime()))
  const period = list.period.slug === "all" ? "All time" : formatDateRange(list.period.start, list.period.end)

  useEffect(() => {
    const pageTitle = document.title
    // Browsers print the title in the page header and name a saved PDF after it.
    document.title = `Transactions · ${period}`
    window.addEventListener("afterprint", onDone)
    // A timer, so Strict Mode's second mount in development opens one dialog.
    const timer = window.setTimeout(() => window.print())
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener("afterprint", onDone)
      document.title = pageTitle
    }
  }, [period, onDone])

  const { filters } = list
  const tagNames = (ids: number[]) => ids.map((id) => list.tags.find((tag) => tag.id === id)?.name ?? "1 tag").join(", ")
  const scope = [
    filters.type === "expense" ? "Expenses" : filters.type === "income" ? "Income" : null,
    list.categories.find((category) => category.id === filters.category_id)?.name,
    filters.included_tag_ids.length ? `Only ${tagNames(filters.included_tag_ids)}` : null,
    filters.excluded_tag_ids.length ? `Excluding ${tagNames(filters.excluded_tag_ids)}` : null,
    filters.query ? `Matching “${filters.query}”` : null,
  ]
    .filter(Boolean)
    .join(" · ")

  return createPortal(
    <div className={s.print}>
      <div className={s.printMast}>
        <strong>Expenses</strong>
        <span>Printed {printedAt}</span>
      </div>
      <h1>Transactions</h1>
      <p className={s.printPeriod}>{period}</p>
      {scope ? <p className={s.printScope}>{scope}</p> : null}
      <table className={s.printTable}>
        <thead>
          <tr>
            <th>Description</th>
            <th>Category</th>
            <th>Amount</th>
          </tr>
        </thead>
        {groupByDay(list.items).map((day, index) => (
          <tbody key={`${day.date}-${index}`}>
            <tr className={s.printDay}>
              <td colSpan={2}>{dayLabel(day.date)}</td>
              <td>{day.rows.length > 1 ? formatAmountPrivate(dayNet(day.rows), "signed") : null}</td>
            </tr>
            {day.rows.map((row) => (
              <tr key={row.id}>
                <td>
                  {rowTitle(row)}
                  {row.tags.length ? (
                    <span className={s.printTags}>{row.tags.map((tag) => `#${tag.name}`).join(" ")}</span>
                  ) : null}
                </td>
                <td>
                  <i className={s.printDot} style={{ background: categoryColor(row.category?.id) }} />
                  {row.category?.name ?? "Uncategorized"}
                </td>
                <td>
                  {row.type === "expense" ? (
                    <>
                      {row.reimbursed_total_cents > 0 ? (
                        <s className={s.printCharged}>{formatAmountPrivate(row.amount_cents, "expense")}</s>
                      ) : null}
                      {formatAmountPrivate(row.net_amount_cents, "expense")}
                    </>
                  ) : (
                    <span className={row.is_reimbursement ? s.printMuted : undefined}>
                      {formatAmountPrivate(row.amount_cents, "income")}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
      <dl className={s.printTotals}>
        <div>
          <dt>Spent</dt>
          <dd>{formatAmountPrivate(summary.expense_cents)}</dd>
        </div>
        <div>
          <dt>Cash in</dt>
          <dd>{formatAmountPrivate(summary.income_cents)}</dd>
        </div>
        <div className={s.printNetTotal}>
          <dt>Net</dt>
          <dd>{formatAmountPrivate(summary.net_cents, "signed")}</dd>
        </div>
      </dl>
      <p className={s.printCount}>
        {summary.count} transaction{summary.count === 1 ? "" : "s"}
      </p>
    </div>,
    document.body
  )
}
