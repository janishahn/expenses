import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowLeftIcon } from "@phosphor-icons/react/ArrowLeft"
import { ArrowRightIcon } from "@phosphor-icons/react/ArrowRight"
import { TrendUpIcon } from "@phosphor-icons/react/TrendUp"
import { useSearchParams } from "react-router-dom"
import { apiFetch } from "../app/api"
import { formatCurrency, formatEuroDate } from "../app/format"
import { CategoryIcon } from "../components/CategoryIcon"
import { palette } from "../components/charts/palette"
import {
  FinancialPanel,
  MetricLane,
  SectionHeading,
  WorkspaceToolbar,
} from "../components/product/ProductSurfaces"
import TransactionDescription from "../components/TransactionDescription"
import { AppButton } from "../components/ui/product-button"

type DigestCategory = {
  category_id: number
  name: string
  icon: string | null
  amount_cents: number
  bar_percent: number
  trailing_weekly_avg_cents: number
  is_above_trailing_50: boolean
}

type DigestBudgetPulse = {
  scope_category_id: number | null
  scope_label: string
  amount_cents: number
  spent_cents: number
  used_percent: number
  days_left: number
  velocity_ratio: number
  pace_state: "under" | "on" | "over"
}

type DigestUnusual = {
  id: number
  date: string
  title: string
  amount_cents: number
  trailing_avg_cents: number
  category: { id: number; name: string; icon: string | null } | null
  description?: string | null
}

type DigestRecurring = {
  transaction_id: number
  rule_id: number | null
  rule_name: string
  date: string
  amount_cents: number
  category: { id: number; name: string; icon: string | null } | null
}

type DigestResponse = {
  week_start: string
  week_end: string
  headline: {
    total_spent_cents: number
    vs_last_week_cents: number
    vs_four_week_avg_cents: number
    transaction_count: number
  }
  top_categories: DigestCategory[]
  budget_pulse: DigestBudgetPulse[]
  unusual_transactions: DigestUnusual[]
  recurring_postings: DigestRecurring[]
}

function formatWeekRange(startIso: string, endIso: string): string {
  const start = new Date(`${startIso}T00:00:00`)
  const end = new Date(`${endIso}T00:00:00`)
  const startLabel = start.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  })
  const endLabel = end.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
  return `${startLabel} - ${endLabel}`
}

