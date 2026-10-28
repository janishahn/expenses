import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowRightIcon } from "@phosphor-icons/react/ArrowRight"
import { FunnelIcon } from "@phosphor-icons/react/Funnel"
import { PackageIcon } from "@phosphor-icons/react/Package"
import { useNavigate, useSearchParams } from "react-router-dom"
import { apiFetch } from "../app/api"
import { formatAmount } from "../app/format"
import { TagFilterOptions, type TagMode } from "../components/TagFilterOptions"
import { Amount } from "../components/ui/Amount"
import { IconButton } from "../components/ui/Button"
import { CategoryGlyph } from "../components/ui/CategoryGlyph"
import { ChartCard, ChartTable, ChartTooltip, TableLink, type LegendEntry } from "../components/ui/ChartCard"
import { CardRow, ChartWithAside, ColumnChart, LineChart, WeekdayBars } from "../components/ui/Charts"
import { BudgetGrid, DayCalendar, MonthGrid, type BudgetGridRow, type CalendarLevel, type MonthGridRow } from "../components/ui/Grids"
import { useIsDesktop } from "../components/ui/layout-state"
import { Panel, PanelError, PanelLoading, ViewRow } from "../components/ui/Panel"
import { PeriodControl } from "../components/ui/PeriodControl"
import { periodFromSearch, writePeriodToSearch, type PeriodSelection } from "../components/ui/period"
import { Pill } from "../components/ui/Pill"
import { Popover } from "../components/ui/Popover"
import { SegmentedControl } from "../components/ui/SegmentedControl"
import { MetricStrip, type Metric } from "../components/ui/Sheet"
import { TagChip } from "../components/ui/TagChip"
import { categoryColor } from "../components/ui/tokens"
import { buildSearchParams } from "../lib/searchParams"
import { canonicalizeTagScope, parseTagIds, serializeTagIds } from "../lib/tagFilters"

type InsightsResponse = {
  period: { slug: string; start: string; end: string }
  tags: Array<{ id: number; name: string }>
  series: Array<{ year: number; month: number; income_cents: number; expense_cents: number }>
  // Totals for the exact period; the series covers whole months, at most 12.
  income_cents: number
  expense_cents: number
  recurring_cents: number
  month_count: number
}

type GridKind = "expense" | "income" | "tag"

type MonthGridResponse = {
  months: string[]
  current_month: string
  rows: Array<{ id: number | null; name: string; icon: string | null; values_cents: number[] }>
}

type RecurringSplitResponse = {
  months: string[]
  rows: Array<{ month: string; recurring_cents: number; other_cents: number }>
}

type DayCalendarResponse = {
  start: string
  end: string
  days: Array<{ date: string; amount_cents: number }>
  weekday_avg_cents: number[]
  weekend_share: number
}

type BudgetHistoryResponse = {
  months: string[]
  current_month: string
  rows: Array<{
    category_id: number | null
    name: string
    icon: string | null
    cells: Array<{ month: string; budget_cents: number | null; spent_cents: number }>
  }>
}

const DEFAULT_PERIOD: PeriodSelection = { slug: "all" }
const SHORT_MONTH = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" })
const MONTH_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
const DAY_LABEL = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
const DAY_LEVELS = ["None", "Under 25 €", "25–60 €", "60–120 €", "120 € or more"]
const DAY_MS = 24 * 60 * 60 * 1000

function monthDate(month: string): Date {
  return new Date(`${month}-01T00:00:00Z`)
}

// The ledger scoped to a chart slice, with Insights as the way back.
function ledgerUrl(range: { start: string; end: string }, scope?: { key: "category" | "tags"; id: number }): string {
  const params = new URLSearchParams({ period: "custom", start: range.start, end: range.end })
  if (scope) params.set(scope.key, String(scope.id))
  params.set("from", "insights")
  return `/transactions?${params.toString()}`
}

function monthBounds(month: string): { start: string; end: string } {
  const start = monthDate(month)
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0))
  return { start: `${month}-01`, end: end.toISOString().slice(0, 10) }
}

// Grid column heads: the year only where it changes, so the first and current October differ.
function monthLabels(months: string[]): string[] {
  return months.map((month, index) => {
    const date = monthDate(month)
    return index === 0 || date.getUTCMonth() === 0 ? MONTH_YEAR.format(date) : SHORT_MONTH.format(date)
  })
}

