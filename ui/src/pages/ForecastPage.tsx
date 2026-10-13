import { useQuery } from "@tanstack/react-query"
import { FlaskIcon } from "@phosphor-icons/react/Flask"
import { InfoIcon } from "@phosphor-icons/react/Info"
import { WarningIcon } from "@phosphor-icons/react/Warning"
import { useSearchParams } from "react-router-dom"
import { apiFetch } from "../app/api"
import type { CategoriesResponse } from "../app/api-types"
import { formatAmount } from "../app/format"
import { Amount } from "../components/ui/Amount"
import { IconButton, LinkButton } from "../components/ui/Button"
import { CategoryGlyph } from "../components/ui/CategoryGlyph"
import { ChartCard, ChartTable, ChartTooltip, type LegendEntry } from "../components/ui/ChartCard"
import { LineChart } from "../components/ui/Charts"
import { EmptyState, Status } from "../components/ui/EmptyState"
import { useIsDesktop } from "../components/ui/layout-state"
import { AmountCell, Cell, List, ListHead, Row, type Columns } from "../components/ui/LedgerRow"
import { Panel, PanelError, PanelLoading, ViewRow } from "../components/ui/Panel"
import { Peek, PeekHeadline, PeekLayout, PeekSection } from "../components/ui/Peek"
import { Property, PropertyList } from "../components/ui/PropertyList"
import { SegmentedControl } from "../components/ui/SegmentedControl"
import { MetricStrip, type Metric } from "../components/ui/Sheet"
import { buildSearchParams } from "../lib/searchParams"

type ForecastRecurringRow = {
  rule_id: number | null
  name: string
  type: "income" | "expense"
  amount_cents: number
  occurrence_date: string
  category_id: number | null
  category_name: string | null
}

type ForecastVariableRow = { category_id: number; name: string; icon: string | null; amount_cents: number }

type ForecastOneTimeRow = { name: string; type: "income" | "expense"; amount_cents: number }

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
  start_balance_cents: number
  current_month_net_cents: number
  months: ForecastMonth[]
  model: {
    method: "recurring_only" | "recent_median" | "seasonal_median"
    history_months: number
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

type Horizon = "3" | "6" | "12"
type Mode = "recurring" | "full"

const SHORT_MONTH = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" })
const MONTH_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
const MONTH_LONG = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })

const OUTLOOK_COLUMNS: Columns = {
  columns: "minmax(0, 1fr) 130px 130px 140px 180px",
  narrowColumns: "minmax(0, 1fr) 140px",
}
const ITEM_COLUMNS = "18px minmax(0, 1fr) auto"

function monthDate(month: string): Date {
  return new Date(`${month}-01T00:00:00Z`)
}

// The month a "months until negative" count points at: 0 is this month, n is the nth forecast month.
function monthAt(months: ForecastMonth[], count: number): string {
  return count === 0 ? "This month" : MONTH_YEAR.format(monthDate(months[count - 1].month))
}

