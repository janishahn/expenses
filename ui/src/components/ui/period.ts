// The page period as it appears in the URL (`period`, `start`, `end`), matching the
// server's resolve_period: this_month, last_month, all, or a custom ISO date range.
export type PeriodSelection =
  | { slug: "this_month" | "last_month" | "all" }
  | { slug: "custom"; start: string; end: string }

export type PeriodPreset = { label: string; selection: PeriodSelection }

export const DEFAULT_PERIOD_PRESETS: PeriodPreset[] = [
  { label: "This month", selection: { slug: "this_month" } },
  { label: "Last month", selection: { slug: "last_month" } },
  { label: "All time", selection: { slug: "all" } },
]

const MONTH_LABEL = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })
const SHORT_MONTH = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" })

// "13 Sep"; en-GB would write "Sept".
function dayMonth(date: Date): string {
  return `${date.getUTCDate()} ${SHORT_MONTH.format(date)}`
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function parseIso(value: string): Date {
  return new Date(`${value}T00:00:00Z`)
}

// The first day of the month `offset` months from today's month, in UTC date terms.
function monthStart(offset: number, today: Date): Date {
  return new Date(Date.UTC(today.getFullYear(), today.getMonth() + offset, 1))
}

function monthRange(start: Date): { start: string; end: string } {
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0))
  return { start: isoDate(start), end: isoDate(end) }
}

// The calendar month a selection covers, as an offset from today's month, or null
// when it is not exactly one month.
function monthOffset(selection: PeriodSelection, today: Date): number | null {
  if (selection.slug === "this_month") return 0
  if (selection.slug === "last_month") return -1
  if (selection.slug !== "custom") return null
  const start = parseIso(selection.start)
  if (start.getUTCDate() !== 1 || monthRange(start).end !== selection.end) return null
  return (start.getUTCFullYear() - today.getFullYear()) * 12 + start.getUTCMonth() - today.getMonth()
}

function selectionForOffset(offset: number, today: Date): PeriodSelection {
  if (offset === 0) return { slug: "this_month" }
  if (offset === -1) return { slug: "last_month" }
  return { slug: "custom", ...monthRange(monthStart(offset, today)) }
}

// The dates a selection covers, or null for all time (whose start is the server's).
export function periodDates(selection: PeriodSelection, today = new Date()): { start: string; end: string } | null {
  if (selection.slug === "custom") return { start: selection.start, end: selection.end }
  const offset = monthOffset(selection, today)
  return offset === null ? null : monthRange(monthStart(offset, today))
}

export function samePeriod(a: PeriodSelection, b: PeriodSelection): boolean {
  if (a.slug !== b.slug) return false
  if (a.slug === "custom" && b.slug === "custom") return a.start === b.start && a.end === b.end
  return true
}

// The neighbouring month, or null when the period is not a single calendar month.
export function stepPeriod(selection: PeriodSelection, direction: -1 | 1, today = new Date()): PeriodSelection | null {
  const offset = monthOffset(selection, today)
  return offset === null ? null : selectionForOffset(offset + direction, today)
}

export function periodLabel(selection: PeriodSelection, presets: PeriodPreset[], today = new Date()): string {
  const preset = presets.find((candidate) => samePeriod(candidate.selection, selection))
  if (selection.slug === "all") return preset?.label ?? "All time"
  const offset = monthOffset(selection, today)
  if (offset !== null) return MONTH_LABEL.format(monthStart(offset, today))
  if (preset) return preset.label
  if (selection.slug !== "custom") return ""
  const start = parseIso(selection.start)
  const end = parseIso(selection.end)
  const startLabel = start.getUTCFullYear() === end.getUTCFullYear() ? dayMonth(start) : `${dayMonth(start)} ${start.getUTCFullYear()}`
  return `${startLabel} – ${dayMonth(end)} ${end.getUTCFullYear()}`
}

// Reads the selection from URL search params. Pages differ in their default period,
// so a missing or invalid one falls back to the page's own.
export function periodFromSearch(params: URLSearchParams, fallback: PeriodSelection): PeriodSelection {
  const slug = params.get("period")
  const start = params.get("start")
  const end = params.get("end")
  if (slug === "this_month" || slug === "last_month" || slug === "all") return { slug }
  if (slug === "custom" && start && end) return { slug, start, end }
  return fallback
}

export function writePeriodToSearch(params: URLSearchParams, selection: PeriodSelection): URLSearchParams {
  const next = new URLSearchParams(params)
  next.set("period", selection.slug)
  next.delete("start")
  next.delete("end")
  if (selection.slug === "custom") {
    next.set("start", selection.start)
    next.set("end", selection.end)
  }
  return next
}
