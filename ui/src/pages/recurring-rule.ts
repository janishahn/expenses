import type { CategorySummary } from "../app/api-types"

export type IntervalUnit = "day" | "week" | "month" | "year"
export type MonthDayPolicy = "snap_to_end" | "skip" | "carry_forward"
export type Currency = "EUR" | "USD"

export type RecurringRule = {
  id: number
  name: string | null
  type: "income" | "expense"
  currency_code: Currency
  amount_cents: number
  // In euros, converted for dollar rules.
  monthly_equivalent_cents: number
  category_id: number
  category: CategorySummary | null
  anchor_date: string
  interval_unit: IntervalUnit
  interval_count: number
  next_occurrence: string
  end_date: string | null
  auto_post: boolean
  skip_weekends: boolean
  month_day_policy: MonthDayPolicy
}

export type RecurringResponse = {
  rules: RecurringRule[]
  stats: {
    total_monthly_income: number
    total_monthly_expenses: number
    net_monthly: number
    coverage_ratio: number
    rule_counts: { income: number; expense: number; total: number }
  }
  categories: CategorySummary[]
}

export type OccurrencesResponse = {
  rule: {
    id: number
    name: string | null
    type: "income" | "expense"
    currency_code: Currency
    amount_cents: number
    category: CategorySummary | null
    interval_unit: IntervalUnit
    interval_count: number
    anchor_date: string
    next_occurrence: string
    end_date: string | null
    auto_post: boolean
  }
  occurrences: Array<{
    id: number
    occurrence_date: string | null
    amount_cents: number
    category: { id: number; name: string } | null
    title: string | null
    created_at: string | null
  }>
}

// The body of POST and PUT /api/recurring.
export type RulePayload = {
  name: string | null
  type: "income" | "expense"
  currency_code: Currency
  amount_cents: number
  category_id: number
  anchor_date: string
  interval_unit: IntervalUnit
  interval_count: number
  next_occurrence: string
  end_date: string | null
  auto_post: boolean
  skip_weekends: boolean
  month_day_policy: MonthDayPolicy
}

export const MONTH_DAY_POLICIES: Array<{ value: MonthDayPolicy; label: string }> = [
  { value: "snap_to_end", label: "Post on last day" },
  { value: "skip", label: "Skip that month" },
  { value: "carry_forward", label: "Use previous month's day" },
]

const SHORT_MONTH = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" })
const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" })

function isoDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`)
}

// "13 Nov"; en-GB would write "Sept".
function dayMonth(date: Date): string {
  return `${date.getUTCDate()} ${SHORT_MONTH.format(date)}`
}

export function ruleLabel(rule: { name: string | null; category: { name: string } | null }): string {
  return rule.name || rule.category?.name || "Untitled"
}

export function rulePayload(rule: RecurringRule): RulePayload {
  return {
    name: rule.name,
    type: rule.type,
    currency_code: rule.currency_code,
    amount_cents: rule.amount_cents,
    category_id: rule.category_id,
    anchor_date: rule.anchor_date,
    interval_unit: rule.interval_unit,
    interval_count: rule.interval_count,
    next_occurrence: rule.next_occurrence,
    end_date: rule.end_date,
    auto_post: rule.auto_post,
    skip_weekends: rule.skip_weekends,
    month_day_policy: rule.month_day_policy,
  }
}

// "Every month", "Every 4 weeks".
export function repeatsText(unit: IntervalUnit, count: number): string {
  return count === 1 ? `Every ${unit}` : `Every ${count} ${unit}s`
}

function ordinal(day: number): string {
  const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th"
  return `${day}${suffix}`
}

// "Every month on the 13th", "Every year on 1 Mar", "Every 2 weeks on Friday".
export function scheduleText(unit: IntervalUnit, count: number, anchor: string): string {
  const date = isoDate(anchor)
  const repeats = repeatsText(unit, count)
  if (unit === "month") return `${repeats} on the ${ordinal(date.getUTCDate())}`
  if (unit === "year") return `${repeats} on ${dayMonth(date)}`
  if (unit === "week") return `${repeats} on ${WEEKDAY.format(date)}`
  return repeats
}

// Days past the 28th need a rule for shorter months.
export function needsMonthDayPolicy(unit: IntervalUnit, anchor: string): boolean {
  return (unit === "month" || unit === "year") && Number(anchor.slice(8, 10)) > 28
}

// "13 Nov" this year, "13 Nov 2027" otherwise.
export function shortDate(iso: string, now: Date): string {
  const date = isoDate(iso)
  return date.getUTCFullYear() === now.getFullYear() ? dayMonth(date) : `${dayMonth(date)} ${date.getUTCFullYear()}`
}

export function fullDate(iso: string): string {
  const date = isoDate(iso)
  return `${dayMonth(date)} ${date.getUTCFullYear()}`
}