function ForecastPage() {
  const isDesktop = useIsDesktop()
  const [searchParams, setSearchParams] = useSearchParams()
  const horizonParam = searchParams.get("horizon")
  const horizon: Horizon = horizonParam === "3" || horizonParam === "12" ? horizonParam : "6"
  const mode: Mode = searchParams.get("mode")?.toLowerCase() === "recurring" ? "recurring" : "full"
  const peekMonth = searchParams.get("peek")

  const forecast = useQuery({
    queryKey: ["forecast", Number(horizon), mode],
    queryFn: () => apiFetch<ForecastResponse>(`/api/forecast?horizon=${horizon}&mode=${mode}`),
  })
  const recurringReference = useQuery({
    queryKey: ["forecast", Number(horizon), "recurring-reference"],
    queryFn: () => apiFetch<ForecastResponse>(`/api/forecast?horizon=${horizon}&mode=recurring`),
    enabled: mode === "full",
  })
  const categories = useQuery({
    queryKey: ["categories", "all"],
    queryFn: () => apiFetch<CategoriesResponse>("/api/categories?period=all"),
  })

  if (forecast.isLoading) return <PanelLoading title="Forecast" label="Loading forecast…" />
  if (forecast.error || !forecast.data) return <PanelError title="Forecast" message="Unable to load forecast." />
  const data = forecast.data

  const update = (values: Record<string, string | null>) => setSearchParams(buildSearchParams(searchParams, values))
  const closePeek = () => setSearchParams(buildSearchParams(searchParams, { peek: null }), { replace: true })
  const iconFor = new Map((categories.data?.categories ?? []).map((category) => [category.id, category.icon]))

  const months = data.months
  const last = months[months.length - 1]
  const summary = data.summary
  const interval =
    mode === "full" &&
    data.model.prediction_interval_available &&
    months.every((row) => row.end_balance_p10_cents !== null && row.end_balance_p90_cents !== null)
  const reference = mode === "full" ? recurringReference.data : undefined

  // The year where it changes; phones show month names only.
  const labels = [
    "Now",
    ...months.map((row, index) =>
      (isDesktop && (index === 0 || row.month.endsWith("-01")) ? MONTH_YEAR : SHORT_MONTH).format(monthDate(row.month))
    ),
  ]
  const expected = [data.start_balance_cents, ...months.map((row) => row.end_balance_cents)]
  const recurringOnly = reference ? [data.start_balance_cents, ...reference.months.map((row) => row.end_balance_cents)] : null
  const low = [data.start_balance_cents, ...months.map((row) => row.end_balance_p10_cents)]
  const high = [data.start_balance_cents, ...months.map((row) => row.end_balance_p90_cents)]

  const modelNote =
    data.model.method === "recurring_only"
      ? "Recurring commitments only."
      : `${data.model.method === "seasonal_median" ? "Seasonal median" : "Recent median"} of ${data.model.history_months} months of history.`
  const expectedNote = `Includes ${formatAmount(data.current_month_net_cents, "signed")} still expected this month.`

  const belowZero: Metric = (() => {
    if (summary.months_until_negative !== null) {
      return { label: "Below zero", value: monthAt(months, summary.months_until_negative), detail: "expected" }
    }
    if (summary.risk_months_until_negative !== null) {
      const at = monthAt(months, summary.risk_months_until_negative)
      return { label: "Below zero", value: "Not expected", detail: `possible ${at === "This month" ? "this month" : `in ${at}`} within the 80% range` }
    }
    return {
      label: "Below zero",
      value: "Not expected",
      detail: interval ? "not within the 80% range" : `within ${horizon} months`,
    }
  })()

  const metrics: Metric[] = [
    {
      label: last ? `Balance in ${MONTH_YEAR.format(monthDate(last.month))}` : "Balance",
      value: <Amount cents={summary.projected_balance_cents} />,
      detail:
        summary.projected_balance_p10_cents !== null && summary.projected_balance_p90_cents !== null ? (
          <>
            80% range <Amount cents={summary.projected_balance_p10_cents} decimals={false} /> –{" "}
            <Amount cents={summary.projected_balance_p90_cents} decimals={false} />
          </>
        ) : (
          `after ${horizon} months`
        ),
    },
    {
      label: "Average monthly net",
      value: (
        <Amount
          cents={summary.average_monthly_net_cents}
          kind="signed"
          tone={summary.average_monthly_net_cents >= 0 ? "income" : undefined}
        />
      ),
      detail: mode === "full" ? (data.model.method === "seasonal_median" ? "seasonal median spending" : "recent median spending") : "recurring only",
    },
    belowZero,
  ]

  const legend: LegendEntry[] = [
    { key: "expected", label: mode === "full" ? "Expected" : "Recurring only", color: "var(--ink)", mark: "line" },
    ...(recurringOnly ? [{ key: "recurring", label: "Recurring only", color: "var(--ink-3)", mark: "dash" as const }] : []),
    ...(interval ? [{ key: "range", label: "80% range", color: "var(--band)", mark: "area" as const }] : []),
  ]

  const peekRow = months.find((row) => row.month === peekMonth)
  const peek = peekRow ? (
    <Peek parent="Forecast" title={MONTH_LONG.format(monthDate(peekRow.month))} onClose={closePeek}>
      <PeekHeadline title={MONTH_LONG.format(monthDate(peekRow.month))} figure={<Amount cents={peekRow.end_balance_cents} />} />
      <PropertyList>
        {peekRow.end_balance_p10_cents !== null && peekRow.end_balance_p90_cents !== null ? (
          <Property label="80% range">
            <span>
              <Amount cents={peekRow.end_balance_p10_cents} decimals={false} /> –{" "}
              <Amount cents={peekRow.end_balance_p90_cents} decimals={false} />
            </span>
          </Property>
        ) : null}
        <Property label="Lowest">
          <Amount cents={peekRow.minimum_balance_cents} tone={peekRow.minimum_balance_cents < 0 ? "over" : undefined} />
        </Property>
        <Property label="Income">
          <Amount cents={peekRow.projected_income_cents} kind="income" />
        </Property>
        <Property label="Expenses">
          <Amount cents={peekRow.projected_expenses_cents} kind="expense" />
        </Property>
        <Property label="Net">
          <Amount cents={peekRow.projected_net_cents} kind="signed" />
        </Property>
      </PropertyList>
      <PeekSection title="Recurring">
        {peekRow.breakdown.recurring_rules.length ? (
          <List flat label="Recurring">
            {peekRow.breakdown.recurring_rules.map((rule, index) => (
              <Row key={`${rule.rule_id}-${index}`} columns={ITEM_COLUMNS}>
                <CategoryGlyph
                  categoryId={rule.category_id}
                  icon={rule.category_id === null ? null : iconFor.get(rule.category_id)}
                  name={rule.category_name ?? rule.name}
                />
                <Cell>{rule.name}</Cell>
                <AmountCell>
                  <Amount cents={rule.amount_cents} kind={rule.type === "income" ? "income" : "expense"} />
                </AmountCell>
              </Row>
            ))}
          </List>
        ) : (
          <EmptyState inline>None</EmptyState>
        )}
      </PeekSection>
      {mode === "full" ? (
        <PeekSection title="Estimated">
          {peekRow.breakdown.variable_estimates.length || peekRow.breakdown.variable_income_estimates.length ? (
            <List flat label="Estimated">
              {peekRow.breakdown.variable_income_estimates.map((entry) => (
                <Row key={`income-${entry.category_id}`} columns={ITEM_COLUMNS}>
                  <CategoryGlyph categoryId={entry.category_id} icon={entry.icon} name={entry.name} />
                  <Cell>{entry.name}</Cell>
                  <AmountCell>
                    <Amount cents={entry.amount_cents} kind="income" />
                  </AmountCell>
                </Row>
              ))}
              {peekRow.breakdown.variable_estimates.map((entry) => (
                <Row key={`expense-${entry.category_id}`} columns={ITEM_COLUMNS}>
                  <CategoryGlyph categoryId={entry.category_id} icon={entry.icon} name={entry.name} />
                  <Cell>{entry.name}</Cell>
                  <AmountCell>
                    <Amount cents={entry.amount_cents} kind="expense" />
                  </AmountCell>
                </Row>
              ))}
            </List>
          ) : (
            <EmptyState inline>None</EmptyState>
          )}
        </PeekSection>
      ) : null}
      <PeekSection title="One-time">
        {peekRow.breakdown.one_time_events.length ? (
          <List flat label="One-time">
            {peekRow.breakdown.one_time_events.map((event, index) => (
              <Row key={`${event.name}-${index}`} columns={ITEM_COLUMNS}>
                <span />
                <Cell>{event.name}</Cell>
                <AmountCell>
                  <Amount cents={event.amount_cents} kind={event.type === "income" ? "income" : "expense"} />
                </AmountCell>
              </Row>
            ))}
          </List>
        ) : (
          <EmptyState inline>None</EmptyState>
        )}
      </PeekSection>
    </Peek>
  ) : null

  return (
    <Panel
      title="Forecast"
      layout="fill"
      peekOpen={peek !== null}
      actions={
        <LinkButton variant="ghost" icon={FlaskIcon} to={`/scenarios?horizon=${horizon}&mode=${mode}`}>
          What if
        </LinkButton>
      }
      viewRow={
        <ViewRow>
          <SegmentedControl
            label="Forecast horizon"
            value={horizon}
            options={[
              { value: "3", label: isDesktop ? "3 months" : "3M" },
              { value: "6", label: isDesktop ? "6 months" : "6M" },
              { value: "12", label: isDesktop ? "12 months" : "12M" },
            ]}
            onChange={(next) => update({ horizon: next, peek: null })}
          />
          <SegmentedControl
            label="Forecast model"
            value={mode}
            options={[
              { value: "recurring", label: "Recurring only" },
              { value: "full", label: "With estimates" },
            ]}
            onChange={(next) => update({ mode: next })}
          />
        </ViewRow>
      }
    >
      <PeekLayout
        scroll
        peek={peek}
        main={
          <>
            <MetricStrip metrics={metrics} />
            <ChartCard
              title="Balance"
              controls={<IconButton icon={InfoIcon} label={`${modelNote} ${expectedNote}`} />}
              legend={legend}
              table={
                <ChartTable
                  label="Projected balance by month"
                  columns={["Month", mode === "full" ? "Expected" : "Balance", ...(interval ? ["80% range"] : []), ...(recurringOnly ? ["Recurring only"] : [])]}
                  rows={labels.map((_, index) => ({
                    key: String(index),
                    cells: [
                      index === 0 ? "Now" : MONTH_YEAR.format(monthDate(months[index - 1].month)),
                      <Amount cents={expected[index]} />,
                      ...(interval
                        ? [
                            index === 0 ? (
                              "–"
                            ) : (
                              <>
                                <Amount cents={low[index] as number} /> – <Amount cents={high[index] as number} />
                              </>
                            ),
                          ]
                        : []),
                      ...(recurringOnly ? [<Amount cents={recurringOnly[index]} />] : []),
                    ],
                  }))}
                />
              }
            >
              {(focus) => (
                <LineChart
                  labels={labels}
                  height={220}
                  yAxis
                  formatY={(cents) => formatAmount(cents, "balance", false)}
                  xEvery={isDesktop || labels.length <= 7 ? 1 : 2}
                  mark={0}
                  idle={0}
                  focus={focus}
                  series={[
                    ...(recurringOnly ? [{ key: "recurring", values: recurringOnly, color: "var(--ink-3)", dash: true, width: 1.25 }] : []),
                    { key: "expected", values: expected },
                  ]}
                  bands={interval ? [{ key: "range", lo: low, hi: high }] : []}
                  tooltip={(index) =>
                    index === 0 ? (
                      <ChartTooltip title="Now" rows={[{ key: "balance", label: "Balance", value: <Amount cents={expected[0]} /> }]} />
                    ) : (
                      <ChartTooltip
                        title={MONTH_YEAR.format(monthDate(months[index - 1].month))}
                        rows={[
                          {
                            key: "expected",
                            label: mode === "full" ? "Expected" : "Balance",
                            value: <Amount cents={expected[index]} />,
                            color: "var(--ink)",
                            mark: "line",
                          },
                          ...(interval
                            ? [
                                {
                                  key: "range",
                                  label: "80% range",
                                  value: (
                                    <>
                                      <Amount cents={low[index] as number} decimals={false} /> –{" "}
                                      <Amount cents={high[index] as number} decimals={false} />
                                    </>
                                  ),
                                  color: "var(--band)",
                                  mark: "area" as const,
                                },
                              ]
                            : []),
                          ...(recurringOnly
                            ? [
                                {
                                  key: "recurring",
                                  label: "Recurring only",
                                  value: <Amount cents={recurringOnly[index]} />,
                                  color: "var(--ink-3)",
                                  mark: "dash" as const,
                                },
                              ]
                            : []),
                        ]}
                      />
                    )
                  }
                />
              )}
            </ChartCard>
            <List scroll={false} label="Monthly outlook">
              <ListHead {...OUTLOOK_COLUMNS}>
                <span>Month</span>
                <Cell align="right" hide="narrow">
                  Income
                </Cell>
                <Cell align="right" hide="narrow">
                  Expenses
                </Cell>
                <Cell align="right">End balance</Cell>
                <Cell align="right" hide="narrow">
                  {interval ? "80% range" : null}
                </Cell>
              </ListHead>
              {months.map((row) => (
                <Row
                  key={row.month}
                  {...OUTLOOK_COLUMNS}
                  label={MONTH_LONG.format(monthDate(row.month))}
                  selected={row.month === peekMonth}
                  onOpen={() => update({ peek: row.month })}
                >
                  <Cell strong>
                    {MONTH_YEAR.format(monthDate(row.month))}
                    {row.crosses_negative ? (
                      <>
                        {" "}
                        <Status icon={WarningIcon} tone="bad">
                          Dips below zero
                        </Status>
                      </>
                    ) : null}
                  </Cell>
                  <Cell align="right" hide="narrow">
                    <Amount cents={row.projected_income_cents} kind="income" decimals={false} />
                  </Cell>
                  <Cell align="right" hide="narrow">
                    <Amount cents={row.projected_expenses_cents} kind="expense" decimals={false} />
                  </Cell>
                  <Cell align="right" strong>
                    <Amount cents={row.end_balance_cents} decimals={false} tone={row.end_balance_cents < 0 ? "over" : undefined} />
                  </Cell>
                  <Cell align="right" tone="muted" hide="narrow">
                    {row.end_balance_p10_cents !== null && row.end_balance_p90_cents !== null && interval ? (
                      <>
                        <Amount cents={row.end_balance_p10_cents} decimals={false} /> –{" "}
                        <Amount cents={row.end_balance_p90_cents} decimals={false} />
                      </>
                    ) : null}
                  </Cell>
                </Row>
              ))}
            </List>
          </>
        }
      />
    </Panel>
  )
}

export default ForecastPage