// Chart axes have less room: month names for a year or so, month and year for longer spans.
function axisLabels(months: string[]): string[] {
  const format = months.length > 13 ? MONTH_YEAR : SHORT_MONTH
  return months.map((month) => format.format(monthDate(month)))
}

function percentChange(ratio: number): string {
  const rounded = Math.round(ratio * 100)
  return rounded === 0 ? "0 %" : `${rounded > 0 ? "+" : "−"} ${Math.abs(rounded)} %`
}

function dayLevel(cents: number): CalendarLevel {
  return cents <= 0 ? 0 : cents < 2500 ? 1 : cents < 6000 ? 2 : cents < 12000 ? 3 : 4
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function InsightsPage() {
  const navigate = useNavigate()
  const isDesktop = useIsDesktop()
  const [searchParams, setSearchParams] = useSearchParams()
  const [gridKind, setGridKind] = useState<GridKind>("expense")
  const [emptyTagMode, setEmptyTagMode] = useState<TagMode>("include")
  const [now] = useState(() => new Date())

  const period = periodFromSearch(searchParams, DEFAULT_PERIOD)
  const includedTagIds = parseTagIds(searchParams, ["tag", "tags"])
  const excludedTagIds = parseTagIds(searchParams, ["exclude_tags"])
  const tagMode: TagMode = excludedTagIds.length ? "exclude" : includedTagIds.length ? "include" : emptyTagMode
  const tagIds = tagMode === "exclude" ? excludedTagIds : includedTagIds
  // Spread durables counts each durable's cost per day of its life instead of on its purchase date.
  const spread = searchParams.get("spread_durables") === "true"
  const spreadParam = spread ? "spread_durables=true" : ""
  const queryString = useMemo(() => {
    const params = canonicalizeTagScope(searchParams)
    if (!params.get("period")) params.set("period", "all")
    params.delete("type")
    return params.toString()
  }, [searchParams])

  const insights = useQuery({
    queryKey: ["insights", queryString],
    queryFn: () => apiFetch<InsightsResponse>(`/api/insights?${queryString}`),
  })
  const split = useQuery({
    queryKey: ["insights", "recurring-split", spread],
    queryFn: () => apiFetch<RecurringSplitResponse>(`/api/insights/recurring-split?${spreadParam}`),
  })
  const grid = useQuery({
    queryKey: ["insights", "month-grid", gridKind, spread],
    queryFn: () => apiFetch<MonthGridResponse>(`/api/insights/month-grid?kind=${gridKind}&${spreadParam}`),
  })
  const calendar = useQuery({
    queryKey: ["insights", "day-calendar", spread],
    queryFn: () => apiFetch<DayCalendarResponse>(`/api/insights/day-calendar?${spreadParam}`),
  })
  const budgets = useQuery({
    queryKey: ["insights", "budget-history"],
    queryFn: () => apiFetch<BudgetHistoryResponse>("/api/insights/budget-history"),
  })

  if (insights.isLoading) return <PanelLoading title="Insights" label="Loading insights…" />
  if (insights.error || !insights.data) return <PanelError title="Insights" message="Unable to load insights." />
  const data = insights.data

  const setPeriod = (next: PeriodSelection) => setSearchParams(writePeriodToSearch(searchParams, next))
  const setTagFilter = (mode: TagMode, ids: number[]) => {
    setEmptyTagMode(mode)
    setSearchParams(
      buildSearchParams(searchParams, {
        tag: null,
        tags: mode === "include" ? serializeTagIds(ids) : null,
        exclude_tags: mode === "exclude" ? serializeTagIds(ids) : null,
      })
    )
  }
  // Chart marks open the ledger scoped to their slice, with Insights as the way back.
  const openLedger = (range: { start: string; end: string }, scope?: { key: "category" | "tags"; id: number }) =>
    navigate(ledgerUrl(range, scope))
  const amountTick = (cents: number) => formatAmount(cents, "balance", false)

  // Strip and the income and expenses chart follow the period and Filter.
  const series = data.series
  const income = data.income_cents
  const spent = data.expense_cents
  const months = data.month_count
  const saved = income - spent
  const recurring = data.recurring_cents
  const seriesMonths = series.map((point) => `${point.year}-${String(point.month).padStart(2, "0")}`)
  const seriesLabels = axisLabels(seriesMonths)
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  const seriesPartial = seriesMonths[seriesMonths.length - 1] === thisMonth ? seriesMonths.length - 1 : undefined
  const flowIncome = series.map((point) => point.income_cents)
  const flowExpenses = series.map((point) => point.expense_cents)
  const splitFull = split.data?.rows.slice(0, -1) ?? []
  const recurringFull = sum(splitFull.map((row) => row.recurring_cents))
  const spentFull = recurringFull + sum(splitFull.map((row) => row.other_cents))

  const metrics: Metric[] = [
    {
      label: "Income",
      value: <Amount cents={income} />,
      detail: months > 1 ? `${months} months` : undefined,
    },
    {
      label: "Spent",
      value: <Amount cents={spent} />,
      detail:
        months > 1 ? (
          <>
            <Amount cents={Math.round(spent / months)} /> per month
          </>
        ) : undefined,
    },
    {
      label: "Saved",
      value: <Amount cents={saved} tone={saved > 0 ? "income" : undefined} />,
      detail: income > 0 ? `${Math.round((saved / income) * 100)} % of income` : undefined,
    },
    {
      label: "Recurring",
      value: spent ? `${Math.round((recurring / spent) * 100)} %` : "–",
      detail: "of spending",
    },
  ]

  const flowLegend: LegendEntry[] = [
    { key: "income", label: "Income", color: "var(--income)", mark: "line" },
    { key: "expenses", label: "Expenses", color: "var(--ink)", mark: "line" },
    { key: "saved", label: "Saved", color: "var(--saved)", mark: "area" },
  ]
  if (series.some((point, index) => index !== seriesPartial && point.expense_cents > point.income_cents)) {
    flowLegend.push({ key: "overspent", label: "Overspent", color: "var(--overspent)", mark: "area" })
  }
  const flowEvery = seriesLabels.length <= 13 ? (isDesktop ? 1 : 3) : Math.ceil(seriesLabels.length / (isDesktop ? 6 : 3))

  // Rolling windows: the last 12 full months and the month in progress.
  const splitLabels = axisLabels(split.data?.months ?? [])
  const splitShort = (split.data?.months ?? []).map((month) => SHORT_MONTH.format(monthDate(month)).slice(0, 1))

  const gridMonths = grid.data?.months ?? []
  const gridLabels = monthLabels(gridMonths)
  const gridShort = gridMonths.map((month) => SHORT_MONTH.format(monthDate(month)).slice(0, 1))
  const lastFull = gridMonths.length > 1 ? gridMonths[gridMonths.length - 2] : null
  const gridRows: MonthGridRow[] = (grid.data?.rows ?? []).map((row) => {
    const full = row.values_cents.slice(0, -1)
    const average = sum(full) / (full.length || 1)
    const regular = full.filter((value) => value > 0).length >= 6
    return {
      key: String(row.id),
      label:
        gridKind === "tag" ? (
          <TagChip>{row.name}</TagChip>
        ) : (
          <>
            <CategoryGlyph categoryId={row.id} icon={row.icon} name={row.name} inline />
            {row.name}
          </>
        ),
      values: row.values_cents,
      color: gridKind === "tag" ? "var(--ink-2)" : categoryColor(row.id),
      total: <Amount cents={sum(row.values_cents)} decimals={false} />,
      change: regular && average ? percentChange((full[full.length - 1] - average) / average) : "–",
    }
  })
  const gridNames = new Map((grid.data?.rows ?? []).map((row) => [String(row.id), row]))

  const days = (() => {
    if (!calendar.data) return null
    const start = new Date(`${calendar.data.start}T00:00:00Z`)
    const end = new Date(`${calendar.data.end}T00:00:00Z`)
    const offset = (start.getUTCDay() + 6) % 7
    const first = new Date(start.getTime() - offset * DAY_MS)
    const count = Math.ceil((offset + Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1) / 7) * 7
    const amounts = new Map(calendar.data.days.map((day) => [day.date, day.amount_cents]))
    const dates = Array.from({ length: count }, (_, index) => new Date(first.getTime() + index * DAY_MS))
    const months: Array<{ week: number; label: string }> = []
    dates.forEach((date, index) => {
      if (date.getUTCDate() === 1 && date >= start) months.push({ week: Math.floor(index / 7), label: SHORT_MONTH.format(date) })
    })
    return {
      dates,
      months,
      amounts: dates.map((date) => amounts.get(date.toISOString().slice(0, 10)) ?? 0),
      levels: dates.map((date) =>
        date < start || date > end ? null : dayLevel(amounts.get(date.toISOString().slice(0, 10)) ?? 0)
      ),
    }
  })()

  const budgetMonths = budgets.data?.months ?? []
  const budgetSources = new Map((budgets.data?.rows ?? []).map((row) => [String(row.category_id), row]))
  const budgetRows: BudgetGridRow[] = (budgets.data?.rows ?? []).map((row) => {
      const full = row.cells.slice(0, -1).filter((cell) => cell.budget_cents !== null)
      const within = full.filter((cell) => cell.spent_cents <= (cell.budget_cents as number)).length
      return {
        key: String(row.category_id),
        label: (
          <>
            {row.category_id === null ? null : <CategoryGlyph categoryId={row.category_id} icon={row.icon} name={row.name} inline />}
            {row.name}
          </>
        ),
        cells: row.cells.map((cell) => ({
          state: cell.budget_cents === null ? "none" : cell.spent_cents > cell.budget_cents ? "over" : "within",
          current: cell.month === budgets.data?.current_month,
        })),
        total: `${within} of ${full.length}`,
      }
    })

  return (
    <Panel
      title="Insights"
      viewRow={
        <ViewRow
          end={
            <Popover
              form
              label="Filter"
              align="end"
              trigger={
                <Pill icon={FunnelIcon} set={tagIds.length > 0}>
                  {tagIds.length ? `Filter · ${tagIds.length}` : "Filter"}
                </Pill>
              }
            >
              <TagFilterOptions tags={data.tags} mode={tagMode} ids={tagIds} onChange={setTagFilter} />
            </Popover>
          }
        >
          <PeriodControl value={period} onChange={setPeriod} />
          <Pill
            icon={PackageIcon}
            set={spread}
            aria-pressed={spread}
            onClick={() => setSearchParams(buildSearchParams(searchParams, { spread_durables: spread ? null : "true" }))}
          >
            Spread durables
          </Pill>
        </ViewRow>
      }
    >
      <MetricStrip metrics={metrics} />
      <CardRow>
        <ChartCard
          title="Income and expenses"
          meta={income > 0 ? `${Math.round((Math.abs(saved) / income) * 100)} % ${saved < 0 ? "overspent" : "saved"}` : undefined}
          legend={flowLegend}
          empty={series.length ? undefined : "No transactions in this period."}
          table={
            <ChartTable
              label="Income and expenses by month"
              columns={["Month", "Income", "Expenses", "Saved"]}
              rows={series.map((point, index) => ({
                key: seriesMonths[index],
                cells: [
                  MONTH_YEAR.format(monthDate(seriesMonths[index])),
                  <Amount cents={point.income_cents} />,
                  <Amount cents={point.expense_cents} />,
                  <Amount cents={point.income_cents - point.expense_cents} />,
                ],
              }))}
            />
          }
        >
          {(focus) => (
            <LineChart
              labels={seriesLabels}
              height={150}
              yAxis
              zero
              formatY={amountTick}
              xEvery={flowEvery}
              partial={seriesPartial}
              focus={focus}
              series={[
                { key: "income", values: flowIncome, color: "var(--income)" },
                { key: "expenses", values: flowExpenses },
              ]}
              bands={[
                { key: "saved", lo: flowExpenses, hi: flowIncome, fill: "var(--saved)", clip: "above" },
                { key: "overspent", lo: flowExpenses, hi: flowIncome, fill: "var(--overspent)", clip: "below" },
              ]}
              tooltip={(index) => {
                const point = series[index]
                const pointSaved = point.income_cents - point.expense_cents
                const share = point.income_cents > 0 ? ` (${Math.round((Math.abs(pointSaved) / point.income_cents) * 100)} %)` : ""
                return (
                  <ChartTooltip
                    title={`${MONTH_YEAR.format(monthDate(seriesMonths[index]))}${index === seriesPartial ? " so far" : ""}`}
                    rows={[
                      { key: "income", label: "Income", value: <Amount cents={point.income_cents} />, color: "var(--income)", mark: "line" },
                      { key: "expenses", label: "Expenses", value: <Amount cents={point.expense_cents} />, color: "var(--ink)", mark: "line" },
                      {
                        key: "saved",
                        label: `${pointSaved < 0 ? "Overspent" : "Saved"}${share}`,
                        value: <Amount cents={Math.abs(pointSaved)} />,
                      },
                    ]}
                  />
                )
              }}
            />
          )}
        </ChartCard>
        <ChartCard
          title="Recurring and other spending"
          meta={spentFull ? `${Math.round((recurringFull / spentFull) * 100)} % recurring` : undefined}
          legend={[
            { key: "recurring", label: "Recurring", color: "var(--rec)" },
            { key: "other", label: "Other", color: "var(--ink-2)" },
          ]}
          empty={split.isError ? "Recurring spending is unavailable." : split.data ? undefined : "Loading…"}
          table={
            <ChartTable
              label="Recurring and other spending by month"
              columns={["Month", "Recurring", "Other"]}
              rows={(split.data?.rows ?? []).map((row) => ({
                key: row.month,
                cells: [MONTH_YEAR.format(monthDate(row.month)), <Amount cents={row.recurring_cents} />, <Amount cents={row.other_cents} />],
              }))}
            />
          }
        >
          {(focus) =>
            split.data ? (
              <ColumnChart
                labels={splitLabels}
                shortLabels={splitShort}
                formatY={amountTick}
                focus={focus}
                series={[
                  { key: "other", values: split.data.rows.map((row) => row.other_cents), color: "var(--ink-2)" },
                  { key: "recurring", values: split.data.rows.map((row) => row.recurring_cents), color: "var(--rec)" },
                ]}
                tooltip={(index) => {
                  const row = split.data.rows[index]
                  return (
                    <ChartTooltip
                      title={`${MONTH_YEAR.format(monthDate(row.month))}${index === split.data.rows.length - 1 ? " so far" : ""}`}
                      rows={[
                        { key: "recurring", label: "Recurring", value: <Amount cents={row.recurring_cents} />, color: "var(--rec)" },
                        { key: "other", label: "Other", value: <Amount cents={row.other_cents} />, color: "var(--ink-2)" },
                      ]}
                    />
                  )
                }}
              />
            ) : null
          }
        </ChartCard>
      </CardRow>
      <ChartCard
        title="By month"
        controls={
          <SegmentedControl
            label="Rows"
            value={gridKind}
            options={[
              { value: "expense", label: "Expenses" },
              { value: "income", label: "Income" },
              { value: "tag", label: "Tags" },
            ]}
            onChange={setGridKind}
          />
        }
        empty={
          grid.isError
            ? "The month grid is unavailable."
            : !grid.data
              ? "Loading…"
              : gridRows.length
                ? undefined
                : gridKind === "tag"
                  ? "No tagged spending in these months."
                  : "Nothing in these months."
        }
        table={
          <ChartTable
            label="Amounts by month"
            columns={[gridKind === "tag" ? "Tag" : "Category", ...gridMonths.map((month) => MONTH_YEAR.format(monthDate(month))), "Total"]}
            rows={(grid.data?.rows ?? []).map((row) => ({
              key: String(row.id),
              cells: [
                row.name,
                ...row.values_cents.map((value, index) =>
                  row.id === null ? (
                    <Amount key={index} cents={value} decimals={false} />
                  ) : (
                    <TableLink
                      key={index}
                      to={ledgerUrl(monthBounds(gridMonths[index]), { key: gridKind === "tag" ? "tags" : "category", id: row.id })}
                    >
                      <Amount cents={value} decimals={false} />
                    </TableLink>
                  )
                ),
                <Amount cents={sum(row.values_cents)} decimals={false} />,
              ],
            }))}
          />
        }
      >
        {() => (
          <MonthGrid
            months={gridLabels}
            shortMonths={gridShort}
            rows={gridRows}
            totalLabel="Total"
            changeLabel={lastFull ? `${SHORT_MONTH.format(monthDate(lastFull))} vs avg` : undefined}
            tooltip={(row, index) => {
              const source = gridNames.get(row.key)
              const current = index === gridMonths.length - 1
              return (
                <ChartTooltip
                  title={`${source?.name} · ${MONTH_YEAR.format(monthDate(gridMonths[index]))}${current ? " so far" : ""}`}
                  rows={[{ key: "amount", label: gridKind === "income" ? "Received" : "Spent", value: <Amount cents={row.values[index]} /> }]}
                />
              )
            }}
            onSelect={(row, index) => {
              const source = gridNames.get(row.key)
              if (source?.id == null) return
              openLedger(monthBounds(gridMonths[index]), { key: gridKind === "tag" ? "tags" : "category", id: source.id })
            }}
          />
        )}
      </ChartCard>
      <ChartCard
        title="Daily spending"
        meta="without recurring"
        empty={calendar.isError ? "Daily spending is unavailable." : days ? undefined : "Loading…"}
        table={
          calendar.data && days ? (
            <>
              <ChartTable
                label="Average spending by weekday"
                columns={["Weekday", "Average"]}
                rows={calendar.data.weekday_avg_cents.map((value, index) => ({
                  key: WEEKDAYS[index],
                  cells: [WEEKDAYS[index], <Amount cents={value} />],
                }))}
              />
              <ChartTable
                label="Spending by day"
                columns={["Day", "Spent"]}
                rows={calendar.data.days.map((day) => ({
                  key: day.date,
                  cells: [
                    <TableLink to={ledgerUrl({ start: day.date, end: day.date })}>
                      {DAY_LABEL.format(new Date(`${day.date}T00:00:00Z`))}
                    </TableLink>,
                    <Amount cents={day.amount_cents} />,
                  ],
                }))}
              />
            </>
          ) : null
        }
      >
        {() =>
          calendar.data && days ? (
            <ChartWithAside
              chart={
                <DayCalendar
                  days={days.levels}
                  months={days.months}
                  scale={DAY_LEVELS}
                  tooltip={(index) => (
                    <ChartTooltip
                      title={DAY_LABEL.format(days.dates[index])}
                      rows={[
                        {
                          key: "spent",
                          label: "Spent",
                          value: days.amounts[index] ? <Amount cents={days.amounts[index]} /> : "Nothing",
                        },
                      ]}
                    />
                  )}
                  onSelect={(index) => {
                    const day = days.dates[index].toISOString().slice(0, 10)
                    openLedger({ start: day, end: day })
                  }}
                />
              }
              aside={
                <WeekdayBars
                  values={calendar.data.weekday_avg_cents}
                  labels={["M", "T", "W", "T", "F", "S", "S"]}
                  marked={[5, 6]}
                  heading="Average by weekday"
                  summary={
                    <>
                      Weekends <b>{Math.round(calendar.data.weekend_share * 100)} %</b>
                    </>
                  }
                  tooltip={(index) => (
                    <ChartTooltip
                      title={WEEKDAYS[index]}
                      rows={[{ key: "average", label: "Average", value: <Amount cents={calendar.data.weekday_avg_cents[index]} /> }]}
                    />
                  )}
                />
              }
            />
          ) : null
        }
      </ChartCard>
      <ChartCard
        title="Budget history"
        controls={<IconButton icon={ArrowRightIcon} label="Open budgets" onClick={() => navigate("/budgets")} />}
        empty={
          budgets.isError ? "Budget history is unavailable." : !budgets.data ? "Loading…" : budgetRows.length ? undefined : "No budgets yet."
        }
        table={
          <ChartTable
            label="Budget history by month"
            columns={["Budget", ...budgetMonths.map((month) => MONTH_YEAR.format(monthDate(month))), "Within"]}
            rows={budgetRows.map((row) => ({
              key: row.key,
              cells: [
                budgetSources.get(row.key)?.name,
                ...(budgetSources.get(row.key)?.cells ?? []).map((cell) =>
                  cell.budget_cents === null ? (
                    "–"
                  ) : (
                    <TableLink to={`/budgets?month=${cell.month}`}>
                      <Amount cents={cell.spent_cents} decimals={false} /> of <Amount cents={cell.budget_cents} decimals={false} />
                    </TableLink>
                  )
                ),
                row.total,
              ],
            }))}
          />
        }
      >
        {() => (
          <BudgetGrid
            months={monthLabels(budgetMonths)}
            shortMonths={budgetMonths.map((month) => SHORT_MONTH.format(monthDate(month)).slice(0, 1))}
            rows={budgetRows}
            totalLabel="Within"
            tooltip={(row, index) => {
              const source = budgetSources.get(row.key)
              const cell = source?.cells[index]
              const current = budgetMonths[index] === budgets.data?.current_month
              const title = `${source?.name} · ${MONTH_YEAR.format(monthDate(budgetMonths[index]))}${current ? " so far" : ""}`
              return (
                <ChartTooltip
                  title={title}
                  rows={
                    cell?.budget_cents == null
                      ? [{ key: "none", label: "No budget", value: "" }]
                      : [
                          {
                            key: "spent",
                            label: `${Math.round((cell.spent_cents / (cell.budget_cents || 1)) * 100)} % used`,
                            value: (
                              <>
                                <Amount cents={cell.spent_cents} decimals={false} /> of <Amount cents={cell.budget_cents} decimals={false} />
                              </>
                            ),
                          },
                        ]
                  }
                />
              )
            }}
            onSelect={(_, index) => navigate(`/budgets?month=${budgetMonths[index]}`)}
          />
        )}
      </ChartCard>
    </Panel>
  )
}

export default InsightsPage
