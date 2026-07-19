import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown"
import { CaretUpIcon } from "@phosphor-icons/react/CaretUp"
import { FlaskIcon } from "@phosphor-icons/react/Flask"
import { Link, useSearchParams } from "react-router-dom"
import { apiFetch } from "../app/api"
import { formatCurrency } from "../app/format"
import { CategoryIcon } from "../components/CategoryIcon"
import LineChart from "../components/charts/LineChart"
import { readThemeAlpha, readThemeColor } from "../components/charts/chartSetup"
import SegmentedControl from "../components/SegmentedControl"
import {
  FinancialPanel,
  MetricLane,
  SectionHeading,
  WorkspaceToolbar,
} from "../components/product/ProductSurfaces"
import { buildSearchParams } from "../lib/searchParams"
import { AppButton } from "../components/ui/product-button"
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
  end_balance_p10_cents: number | null
  end_balance_p90_cents: number | null
  minimum_balance_cents: number
  crosses_negative: boolean
  breakdown: {
    recurring_rules: ForecastRecurringRow[]
    variable_estimates: ForecastVariableRow[]
    variable_income_estimates: ForecastVariableRow[]
    one_time_events: ForecastOneTimeRow[]
  }
}

type ForecastResponse = {
  horizon: number
  mode: "recurring" | "full"
  start_balance_cents: number
  current_month_net_cents: number
  months: ForecastMonth[]
  model: {
    method: "recurring_only" | "recent_median" | "seasonal_median"
    history_months: number
    seasonality_applied: boolean
    prediction_interval_available: boolean
  }
  summary: {
    projected_balance_cents: number
    projected_balance_p10_cents: number | null
    projected_balance_p90_cents: number | null
    average_monthly_net_cents: number
    months_until_negative: number | null
    risk_months_until_negative: number | null
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
  const horizon: 3 | 6 | 12 =
    horizonRaw === 3 || horizonRaw === 12 ? horizonRaw : 6
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
  const intervalAvailable =
    mode === "full" &&
    data.model.prediction_interval_available &&
    data.months.every(
      (row) =>
        row.end_balance_p10_cents !== null && row.end_balance_p90_cents !== null
    )
  const lowerSeries = [
    data.start_balance_cents,
    ...data.months.map((row) => row.end_balance_p10_cents ?? row.end_balance_cents),
  ]
  const upperSeries = [
    data.start_balance_cents,
    ...data.months.map((row) => row.end_balance_p90_cents ?? row.end_balance_cents),
  ]
  const recurringColor = readThemeColor("--semantic-blue", "100 180 226")
  const recurringFill = readThemeAlpha("--semantic-blue", 0.18, "100 180 226")
  const scenarioColor = readThemeColor("--accent", "245 185 85")
  const intervalFill = readThemeAlpha("--accent", 0.16, "245 185 85")
  const transparent = "rgb(0 0 0 / 0)"

  const chartSeries =
    mode === "full"
      ? [
          ...(intervalAvailable
            ? [
                {
                  label: "80% range low",
                  data: lowerSeries,
                  color: transparent,
                  lineWidth: 0,
                },
                {
                  label: "80% range high",
                  data: upperSeries,
                  color: transparent,
                  fill: 0,
                  fillColor: intervalFill,
                  lineWidth: 0,
                },
              ]
            : []),
          {
            label: "Recurring only",
            data: recurringSeries,
            color: recurringColor,
            dashed: true,
          },
          {
            label: "Expected balance",
            data: scenarioSeries,
            color: scenarioColor,
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
  const formatCrossing = (months: number | null): string =>
    months === null ? "N/A" : months === 0 ? "This month" : String(months)

  return (
    <section className="space-y-4 md:space-y-5">
      <header className="flex min-h-11 flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-head text-2xl font-bold tracking-tight text-text md:text-3xl">
            Forecast
          </h1>
          <p className="mt-1 text-sm text-muted">
            Balance outlook from recurring commitments and recent spending
          </p>
        </div>
        {isFetching ? <span className="loading-hint">Updating…</span> : null}
      </header>

      <WorkspaceToolbar className="justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            value={horizon}
            ariaLabel="Forecast horizon"
            items={[
              { value: 3, label: "3 months" },
              { value: 6, label: "6 months" },
              { value: 12, label: "12 months" },
            ] as Array<{ value: 3 | 6 | 12; label: string }>}
            onValueChange={setHorizon}
          />
          <SegmentedControl
            value={mode}
            ariaLabel="Forecast model"
            items={[
              { value: "recurring", label: "Recurring only" },
              { value: "full", label: "Recurring + estimates" },
            ]}
            onValueChange={setMode}
          />
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
      </WorkspaceToolbar>

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricLane tone="plan">
          <p className="text-sm font-semibold text-text">Projected balance</p>
          <p className="amount-text mt-2 text-2xl text-text">
            {formatCurrency(summary.projected_balance_cents)} €
          </p>
          <p className="mono-meta mt-1 text-muted">After {horizon} months</p>
          {summary.projected_balance_p10_cents !== null &&
          summary.projected_balance_p90_cents !== null ? (
            <p className="mono-meta mt-1 text-muted">
              80% range {formatCurrency(summary.projected_balance_p10_cents)}–
              {formatCurrency(summary.projected_balance_p90_cents)} €
            </p>
          ) : null}
        </MetricLane>
        <MetricLane tone={summary.average_monthly_net_cents >= 0 ? "income" : "expense"}>
          <p className="text-sm font-semibold text-text">Average monthly net</p>
          <p
            className={`amount-text mt-2 text-2xl ${
              summary.average_monthly_net_cents >= 0
                ? "text-semantic-green"
                : "text-semantic-red"
            }`}
          >
            {summary.average_monthly_net_cents >= 0 ? "+" : ""}
            {formatCurrency(summary.average_monthly_net_cents)} €
          </p>
          <p className="mono-meta mt-1 text-muted">Income minus spending</p>
        </MetricLane>
        <MetricLane tone={summary.months_until_negative === null ? "neutral" : "warning"}>
          <p className="text-sm font-semibold text-text">Months until negative</p>
          <p className="amount-text mt-2 text-2xl text-text">
            {formatCrossing(summary.months_until_negative)}
          </p>
          <p className="mono-meta mt-1 text-muted">
            {summary.risk_months_until_negative !== null &&
            summary.risk_months_until_negative !== summary.months_until_negative
              ? `80% range risk: ${formatCrossing(summary.risk_months_until_negative)}`
              : summary.months_until_negative === null
                ? "No crossing in range"
                : "Expected first crossing"}
          </p>
        </MetricLane>
      </div>

      <FinancialPanel role="chart">
        <SectionHeading>
          <div>
            <h2 className="font-head text-lg font-bold">Where is the balance heading?</h2>
            <p className="mt-0.5 text-xs text-muted">
              {mode === "full"
                ? data.model.seasonality_applied
                  ? "Expected balance with seasonal patterns and an 80% prediction range"
                  : data.model.prediction_interval_available
                    ? "Recent median spending with an 80% prediction range"
                    : "Recent median spending · not enough history for a reliable range"
                : "Recurring commitments only"}
            </p>
          </div>
          <span className="mono-meta text-muted">{horizon} months</span>
        </SectionHeading>
        <div className="p-4 md:p-5">
          <LineChart
            ariaLabel="Projected balance by month"
            labels={labels}
            series={chartSeries}
            height={280}
          />
          <p className="mono-meta mt-3 text-muted">
            Includes {formatCurrency(data.current_month_net_cents)} € expected through
            the end of this month
            {mode === "full"
              ? ` · ${data.model.history_months} complete months of history`
              : ""}
          </p>
        </div>
      </FinancialPanel>

      <FinancialPanel role="ledger">
        <SectionHeading>
          <div>
            <h2 className="font-head text-lg font-bold">Monthly outlook</h2>
            <p className="mt-0.5 text-xs text-muted">Open a month for its posting evidence</p>
          </div>
        </SectionHeading>
        <div className="hidden grid-cols-[1.1fr_0.9fr_0.9fr_1fr_auto] gap-3 border-b border-border px-4 py-2.5 text-xs font-semibold text-muted md:grid">
          <span>Month</span>
          <span>Projected income</span>
          <span>Projected expenses</span>
          <span>End balance</span>
          <span className="text-right">Details</span>
        </div>

        <div className="divide-y divide-border">
          {data.months.map((row) => {
            const expanded = Boolean(expandedMonths[row.month])
            return (
              <div
                key={row.month}
                className={row.crosses_negative ? "bg-semantic-red/5" : ""}
              >
                <button
                  type="button"
                  className="grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-faint/60 md:grid-cols-[1.1fr_0.9fr_0.9fr_1fr_auto]"
                  onClick={() =>
                    setExpandedMonths((previous) => ({
                      ...previous,
                      [row.month]: !previous[row.month],
                    }))
                  }
                >
                  <span className="font-semibold text-text">{monthLabel(row.month)}</span>
                  <span className="hidden amount-text text-semantic-green md:block">
                    {formatCurrency(row.projected_income_cents)} €
                  </span>
                  <span className="hidden amount-text text-semantic-red md:block">
                    {formatCurrency(row.projected_expenses_cents)} €
                  </span>
                  <span className="text-right md:text-left">
                    <span
                      className={`amount-text block ${
                        row.end_balance_cents < 0
                          ? "text-semantic-red"
                          : "text-semantic-green"
                      }`}
                    >
                      {formatCurrency(row.end_balance_cents)} €
                    </span>
                    {row.end_balance_p10_cents !== null &&
                    row.end_balance_p90_cents !== null ? (
                      <span className="mono-meta block text-muted">
                        {formatCurrency(row.end_balance_p10_cents)}–
                        {formatCurrency(row.end_balance_p90_cents)} €
                      </span>
                    ) : null}
                  </span>
                  <span className="col-span-2 flex items-center justify-end gap-2 text-xs text-muted md:col-span-1">
                    {row.crosses_negative ? (
                      <span className="chip border-semantic-red/30 bg-semantic-red/10 text-semantic-red">
                        Balance may dip negative
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
                  <div className="grid gap-4 bg-faint/45 px-4 py-4 md:grid-cols-3">
                    <div>
                      <p className="text-sm font-semibold text-text">Recurring postings</p>
                      {row.breakdown.recurring_rules.length ? (
                        <div className="mt-2 space-y-2">
                          {row.breakdown.recurring_rules.map((rule, index) => (
                            <div
                              key={`${row.month}-${index}`}
                              className="flex items-center justify-between gap-3 text-xs"
                            >
                              <span className="truncate text-text">
                                {rule.name}
                                {rule.category_name ? ` · ${rule.category_name}` : ""}
                              </span>
                              <span
                                className={`amount-text shrink-0 ${
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

                    <div>
                      <p className="text-sm font-semibold text-text">Variable spending</p>
                      {row.breakdown.variable_estimates.length ? (
                        <div className="mt-2 space-y-2">
                          {row.breakdown.variable_estimates.map((entry) => (
                            <div
                              key={`${row.month}-var-${entry.category_id}`}
                              className="flex items-center justify-between gap-3 text-xs"
                            >
                              <span className="flex min-w-0 items-center gap-2 text-text">
                                <CategoryIcon
                                  icon={entry.icon}
                                  label={entry.name}
                                  className="h-8 w-8"
                                />
                                <span className="truncate">{entry.name}</span>
                              </span>
                              <span className="amount-text shrink-0 text-semantic-red">
                                -{formatCurrency(entry.amount_cents)} €
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-muted">No variable estimates.</p>
                      )}
                      {row.breakdown.variable_income_estimates.length ? (
                        <>
                          <p className="mt-4 text-sm font-semibold text-text">
                            Variable income
                          </p>
                          <div className="mt-2 space-y-2">
                            {row.breakdown.variable_income_estimates.map((entry) => (
                              <div
                                key={`${row.month}-income-${entry.category_id}`}
                                className="flex items-center justify-between gap-3 text-xs"
                              >
                                <span className="flex min-w-0 items-center gap-2 text-text">
                                  <CategoryIcon
                                    icon={entry.icon}
                                    label={entry.name}
                                    className="h-8 w-8"
                                  />
                                  <span className="truncate">{entry.name}</span>
                                </span>
                                <span className="amount-text shrink-0 text-semantic-green">
                                  +{formatCurrency(entry.amount_cents)} €
                                </span>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : null}
                    </div>

                    <div>
                      <p className="text-sm font-semibold text-text">One-time events</p>
                      <p className="mono-meta mt-1 text-muted">
                        Expected low {formatCurrency(row.minimum_balance_cents)} €
                      </p>
                      {row.breakdown.one_time_events.length ? (
                        <div className="mt-2 space-y-2">
                          {row.breakdown.one_time_events.map((entry, index) => (
                            <div
                              key={`${row.month}-one-${index}`}
                              className="flex items-center justify-between gap-3 text-xs"
                            >
                              <span className="truncate text-text">{entry.name}</span>
                              <span
                                className={`amount-text shrink-0 ${
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
                      ) : (
                        <p className="mt-2 text-xs text-muted">No one-time events.</p>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </FinancialPanel>
    </section>
  )
}

export default ForecastPage