function shiftWeekMonday(weekStartIso: string, deltaDays: number): string {
  const base = new Date(`${weekStartIso}T00:00:00`)
  const shifted = new Date(base)
  shifted.setDate(shifted.getDate() + deltaDays)
  const year = shifted.getFullYear()
  const month = String(shifted.getMonth() + 1).padStart(2, "0")
  const day = String(shifted.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function deltaClass(value: number): string {
  if (value > 0) return "text-semantic-red"
  if (value < 0) return "text-semantic-green"
  return "text-muted"
}

function deltaTone(value: number): "income" | "expense" | "neutral" {
  if (value > 0) return "expense"
  if (value < 0) return "income"
  return "neutral"
}

function paceDotClass(state: DigestBudgetPulse["pace_state"]): string {
  if (state === "under") return "bg-semantic-green"
  if (state === "over") return "bg-semantic-red"
  return "bg-accent-soft"
}

function DigestPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const queryString = useMemo(() => {
    const params = new URLSearchParams(searchParams)
    const weekOf = params.get("week_of")
    if (!weekOf) {
      return ""
    }
    return params.toString()
  }, [searchParams])

  const { data, isLoading, error } = useQuery({
    queryKey: ["digest", queryString],
    queryFn: () =>
      apiFetch<DigestResponse>(
        queryString ? `/api/digest?${queryString}` : "/api/digest"
      ),
  })

  const setWeekOf = (weekStart: string, direction: "prev" | "next") => {
    const params = new URLSearchParams(searchParams)
    params.set("week_of", shiftWeekMonday(weekStart, direction === "prev" ? -7 : 7))
    setSearchParams(params)
  }

  if (isLoading) {
    return <div className="text-muted">Loading digest…</div>
  }
  if (error || !data) {
    return <div className="text-semantic-red">Unable to load digest.</div>
  }

  const topCategoryTotal = data.top_categories.reduce(
    (total, category) => total + category.amount_cents,
    0
  )
  const compositionTotal = Math.max(
    data.headline.total_spent_cents,
    topCategoryTotal
  )
  const otherCents = Math.max(0, compositionTotal - topCategoryTotal)
  const composition = [
    ...data.top_categories.map((category, index) => ({
      key: String(category.category_id),
      name: category.name,
      icon: category.icon,
      amountCents: category.amount_cents,
      color: palette[index % palette.length],
    })),
    ...(otherCents > 0
      ? [{
          key: "other",
          name: "Other",
          icon: null,
          amountCents: otherCents,
          color: "rgb(var(--border-hi))",
        }]
      : []),
  ]

  return (
    <section className="space-y-4 md:space-y-5">
      <header className="min-h-11">
        <h1 className="font-head text-2xl font-bold tracking-tight text-text md:text-3xl">
          Digest
        </h1>
        <p className="mt-1 text-sm text-muted">A weekly pulse on spending, pace, and exceptions</p>
      </header>

      <WorkspaceToolbar className="w-fit">
        <AppButton
          type="button"
          onClick={() => setWeekOf(data.week_start, "prev")}
          tone="ghost"
          className="h-11 w-11 px-0 py-0 text-muted"
          aria-label="Previous week"
        >
          <ArrowLeftIcon className="h-4 w-4" />
        </AppButton>
        <p className="amount-text min-w-[11.5rem] text-center text-sm text-text">
          {formatWeekRange(data.week_start, data.week_end)}
        </p>
        <AppButton
          type="button"
          onClick={() => setWeekOf(data.week_start, "next")}
          tone="ghost"
          className="h-11 w-11 px-0 py-0 text-muted"
          aria-label="Next week"
        >
          <ArrowRightIcon className="h-4 w-4" />
        </AppButton>
      </WorkspaceToolbar>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricLane tone="expense">
          <p className="text-sm font-semibold text-text">Total spent</p>
          <p className="amount-text mt-2 text-2xl text-semantic-red">
            {formatCurrency(data.headline.total_spent_cents)} €
          </p>
          <p className="mono-meta mt-1 text-muted">This week</p>
        </MetricLane>
        <MetricLane tone={deltaTone(data.headline.vs_last_week_cents)}>
          <p className="text-sm font-semibold text-text">vs. last week</p>
          <p className={`amount-text mt-2 text-xl ${deltaClass(data.headline.vs_last_week_cents)}`}>
            {data.headline.vs_last_week_cents > 0 ? "+" : ""}
            {formatCurrency(data.headline.vs_last_week_cents)} €
          </p>
          <p className="mono-meta mt-1 text-muted">Weekly change</p>
        </MetricLane>
        <MetricLane tone={deltaTone(data.headline.vs_four_week_avg_cents)}>
          <p className="text-sm font-semibold text-text">vs. 4-week avg</p>
          <p className={`amount-text mt-2 text-xl ${deltaClass(data.headline.vs_four_week_avg_cents)}`}>
            {data.headline.vs_four_week_avg_cents > 0 ? "+" : ""}
            {formatCurrency(data.headline.vs_four_week_avg_cents)} €
          </p>
          <p className="mono-meta mt-1 text-muted">Rolling comparison</p>
        </MetricLane>
        <MetricLane tone="neutral">
          <p className="text-sm font-semibold text-text">Transactions</p>
          <p className="amount-text mt-2 text-2xl text-text">
            {data.headline.transaction_count}
          </p>
          <p className="mono-meta mt-1 text-muted">Posted this week</p>
        </MetricLane>
      </div>

      {compositionTotal > 0 ? (
        <FinancialPanel role="chart" data-testid="digest-weekly-composition">
          <SectionHeading>
            <div>
              <h2 className="font-head text-lg font-bold">This week at a glance</h2>
              <p className="mt-0.5 text-xs text-muted">
                Category share of total spending
              </p>
            </div>
            <span className="amount-text text-sm text-semantic-red">
              {formatCurrency(compositionTotal)} €
            </span>
          </SectionHeading>
          <div className="p-4 md:p-5">
            <div
              role="img"
              aria-label={`Weekly spending composition. ${composition
                .map(
                  (segment) =>
                    `${segment.name} ${formatCurrency(segment.amountCents)} euros`
                )
                .join(", ")}`}
              className="flex h-14 overflow-hidden rounded-lg bg-faint"
            >
              {composition.map((segment) => {
                const percent = (segment.amountCents / compositionTotal) * 100
                return (
                  <div
                    key={segment.key}
                    className="group relative flex min-w-[3px] items-center justify-center overflow-hidden transition-[filter] duration-150 hover:brightness-105"
                    style={{
                      width: `${percent}%`,
                      backgroundColor: segment.color,
                    }}
                    title={`${segment.name}: ${formatCurrency(segment.amountCents)} €`}
                  >
                    {percent >= 13 ? (
                      <span className="truncate px-2 text-xs font-bold text-white drop-shadow-sm">
                        {segment.name}
                      </span>
                    ) : null}
                  </div>
                )
              })}
            </div>
            <div className="mt-4 grid gap-x-5 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
              {composition.map((segment) => (
                <div key={segment.key} className="flex min-w-0 items-center gap-2.5">
                  {segment.icon ? (
                    <CategoryIcon icon={segment.icon} label={segment.name} />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="h-3 w-3 shrink-0 rounded-[3px]"
                      style={{ backgroundColor: segment.color }}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-text">
                      {segment.name}
                    </p>
                    <p className="mono-meta text-muted">
                      {Math.round((segment.amountCents / compositionTotal) * 100)}%
                    </p>
                  </div>
                  <span className="amount-text shrink-0 text-xs text-text">
                    {formatCurrency(segment.amountCents)} €
                  </span>
                </div>
              ))}
            </div>
          </div>
        </FinancialPanel>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <FinancialPanel role="chart">
          <SectionHeading>
            <div>
              <h2 className="font-head text-lg font-bold">Top 5 categories this week</h2>
              <p className="mt-0.5 text-xs text-muted">Compared with trailing weekly averages</p>
            </div>
          </SectionHeading>
          <div className="space-y-3 p-4">
            {data.top_categories.length ? (
              data.top_categories.map((row) => (
                <div key={row.category_id} className="space-y-2">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-3 text-text">
                      <CategoryIcon icon={row.icon} label={row.name} />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{row.name}</span>
                        <span className="mono-meta text-muted">
                          Avg {formatCurrency(row.trailing_weekly_avg_cents)} €
                        </span>
                      </span>
                    </span>
                    <span className="amount-text inline-flex shrink-0 items-center gap-1 text-semantic-red">
                      {formatCurrency(row.amount_cents)} €
                      {row.is_above_trailing_50 ? (
                        <TrendUpIcon className="h-3.5 w-3.5" aria-label="Above trailing average" />
                      ) : null}
                    </span>
                  </div>
                  <div className="h-[5px] rounded-full bg-faint">
                    <div
                      className="h-[5px] rounded-full bg-semantic-red"
                      style={{ width: `${Math.max(0, Math.min(100, row.bar_percent))}%` }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted">No spending in this week.</p>
            )}
          </div>
        </FinancialPanel>

        <FinancialPanel role="ledger">
          <SectionHeading>
            <div>
              <h2 className="font-head text-lg font-bold">Budget status as of this week</h2>
              <p className="mt-0.5 text-xs text-muted">Pace against active monthly plans</p>
            </div>
          </SectionHeading>
          <div className="divide-y divide-border px-4">
            {data.budget_pulse.length ? (
              data.budget_pulse.map((row) => (
                <div
                  key={`${row.scope_category_id ?? "overall"}-${row.scope_label}`}
                  className="py-3.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-text">{row.scope_label}</p>
                      <p className="mono-meta mt-0.5 text-muted">
                        {formatCurrency(row.spent_cents)} € of {formatCurrency(row.amount_cents)} € · {row.days_left} days left
                      </p>
                    </div>
                    <span className="amount-text shrink-0 text-sm text-text">
                      {Math.round(row.used_percent)}%
                    </span>
                  </div>
                  <div className="mt-2.5 h-[5px] rounded-full bg-faint">
                    <div
                      className={`h-[5px] rounded-full ${paceDotClass(row.pace_state)}`}
                      style={{ width: `${Math.max(0, Math.min(100, row.used_percent))}%` }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <p className="py-5 text-sm text-muted">No active budgets this month.</p>
            )}
          </div>
        </FinancialPanel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <FinancialPanel role="ledger">
          <SectionHeading>
            <div>
              <h2 className="font-head text-lg font-bold">Flagged this week</h2>
              <p className="mt-0.5 text-xs text-muted">Transactions above their category norm</p>
            </div>
          </SectionHeading>
          <div className="divide-y divide-border px-4">
            {data.unusual_transactions.length ? (
              data.unusual_transactions.map((row) => (
                <div key={row.id} className="flex items-start justify-between gap-3 py-3.5">
                  <div className="flex min-w-0 items-start gap-3">
                    <CategoryIcon
                      icon={row.category?.icon ?? null}
                      label={row.category?.name ?? "Uncategorized"}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-text">
                        {row.title || row.category?.name || "Untitled"}
                      </p>
                      <TransactionDescription
                        markdown={row.description}
                        compact
                        clamp
                        className="mt-1"
                      />
                      <p className="mt-1 text-xs text-muted">
                        {row.category?.name ?? "Category"} average · {formatCurrency(row.trailing_avg_cents)} €
                      </p>
                    </div>
                  </div>
                  <p className="amount-text shrink-0 text-sm text-semantic-red">
                    {formatCurrency(row.amount_cents)} €
                  </p>
                </div>
              ))
            ) : (
              <p className="py-5 text-sm text-muted">Nothing unusual this week.</p>
            )}
          </div>
        </FinancialPanel>

        <FinancialPanel role="ledger">
          <SectionHeading>
            <div>
              <h2 className="font-head text-lg font-bold">Auto-posted this week</h2>
              <p className="mt-0.5 text-xs text-muted">Commitments posted from recurring rules</p>
            </div>
          </SectionHeading>
          <div className="divide-y divide-border px-4">
            {data.recurring_postings.length ? (
              data.recurring_postings.map((row) => (
                <div
                  key={row.transaction_id}
                  className="flex items-center justify-between gap-3 py-3.5"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <CategoryIcon
                      icon={row.category?.icon ?? null}
                      label={row.category?.name ?? "Uncategorized"}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-text">
                        {row.rule_name || "Recurring rule"}
                      </p>
                      <p className="mono-meta mt-0.5 text-muted">
                        {row.category?.name ?? "Uncategorized"} · {formatEuroDate(row.date)}
                      </p>
                    </div>
                  </div>
                  <p className="amount-text shrink-0 text-sm text-semantic-red">
                    {formatCurrency(row.amount_cents)} €
                  </p>
                </div>
              ))
            ) : (
              <p className="py-5 text-sm text-muted">No recurring postings this week.</p>
            )}
          </div>
        </FinancialPanel>
      </div>
    </section>
  )
}

export default DigestPage
