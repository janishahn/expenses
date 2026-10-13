import { isPrivacyOn } from "./privacy"

const CURRENCY_FORMAT_WITH_CENTS = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const CURRENCY_FORMAT_NO_CENTS = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

export function formatCurrency(cents: number, includeCents = true): string {
  const formatter = includeCents
    ? CURRENCY_FORMAT_WITH_CENTS
    : CURRENCY_FORMAT_NO_CENTS
  return formatter.format(cents / 100).replace(/\./g, " ")
}

export function formatEuroDate(isoDate: string): string {
  if (!isoDate) return ""
  const [year, month, day] = isoDate.split("-")
  if (!year || !month || !day) return isoDate
  return `${day}.${month}.${year}`
}

export function formatEuroDateTime(isoDateTime: string): string {
  if (!isoDateTime) return ""
  const [datePart, timePart] = isoDateTime.split("T")
  if (!datePart) return isoDateTime
  const date = formatEuroDate(datePart)
  if (!timePart) return date
  return `${date} ${timePart.slice(0, 5)}`
}

export function formatFileSize(sizeBytes: number): string {
  if (sizeBytes >= 1024 ** 3) {
    return `${(sizeBytes / 1024 ** 3).toFixed(1)} GB`
  }
  if (sizeBytes >= 1024 ** 2) {
    return `${(sizeBytes / 1024 ** 2).toFixed(1)} MB`
  }
  if (sizeBytes >= 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`
  }
  return `${sizeBytes} B`
}

export function formatCoordinate(value: number): string {
  return value.toFixed(6)
}

// expense: ink, no sign. income: income tone with "+". signed: "+"/"−" by value.
// balance: "−" only when negative. Expenses are never red.
export type AmountKind = "expense" | "income" | "signed" | "balance"

export function formatAmount(cents: number, kind: AmountKind = "balance", decimals = true): string {
  const value = formatCurrency(Math.abs(cents), decimals)
  if (kind === "income") return `+ ${value} €`
  if (kind === "signed") return `${cents < 0 ? "−" : "+"} ${value} €`
  if (kind === "balance" && cents < 0) return `− ${value} €`
  return `${value} €`
}

// For tooltips, table cells and accessible names: masked while privacy mode is on.
export function formatAmountPrivate(cents: number, kind: AmountKind = "balance", decimals = true): string {
  return isPrivacyOn() ? "•••• €" : formatAmount(cents, kind, decimals)
}
