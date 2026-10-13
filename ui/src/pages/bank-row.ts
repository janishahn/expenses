import type { BankReconciliationTransaction } from "../app/api-types"

// A bank row's name: the payee, else the booking text or purpose.
export function bankRowTitle(row: { payee: string | null; booking_text: string | null; purpose: string | null }): string {
  return row.payee || row.booking_text || row.purpose || "Bank transaction"
}

export function candidateTitle(transaction: BankReconciliationTransaction): string {
  return transaction.title || "Untitled transaction"
}

// How far the transaction's date is from the booking: "same day", "2 days earlier", "1 day later".
export function dayDistance(days: number): string {
  if (days === 0) return "same day"
  const count = Math.abs(days)
  return `${count} ${count === 1 ? "day" : "days"} ${days > 0 ? "earlier" : "later"}`
}
