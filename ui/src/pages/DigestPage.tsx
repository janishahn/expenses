import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowLeftIcon } from "@phosphor-icons/react/ArrowLeft"
import { ArrowRightIcon } from "@phosphor-icons/react/ArrowRight"
import { TrendUpIcon } from "@phosphor-icons/react/TrendUp"
import { useSearchParams } from "react-router-dom"
import { apiFetch } from "../app/api"
import { formatCurrency } from "../app/format"
import { CategoryIcon } from "../components/CategoryIcon"
import PageIntro from "../components/PageIntro"
import TransactionDescription from "../components/TransactionDescription"
import { AppButton } from "../components/ui/product-button"
import { AppCard } from "../components/ui/product-card"

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

  return (
    <section className="space-y-6">
      <PageIntro title="Digest" />

      <div className="flex items-center gap-3">
        <AppButton
          type="button"
          onClick={() => setWeekOf(data.week_start, "prev")}
          tone="ghost"
          className="h-10 w-10 px-0 py-0 text-muted"
          aria-label="Previous week"
        >
          <ArrowLeftIcon className="h-4 w-4" />
        </AppButton>
        <p className="font-mono text-sm text-text">
          {formatWeekRange(data.week_start, data.week_end)}
        </p>
        <AppButton
          type="button"
          onClick={() => setWeekOf(data.week_start, "next")}
          tone="ghost"
          className="h-10 w-10 px-0 py-0 text-muted"
          aria-label="Next week"
        >
          <ArrowRightIcon className="h-4 w-4" />
        </AppButton>
      </div>

      <AppCard className="p-5">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Total spent</p>
            <p className="font-mono text-2xl font-semibold text-semantic-red">
              {formatCurrency(data.headline.total_spent_cents)} €
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">vs. last week</p>
            <p className={`font-mono text-lg font-semibold ${deltaClass(data.headline.vs_last_week_cents)}`}>
              {data.headline.vs_last_week_cents > 0 ? "+" : ""}
              {formatCurrency(data.headline.vs_last_week_cents)} €
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">vs. 4-week avg</p>
            <p className={`font-mono text-lg font-semibold ${deltaClass(data.headline.vs_four_week_avg_cents)}`}>
              {data.headline.vs_four_week_avg_cents > 0 ? "+" : ""}
              {formatCurrency(data.headline.vs_four_week_avg_cents)} €
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Transactions</p>
            <p className="font-mono text-lg font-semibold text-muted">
              {data.headline.transaction_count}
            </p>
          </div>
        </div>
      </AppCard>

      <AppCard className="p-5">
        <h2 className="font-head text-lg font-bold">Top 5 categories this week</h2>
        <div className="mt-4 space-y-3">
          {data.top_categories.length ? (
            data.top_categories.map((row) => (
              <div key={row.category_id} className="space-y-1">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2 text-text">
                    <CategoryIcon icon={row.icon} />
                    <span className="truncate">{row.name}</span>
                  </span>
                  <span className="inline-flex items-center gap-1 font-mono text-semantic-red">
                    {formatCurrency(row.amount_cents)} €
                    {row.is_above_trailing_50 ? (
                      <TrendUpIcon className="h-3.5 w-3.5 text-semantic-red" />
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
      </AppCard>

      <AppCard className="p-5">
        <h2 className="font-head text-lg font-bold">Budget status as of this week</h2>
        <div className="mt-4 space-y-3">
          {data.budget_pulse.length ? (
            data.budget_pulse.map((row) => (
              <div
                key={`${row.scope_category_id ?? "overall"}-${row.scope_label}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-text">{row.scope_label}</p>
                  <p className="text-xs font-mono text-muted">
                    {formatCurrency(row.spent_cents)} € of {formatCurrency(row.amount_cents)} € used ({Math.round(row.used_percent)}%) - {row.days_left} days left
                  </p>
                </div>
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${paceDotClass(row.pace_state)}`}
                  aria-hidden
                />
              </div>
            ))
          ) : (
            <p className="text-sm text-muted">No active budgets this month.</p>
          )}
        </div>
      </AppCard>

      <AppCard className="p-5">
        <h2 className="font-head text-lg font-bold">Flagged this week</h2>
        <div className="mt-4 space-y-3">
          {data.unusual_transactions.length ? (
            data.unusual_transactions.map((row) => (
              <div
                key={row.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg px-3 py-2"
              >
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
                  <p className="text-xs text-muted">
                    avg for {row.category?.name ?? "Category"} is {formatCurrency(row.trailing_avg_cents)} €
                  </p>
                </div>
                <p className="shrink-0 font-mono text-sm font-semibold text-semantic-red">
                  {formatCurrency(row.amount_cents)} €
                </p>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted">Nothing unusual this week.</p>
          )}
        </div>
      </AppCard>

      <AppCard className="p-5">
        <h2 className="font-head text-lg font-bold">Auto-posted this week</h2>
        <div className="mt-4 space-y-3">
          {data.recurring_postings.length ? (
            data.recurring_postings.map((row) => (
              <div
                key={row.transaction_id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-text">
                    {row.rule_name || "Recurring rule"}
                  </p>
                  <p className="text-xs text-muted">{row.category?.name ?? "Uncategorized"}</p>
                </div>
                <p className="shrink-0 font-mono text-sm font-semibold text-semantic-red">
                  {formatCurrency(row.amount_cents)} €
                </p>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted">No recurring postings this week.</p>
          )}
        </div>
      </AppCard>
    </section>
  )
}

export default DigestPage
