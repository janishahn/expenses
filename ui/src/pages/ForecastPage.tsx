import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown"
import { CaretUpIcon } from "@phosphor-icons/react/CaretUp"
import { FlaskIcon } from "@phosphor-icons/react/Flask"
import { Link, useSearchParams } from "react-router-dom"
import { apiFetch } from "../app/api"
import { formatCurrency } from "../app/format"
import LineChart from "../components/charts/LineChart"
import { readThemeAlpha, readThemeColor } from "../components/charts/chartSetup"
import PageIntro from "../components/PageIntro"
import { buildSearchParams } from "../lib/searchParams"
import { AppButton } from "../components/ui/product-button"
import { AppCard } from "../components/ui/product-card"
import { useThemePreference } from "../theme/useThemePreference"

type ForecastRecurringRow = {
  rule_id: number | null
  name: string
  type: "income" | "expense"
  amount_cents: number
  occurrence_date: string
  category_id: number | null
  category_name: string | null
}

type ForecastVariableRow = {
  category_id: number
  name: string
  icon: string | null
  amount_cents: number
}

type ForecastOneTimeRow = {
  name: string
  type: "income" | "expense"
  amount_cents: number
}

type ForecastMonth = {
  month: string
  projected_income_cents: number
  projected_expenses_cents: number
  projected_net_cents: number
  end_balance_cents: number
  crosses_negative: boolean
  breakdown: {
    recurring_rules: ForecastRecurringRow[]
    variable_estimates: ForecastVariableRow[]
    one_time_events: ForecastOneTimeRow[]
  }
}

type ForecastResponse = {
  horizon: number
  mode: "recurring" | "full"
  start_balance_cents: number
  months: ForecastMonth[]
  summary: {
    projected_balance_cents: number
    average_monthly_net_cents: number
    months_until_negative: number | null
  }
}

function monthLabel(month: string): string {
  const value = new Date(`${month}-01T00:00:00`)
  return value.toLocaleDateString("en-GB", { month: "short", year: "numeric" })
}

function ForecastPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({})
  useThemePreference()

  const horizonRaw = Number(searchParams.get("horizon") || "6")
  const horizon = [3, 6, 12].includes(horizonRaw) ? horizonRaw : 6
  const modeRaw = (searchParams.get("mode") || "full").toLowerCase()
  const mode: "recurring" | "full" =
    modeRaw === "recurring" ? "recurring" : "full"

  const setHorizon = (value: 3 | 6 | 12) =>
    setSearchParams(buildSearchParams(searchParams, { horizon: String(value) }))

  const setMode = (value: "recurring" | "full") =>
    setSearchParams(buildSearchParams(searchParams, { mode: value }))

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["forecast", horizon, mode],
    queryFn: () =>
      apiFetch<ForecastResponse>(`/api/forecast?horizon=${horizon}&mode=${mode}`),
  })

  const { data: recurringReference } = useQuery({
    queryKey: ["forecast", horizon, "recurring-reference"],
    queryFn: () =>
      apiFetch<ForecastResponse>(
        `/api/forecast?horizon=${horizon}&mode=recurring`
      ),
    enabled: mode === "full",
  })

  if (isLoading) {
    return <div className="text-muted">Loading forecast…</div>
  }
  if (error || !data) {
    return <div className="text-semantic-red">Unable to load forecast.</div>
  }

  const recurringSeriesSource =
    mode === "full" && recurringReference ? recurringReference : data
  const labels = ["Now", ...data.months.map((row) => monthLabel(row.month))]
  const recurringSeries = [
    data.start_balance_cents,
    ...recurringSeriesSource.months.map((row) => row.end_balance_cents),
  ]
  const scenarioSeries = [
    data.start_balance_cents,
    ...data.months.map((row) => row.end_balance_cents),
  ]
  const deltaAtEnd = scenarioSeries[scenarioSeries.length - 1] - recurringSeries[recurringSeries.length - 1]
  const recurringColor = readThemeColor("--semantic-blue", "100 180 226")
  const recurringFill = readThemeAlpha("--semantic-blue", 0.18, "100 180 226")
  const scenarioColor = readThemeColor("--accent", "245 185 85")
  const positiveDeltaFill = readThemeAlpha("--semantic-green", 0.18, "98 196 146")
  const negativeDeltaFill = readThemeAlpha("--semantic-red", 0.18, "224 114 102")

  const chartSeries =
    mode === "full"
      ? [
          {
            label: "Recurring only",
            data: recurringSeries,
            color: recurringColor,
          },
          {
            label: "Recurring + estimates",
            data: scenarioSeries,
            color: scenarioColor,
            fill: 0,
            fillColor: deltaAtEnd >= 0 ? positiveDeltaFill : negativeDeltaFill,
          },
        ]
      : [
          {
            label: "Projected balance",
            data: recurringSeries,
            color: recurringColor,
            fill: true,
            fillColor: recurringFill,
          },
        ]

  const summary = data.summary

  return (
    <section className="space-y-6">
      <PageIntro
        title="Forecast"
        actions={isFetching ? <span className="loading-hint">Updating…</span> : null}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="pill-group">
            {[3, 6, 12].map((value) => (
              <button
                key={value}
                type="button"
                className={`pill-button ${horizon === value ? "pill-button-active" : ""}`}
                onClick={() => setHorizon(value as 3 | 6 | 12)}
              >
                {value} months
              </button>
            ))}
          </div>
          <div className="pill-group">
            <button
              type="button"
              className={`pill-button ${mode === "recurring" ? "pill-button-active" : ""}`}
              onClick={() => setMode("recurring")}
            >
              Recurring only
            </button>
            <button
              type="button"
              className={`pill-button ${mode === "full" ? "pill-button-active" : ""}`}
              onClick={() => setMode("full")}
            >
              Recurring + estimates
            </button>
          </div>
        </div>
        <AppButton
          tone="ghost"
          asChild
          className="gap-1.5 px-3 py-1.5 text-xs text-muted"
        >
          <Link to={`/scenarios?horizon=${horizon}&mode=${mode}`}>
            <FlaskIcon className="h-3.5 w-3.5" />
            What if?
          </Link>
        </AppButton>
      </div>

      <AppCard className="p-5">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">
              Projected balance
            </p>
            <p className="font-mono text-2xl font-semibold text-text">
              {formatCurrency(summary.projected_balance_cents)} €
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Monthly net</p>
            <p
              className={`font-mono text-2xl font-semibold ${
                summary.average_monthly_net_cents >= 0
                  ? "text-semantic-green"
                  : "text-semantic-red"
              }`}
            >
              {summary.average_monthly_net_cents >= 0 ? "+" : ""}
              {formatCurrency(summary.average_monthly_net_cents)} €
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">
              Months until negative
            </p>
            <p className="font-mono text-2xl font-semibold text-text">
              {summary.months_until_negative === null
                ? "N/A"
                : String(summary.months_until_negative)}
            </p>
          </div>
        </div>
      </AppCard>

      <AppCard className="p-5">
        <LineChart
          labels={labels}
          series={chartSeries}
          height={280}
        />
      </AppCard>

      <AppCard className="divide-y divide-border">
        <div className="flex items-center gap-3 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted md:grid md:grid-cols-[1.1fr_0.9fr_0.9fr_1fr_auto]">
          <span className="flex-1 md:flex-none">Month</span>
          <span className="hidden md:block">Projected income</span>
          <span className="hidden md:block">Projected expenses</span>
          <span>End balance</span>
          <span className="hidden text-right md:block">Details</span>
        </div>

        {data.months.map((row) => {
          const expanded = Boolean(expandedMonths[row.month])
          const isNegative = row.end_balance_cents < 0
          return (
            <div key={row.month} className={row.crosses_negative ? "border-l-2 border-semantic-red" : ""}>
              <button
                type="button"
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-faint md:grid md:grid-cols-[1.1fr_0.9fr_0.9fr_1fr_auto]"
                onClick={() =>
                  setExpandedMonths((previous) => ({
                    ...previous,
                    [row.month]: !previous[row.month],
                  }))
                }
              >
                <span className="flex-1 font-semibold text-text md:flex-none">{monthLabel(row.month)}</span>
                <span className="hidden font-mono text-semantic-green md:block">
                  {formatCurrency(row.projected_income_cents)} €
                </span>
                <span className="hidden font-mono text-semantic-red md:block">
                  {formatCurrency(row.projected_expenses_cents)} €
                </span>
                <span
                  className={`font-mono ${isNegative ? "text-semantic-red" : "text-semantic-green"}`}
                >
                  {formatCurrency(row.end_balance_cents)} €
                </span>
                <span className="flex items-center justify-end gap-2 text-xs text-muted">
                  {row.crosses_negative ? (
                    <span className="rounded-full border border-semantic-red/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-semantic-red">
                      Balance goes negative
                    </span>
                  ) : null}
                  {expanded ? (
                    <CaretUpIcon className="h-4 w-4" />
                  ) : (
                    <CaretDownIcon className="h-4 w-4" />
                  )}
                </span>
              </button>

              {expanded ? (
                <div className="space-y-4 px-4 pb-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Recurring postings
                    </p>
                    {row.breakdown.recurring_rules.length ? (
                      <div className="mt-2 space-y-1">
                        {row.breakdown.recurring_rules.map((rule, index) => (
                          <div key={`${row.month}-${index}`} className="flex items-center justify-between gap-3 text-xs">
                            <span className="truncate text-text">
                              {rule.name}
                              {rule.category_name ? ` · ${rule.category_name}` : ""}
                            </span>
                            <span
                              className={`shrink-0 font-mono ${
                                rule.type === "income"
                                  ? "text-semantic-green"
                                  : "text-semantic-red"
                              }`}
                            >
                              {rule.type === "income" ? "+" : "-"}
                              {formatCurrency(rule.amount_cents)} €
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-muted">No recurring postings.</p>
                    )}
                  </div>

                  {row.breakdown.variable_estimates.length ? (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                        Variable estimates
                      </p>
                      <div className="mt-2 space-y-1">
                        {row.breakdown.variable_estimates.map((entry) => (
                          <div key={`${row.month}-var-${entry.category_id}`} className="flex items-center justify-between gap-3 text-xs">
                            <span className="truncate text-text">{entry.name}</span>
                            <span className="shrink-0 font-mono text-semantic-red">
                              -{formatCurrency(entry.amount_cents)} €
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {row.breakdown.one_time_events.length ? (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                        One-time events
                      </p>
                      <div className="mt-2 space-y-1">
                        {row.breakdown.one_time_events.map((entry, index) => (
                          <div key={`${row.month}-one-${index}`} className="flex items-center justify-between gap-3 text-xs">
                            <span className="truncate text-text">{entry.name}</span>
                            <span
                              className={`shrink-0 font-mono ${
                                entry.type === "income"
                                  ? "text-semantic-green"
                                  : "text-semantic-red"
                              }`}
                            >
                              {entry.type === "income" ? "+" : "-"}
                              {formatCurrency(entry.amount_cents)} €
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </AppCard>
    </section>
  )
}

export default ForecastPage
