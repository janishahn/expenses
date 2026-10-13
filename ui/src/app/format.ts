import { isPrivacyOn } from "./privacy"

const CURRENCY_FORMAT_WITH_CENTS = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const CURRENCY_FORMAT_NO_CENTS = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const COUNT_FORMAT = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 })

// Whole counts group thousands with a space, like amounts.
export function formatCount(value: number): string {
  return COUNT_FORMAT.format(value).replace(/\./g, " ")
}

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

export function formatAmount(cents: number, kind: AmountKind = "balance", decimals = true, symbol = "€"): string {
  const value = formatCurrency(Math.abs(cents), decimals)
  if (kind === "income") return `+ ${value} ${symbol}`
  if (kind === "signed") return `${cents < 0 ? "−" : "+"} ${value} ${symbol}`
  if (kind === "balance" && cents < 0) return `− ${value} ${symbol}`
  return `${value} ${symbol}`
}

// For tooltips, table cells and accessible names: masked while privacy mode is on.
export function formatAmountPrivate(cents: number, kind: AmountKind = "balance", decimals = true): string {
  return isPrivacyOn() ? "•••• €" : formatAmount(cents, kind, decimals)
}

const SHORT_MONTH = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" })

function dateParts(isoDate: string) {
  const date = new Date(`${isoDate}T00:00:00Z`)
  return { day: date.getUTCDate(), month: SHORT_MONTH.format(date), year: date.getUTCFullYear() }
}

// "12 Oct 2026" from an ISO date or date-time.
export function formatShortDate(iso: string): string {
  const { day, month, year } = dateParts(iso.slice(0, 10))
  return `${day} ${month} ${year}`
}

// "12 Oct 2026, 14:20" from an ISO date-time, with the time as stored.
export function formatShortDateTime(iso: string): string {
  const time = iso.slice(11, 16)
  return time ? `${formatShortDate(iso)}, ${time}` : formatShortDate(iso)
}

// "1 – 20 Apr 2026", "28 Mar – 3 Apr 2026", "28 Dec 2025 – 3 Jan 2026".
export function formatDateRange(start: string, end: string): string {
  const a = dateParts(start)
  const b = dateParts(end)
  const tail = `${b.day} ${b.month} ${b.year}`
  if (a.year !== b.year) return `${a.day} ${a.month} ${a.year} – ${tail}`
  if (a.month !== b.month) return `${a.day} ${a.month} – ${tail}`
  return `${a.day} – ${tail}`
}
