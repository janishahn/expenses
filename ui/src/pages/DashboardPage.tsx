import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowRightIcon } from "@phosphor-icons/react/ArrowRight"
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree"
import { EyeIcon } from "@phosphor-icons/react/Eye"
import { EyeSlashIcon } from "@phosphor-icons/react/EyeSlash"
import { FunnelIcon } from "@phosphor-icons/react/Funnel"
import { useNavigate, useSearchParams } from "react-router-dom"
import { apiFetch } from "../app/api"
import type { CategorySummary, TransactionListItem } from "../app/api-types"
import { formatCount } from "../app/format"
import { setPrivacy, usePrivacy } from "../app/privacy"
import { TagFilterOptions, type TagMode } from "../components/TagFilterOptions"
import { Amount } from "../components/ui/Amount"
import { IconButton } from "../components/ui/Button"
import { CategoryGlyph } from "../components/ui/CategoryGlyph"
import { ChartCard, ChartTable, ChartTooltip, type LegendEntry } from "../components/ui/ChartCard"
import { BudgetBar, CardRow, Donut, LineChart, StackedBands, type StackedRow } from "../components/ui/Charts"
import { EmptyState } from "../components/ui/EmptyState"
import { useIsDesktop } from "../components/ui/layout-state"
import { AmountCell, Cell, List, Row, type Columns } from "../components/ui/LedgerRow"
import { Menu, MenuItem, MenuLink, MenuSeparator } from "../components/ui/Menu"
import { Panel, PanelError, PanelLoading, ViewRow } from "../components/ui/Panel"
import { PeriodControl } from "../components/ui/PeriodControl"
import { periodFromSearch, periodLabel, writePeriodToSearch, DEFAULT_PERIOD_PRESETS, type PeriodSelection } from "../components/ui/period"
import { Pill } from "../components/ui/Pill"
import { Popover } from "../components/ui/Popover"
import { SegmentedControl } from "../components/ui/SegmentedControl"
import { MetricStrip, Sheet, SummaryCard, type Metric, type SummaryBudget } from "../components/ui/Sheet"
import { categoryColor } from "../components/ui/tokens"
import { buildSearchParams } from "../lib/searchParams"
import { canonicalizeTagScope, parseTagIds, serializeTagIds } from "../lib/tagFilters"

type BreakdownItem = { category_id: number | null; name: string; amount_cents: number; percent: number }

type DashboardResponse = {
  period: { slug: string; start: string; end: string }
  kpis: { income: number; expenses: number; balance: number }
  deltas: { income: number; expenses: number; balance: number } | null
  donut: {
    has_any_transactions: boolean
    expense_breakdown?: BreakdownItem[]
    income_breakdown?: BreakdownItem[]
  }
  recent: TransactionListItem[]
  categories: CategorySummary[]
  tags: Array<{ id: number; name: string }>
  budget_pace?: {
    velocity_ratio: number
    projected_cents: number
    budget_cents: number
    spent_cents: number
    remaining_cents: number
    daily_remaining_cents: number
    days_remaining: number
  } | null
  category_budget_pulse?: Array<{
    scope_category_id: number
    scope_label: string
    amount_cents: number
    spent_cents: number
    remaining_cents: number
  }> | null
}

type BandMonth = {
  month: string
  total_cents: number
  segments: Array<{ category_id: number | null; name: string; amount_cents: number }>
}

type ForecastMonth = {
  month: string
  end_balance_cents: number
  end_balance_p10_cents?: number | null
  end_balance_p90_cents?: number | null
}

type DurablePurchase = {
  id: number
  transaction_id: number
  expected_lifespan_days: number
  days_owned: number
  cost_per_day_cents: number
  percent_amortized: number
  fully_amortized: boolean
  title: string | null
  category: CategorySummary | null
}

type CardKey = "balance" | "spending" | "share"

const DEFAULT_PERIOD: PeriodSelection = { slug: "this_month" }
const HIDDEN_CARDS_KEY = "ew.dashboard.hidden"
const SHORT_MONTH = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" })
const MONTH_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" })

const RECENT_COLUMNS: Columns = { columns: "18px minmax(0, 1fr) auto", mobileColumns: "18px minmax(0, 1fr) auto" }
const DURABLE_COLUMNS: Columns = {
  columns: "18px minmax(0, 1fr) 120px minmax(80px, 160px) 130px",
  mobileColumns: "18px minmax(0, 1fr) auto",
}

// Hidden dashboard cards are a per-browser preference, like privacy mode.
function readHiddenCards(): CardKey[] {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(HIDDEN_CARDS_KEY) ?? "[]")
    return Array.isArray(stored) ? stored.filter((key): key is CardKey => ["balance", "spending", "share"].includes(key)) : []
  } catch {
    return []
  }
}

function storeHiddenCards(keys: CardKey[]) {
  try {
    window.localStorage.setItem(HIDDEN_CARDS_KEY, JSON.stringify(keys))
  } catch {
    // Storage can be unavailable (private windows); the choice still applies until reload.
  }
}

function monthDate(month: string): Date {
  return new Date(`${month}-01T00:00:00Z`)
}

function monthBounds(month: string): { start: string; end: string } {
  const start = monthDate(month)
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0))
  return { start: `${month}-01`, end: end.toISOString().slice(0, 10) }
}

function localIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function DashboardPage() {
  const navigate = useNavigate()
  const hidden = usePrivacy()
  const isDesktop = useIsDesktop()
  const [searchParams, setSearchParams] = useSearchParams()
  const [bandMonths, setBandMonths] = useState<"6" | "12">("6")
  const [shareType, setShareType] = useState<"expense" | "income">("expense")
  const [showRange, setShowRange] = useState(true)
  const [showAmortized, setShowAmortized] = useState(false)
  const [hiddenCards, setHiddenCards] = useState<CardKey[]>(readHiddenCards)
  const [emptyTagMode, setEmptyTagMode] = useState<TagMode>("include")
  const [now] = useState(() => new Date())

  const period = periodFromSearch(searchParams, DEFAULT_PERIOD)
  const includedTagIds = parseTagIds(searchParams, ["tag", "tags"])
  const excludedTagIds = parseTagIds(searchParams, ["exclude_tags"])
  const tagMode: TagMode = excludedTagIds.length ? "exclude" : includedTagIds.length ? "include" : emptyTagMode
  const tagIds = tagMode === "exclude" ? excludedTagIds : includedTagIds

  const queryString = useMemo(() => {
    const params = canonicalizeTagScope(searchParams)
    if (!params.get("period")) params.set("period", "this_month")
    params.delete("type")
    return params.toString()
  }, [searchParams])
  const bandsQuery = useMemo(() => {
    const params = new URLSearchParams(queryString)
    params.set("view", "monthly")
    params.set("months", bandMonths)
    return params.toString()
  }, [queryString, bandMonths])

  const dashboard = useQuery({
    queryKey: ["dashboard", queryString],
    queryFn: () => apiFetch<DashboardResponse>(`/api/dashboard?${queryString}`),
  })
  const bands = useQuery({
    queryKey: ["dashboard", "spending-bands", bandsQuery],
    queryFn: () => apiFetch<{ months: BandMonth[] }>(`/api/category-breakdown?${bandsQuery}`),
  })
  const history = useQuery({
    queryKey: ["dashboard", "balance-history", 6],
    queryFn: () => apiFetch<{ months: Array<{ month: string; balance_cents: number }> }>("/api/dashboard/balance-history?months=6"),
  })
  const forecast = useQuery({
    queryKey: ["forecast", 6, "full"],
    queryFn: () => apiFetch<{ months: ForecastMonth[] }>("/api/forecast?horizon=6&mode=full"),
  })
  const durable = useQuery({
    queryKey: ["durable-purchases"],
    queryFn: () => apiFetch<{ items: DurablePurchase[] }>("/api/durable-purchases"),
  })

  if (dashboard.isLoading) return <PanelLoading title="Dashboard" label="Loading dashboard…" />
  if (dashboard.error || !dashboard.data) {
    return <PanelError title="Dashboard" message="Unable to load dashboard data." />
  }
  const data = dashboard.data

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
  const hideCard = (key: CardKey) => {
    const next = [...hiddenCards, key]
    setHiddenCards(next)
    storeHiddenCards(next)
  }
  const showAllCards = () => {
    setHiddenCards([])
    storeHiddenCards([])
  }
  const categoriesById = new Map(data.categories.map((category) => [category.id, category]))
  // Chart marks open the ledger scoped to their slice, with Dashboard as the way back.
  const openLedger = (categoryId: number | null, range: { start: string; end: string } | null) => {
    const params = new URLSearchParams()
    if (categoryId !== null) params.set("category", String(categoryId))
    if (range) {
      params.set("period", "custom")
      params.set("start", range.start)
      params.set("end", range.end)
    } else {
      params.set("period", data.period.slug === "custom" ? "custom" : data.period.slug)
      if (data.period.slug === "custom") {
        params.set("start", data.period.start)
        params.set("end", data.period.end)
      }
    }
    for (const [key, value] of canonicalizeTagScope(searchParams)) {
      if (key === "tags" || key === "exclude_tags") params.set(key, value)
    }
    params.set("from", "dashboard")
    navigate(`/transactions?${params.toString()}`)
  }

  // Strip
  const { kpis, deltas } = data
  const delta = (cents: number) => (
    <>
      <Amount cents={cents} kind="signed" decimals={false} /> vs previous
    </>
  )
  const today = localIsoDate(now)
  const balanceMetric: Metric = {
    label: "Balance",
    value: <Amount cents={kpis.balance} />,
    detail: data.period.end >= today ? "as of today" : `as of ${MONTH_YEAR.format(new Date(`${data.period.end}T00:00:00Z`))}`,
  }
  const cashInMetric: Metric = { label: "Cash in", value: <Amount cents={kpis.income} />, detail: deltas ? delta(deltas.income) : undefined }
  const spentMetric: Metric = { label: "Spent", value: <Amount cents={kpis.expenses} />, detail: deltas ? delta(deltas.expenses) : undefined }
  const netMetric: Metric = {
    label: "Net",
    value: <Amount cents={kpis.income - kpis.expenses} kind="signed" tone={kpis.income >= kpis.expenses ? "income" : undefined} />,
    detail: deltas ? delta(deltas.income - deltas.expenses) : undefined,
  }
  const metrics = [balanceMetric, cashInMetric, spentMetric, netMetric]
  if (data.budget_pace) {
    metrics.push({
      label: "Budget pace",
      value: `${data.budget_pace.velocity_ratio.toFixed(2).replace(".", ",")}×`,
      detail: (
        <>
          <Amount cents={data.budget_pace.projected_cents} decimals={false} /> of{" "}
          <Amount cents={data.budget_pace.budget_cents} decimals={false} /> projected
        </>
      ),
    })
  }

  // Balance: month-end actuals up to today, then the likely forecast and its 80 % range.
  const actual = history.data?.months ?? []
  const projected = forecast.data?.months ?? []
  const todayIndex = actual.length - 1
  const balanceLabels = [
    ...actual.map((point, index) => (index === todayIndex ? "Today" : SHORT_MONTH.format(monthDate(point.month)))),
    ...projected.map((point) => SHORT_MONTH.format(monthDate(point.month))),
  ]
  const actualValues = [...actual.map((point) => point.balance_cents), ...projected.map(() => null)]
  const bridge = actual[todayIndex]?.balance_cents ?? null
  const likelyValues = [...actual.map((_, index) => (index === todayIndex ? bridge : null)), ...projected.map((point) => point.end_balance_cents)]
  const rangeAvailable = projected.length > 0 && projected.every((point) => point.end_balance_p10_cents != null && point.end_balance_p90_cents != null)
  const rangeLo = [...actual.map((_, index) => (index === todayIndex ? bridge : null)), ...projected.map((point) => point.end_balance_p10_cents ?? null)]
  const rangeHi = [...actual.map((_, index) => (index === todayIndex ? bridge : null)), ...projected.map((point) => point.end_balance_p90_cents ?? null)]
  const finalForecast = projected[projected.length - 1]
  const balanceLegend: LegendEntry[] = [
    { key: "actual", label: "Actual", color: "var(--ink)", mark: "line" },
    ...(projected.length ? [{ key: "likely", label: "Likely", color: "var(--ink-3)", mark: "dash" as const }] : []),
    ...(rangeAvailable && showRange ? [{ key: "range", label: "80% range", color: "var(--band)", mark: "area" as const }] : []),
  ]
  const balanceTip = (index: number) => {
    const projectedPoint = index > todayIndex ? projected[index - actual.length] : undefined
    return (
      <ChartTooltip
        title={balanceLabels[index]}
        rows={
          projectedPoint
            ? [
                { key: "likely", label: "Likely", value: <Amount cents={projectedPoint.end_balance_cents} decimals={false} /> },
                ...(rangeAvailable
                  ? [
                      {
                        key: "range",
                        label: "80% range",
                        value: (
                          <>
                            <Amount cents={projectedPoint.end_balance_p10_cents ?? 0} decimals={false} /> –{" "}
                            <Amount cents={projectedPoint.end_balance_p90_cents ?? 0} decimals={false} />
                          </>
                        ),
                      },
                    ]
                  : []),
              ]
            : [{ key: "actual", label: "Balance", value: <Amount cents={actual[index].balance_cents} /> }]
        }
      />
    )
  }

  // Spending by category: one band per month, newest first, scaled to the largest month.
  const bandData = bands.data?.months ?? []
  const bandMax = Math.max(1, ...bandData.map((month) => month.total_cents))
  const bandCategories = new Map<string, { label: string; color: string; total: number }>()
  for (const month of bandData) {
    for (const segment of month.segments) {
      const key = String(segment.category_id)
      const entry = bandCategories.get(key) ?? { label: segment.name, color: categoryColor(segment.category_id), total: 0 }
      entry.total += segment.amount_cents
      bandCategories.set(key, entry)
    }
  }
  const bandRows: StackedRow[] = [...bandData].reverse().map((month) => ({
    key: month.month,
    label: SHORT_MONTH.format(monthDate(month.month)),
    total: <Amount cents={month.total_cents} />,
    segments: month.segments
      .filter((segment) => segment.amount_cents > 0)
      .map((segment) => ({ key: String(segment.category_id), value: segment.amount_cents, color: categoryColor(segment.category_id) })),
  }))
  const bandLegend: LegendEntry[] = [...bandCategories.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([key, entry]) => ({ key, label: entry.label, color: entry.color }))

  // Category share for the period.
  const shareItems = (shareType === "expense" ? data.donut.expense_breakdown : data.donut.income_breakdown) ?? []
  const shareTotal = shareItems.reduce((sum, item) => sum + item.amount_cents, 0)
  const periodName = periodLabel(period, DEFAULT_PERIOD_PRESETS)

  // Budgets: the most urgent category budgets of the month, with even pace as of today.
  const budgets = data.category_budget_pulse ?? []
  const asOf = data.period.slug === "last_month" ? new Date(`${data.period.end}T00:00:00`) : now
  const pace = asOf.getDate() / new Date(asOf.getFullYear(), asOf.getMonth() + 1, 0).getDate()

  const overall = data.budget_pace
  const summaryBudget: SummaryBudget | undefined = overall
    ? {
        label: "Overall budget",
        used: (
          <>
            <Amount cents={overall.spent_cents} decimals={false} /> of <Amount cents={overall.budget_cents} decimals={false} />
          </>
        ),
        ratio: overall.budget_cents ? overall.spent_cents / overall.budget_cents : 0,
        over: overall.remaining_cents < 0,
        pace,
        remaining:
          overall.remaining_cents < 0 ? (
            <>
              <Amount cents={-overall.remaining_cents} decimals={false} tone="over" /> over
            </>
          ) : (
            <>
              <Amount cents={overall.remaining_cents} decimals={false} /> left
              {overall.days_remaining > 0 ? (
                <>
                  {" · "}
                  <Amount cents={overall.daily_remaining_cents} decimals={false} />
                  /day
                </>
              ) : null}
            </>
          ),
        // A finished month has no projection left to make.
        projection:
          overall.days_remaining > 0 ? (
            <>
              Likely <Amount cents={overall.projected_cents} decimals={false} />
            </>
          ) : undefined,
        projectionOver: overall.projected_cents > overall.budget_cents,
      }
    : undefined

  const durableItems = (durable.data?.items ?? []).filter((item) => showAmortized || !item.fully_amortized)
  const amortizedCount = (durable.data?.items ?? []).filter((item) => item.fully_amortized).length

  const chartMenu = (key: CardKey, insights: boolean) => (
    <>
      {insights ? <MenuLink to="/insights">Open in Insights</MenuLink> : null}
      <MenuSeparator />
      <MenuItem onSelect={() => hideCard(key)}>Hide from dashboard</MenuItem>
    </>
  )

  const balanceCard = hiddenCards.includes("balance") ? null : (
    <ChartCard
      title="Balance"
      meta={
        finalForecast ? (
          <>
            likely <Amount cents={finalForecast.end_balance_cents} decimals={false} /> in{" "}
            {SHORT_MONTH.format(monthDate(finalForecast.month))}
          </>
        ) : undefined
      }
      menu={
        <>
          <MenuLink to="/forecast">Open in Forecast</MenuLink>
          <MenuSeparator />
          <MenuItem onSelect={() => hideCard("balance")}>Hide from dashboard</MenuItem>
          {rangeAvailable ? (
            <>
              <MenuSeparator />
              <MenuItem checked={showRange} onSelect={() => setShowRange(!showRange)}>
                Show forecast range
              </MenuItem>
            </>
          ) : null}
        </>
      }
      legend={balanceLegend}
      empty={history.isError ? "Balance history is unavailable." : actual.length ? undefined : history.isLoading ? "Loading…" : "No balance history yet."}
      table={
        <ChartTable
          label="Balance by month"
          columns={["Month", "Actual", "Likely", "80% range"]}
          rows={balanceLabels.map((label, index) => ({
            key: String(index),
            cells: [
              label,
              actualValues[index] === null ? "–" : <Amount cents={actualValues[index] as number} />,
              index > todayIndex && likelyValues[index] !== null ? <Amount cents={likelyValues[index] as number} /> : "–",
              index > todayIndex && rangeAvailable ? (
                <>
                  <Amount cents={rangeLo[index] as number} /> – <Amount cents={rangeHi[index] as number} />
                </>
              ) : (
                "–"
              ),
            ],
          }))}
        />
      }
    >
      {(focus) => (
        <LineChart
          labels={balanceLabels}
          height={isDesktop ? 180 : 120}
          xEvery={isDesktop ? 1 : 3}
          mark={projected.length ? todayIndex : undefined}
          idle={todayIndex}
          focus={focus}
          series={[
            { key: "actual", values: actualValues },
            ...(projected.length ? [{ key: "likely", values: likelyValues, color: "var(--ink-3)", dash: true }] : []),
          ]}
          bands={rangeAvailable && showRange ? [{ key: "range", lo: rangeLo, hi: rangeHi }] : []}
          tooltip={balanceTip}
        />
      )}
    </ChartCard>
  )
  const recentCard = (
    <Sheet
      title="Recent"
        actions={<IconButton icon={ArrowRightIcon} label="Open transactions" onClick={() => navigate("/transactions")} />}
    >
      {data.recent.length ? (
        <List flat label="Recent transactions">
          {data.recent.slice(0, 7).map((row) => (
            <Row
              key={row.id}
              {...RECENT_COLUMNS}
              label={row.title || "Untitled"}
              onOpen={() => navigate(`/transactions?peek=${row.id}`)}
            >
              <CategoryGlyph categoryId={row.category?.id} icon={row.category?.icon} name={row.category?.name} />
              <Cell>{row.title || "Untitled"}</Cell>
              <AmountCell>
                <Amount cents={row.amount_cents} kind={row.type === "income" ? "income" : "expense"} />
              </AmountCell>
            </Row>
          ))}
        </List>
      ) : (
        <EmptyState inline>No transactions in this period</EmptyState>
      )}
    </Sheet>
  )
  const spendingCard = hiddenCards.includes("spending") ? null : (
    <ChartCard
      title="Spending by category"
      controls={
        <SegmentedControl
          label="Months"
          value={bandMonths}
          options={[
            { value: "6", label: "6M" },
            { value: "12", label: "12M" },
          ]}
          onChange={setBandMonths}
        />
      }
      menu={chartMenu("spending", true)}
      legend={bandLegend}
      empty={bands.isError ? "Spending is unavailable." : bandData.some((month) => month.total_cents > 0) ? undefined : bands.isLoading ? "Loading…" : "No spending in these months."}
      table={
        <ChartTable
          label="Spending by category and month"
          columns={["Month", ...bandLegend.map((entry) => String(entry.label)), "Total"]}
          rows={bandData.map((month) => ({
            key: month.month,
            cells: [
              MONTH_YEAR.format(monthDate(month.month)),
              ...bandLegend.map((entry) => {
                const segment = month.segments.find((item) => String(item.category_id) === entry.key)
                return segment ? <Amount cents={segment.amount_cents} /> : "–"
              }),
              <Amount cents={month.total_cents} />,
            ],
          }))}
        />
      }
    >
      {(focus) => (
        <StackedBands
          rows={bandRows}
          max={bandMax}
          focus={focus}
          tooltip={(row, segment) => {
            const entry = bandCategories.get(segment.key)
            return (
              <ChartTooltip
                title={MONTH_YEAR.format(monthDate(row.key))}
                rows={[{ key: segment.key, label: entry?.label, value: <Amount cents={segment.value} />, color: segment.color }]}
              />
            )
          }}
          onSelect={(row, segment) =>
            openLedger(segment.key === "null" ? null : Number(segment.key), monthBounds(row.key))
          }
        />
      )}
    </ChartCard>
  )
  const shareCard = hiddenCards.includes("share") ? null : (
    <ChartCard
      title="Category share"
      controls={
        <SegmentedControl
          label="Type"
          value={shareType}
          options={[
            { value: "expense", label: "Expenses" },
            { value: "income", label: "Income" },
          ]}
          onChange={setShareType}
        />
      }
      menu={chartMenu("share", true)}
      empty={shareItems.length ? undefined : shareType === "expense" ? "No spending in this period." : "No income in this period."}
      table={
        <ChartTable
          label="Category share"
          columns={["Category", "Amount", "Share"]}
          rows={shareItems.map((item) => ({
            key: String(item.category_id),
            cells: [item.name, <Amount cents={item.amount_cents} />, `${Math.round(item.percent)} %`],
          }))}
        />
      }
    >
      {(focus) => (
        <Donut
          focus={focus}
          center={<Amount cents={shareTotal} decimals={false} />}
          centerLabel={isDesktop ? periodName : undefined}
          compact={!isDesktop}
          items={shareItems.map((item) => ({
            key: String(item.category_id),
            label: item.name,
            value: item.amount_cents,
            color: categoryColor(item.category_id),
            amount: <Amount cents={item.amount_cents} />,
            share: `${Math.round(item.percent)} %`,
          }))}
          tooltip={(item) => (
            <ChartTooltip rows={[{ key: item.key, label: item.label, value: item.amount, color: item.color }]} />
          )}
          onSelect={(item) => openLedger(item.key === "null" ? null : Number(item.key), null)}
        />
      )}
    </ChartCard>
  )
  const budgetsCard = (
    <Sheet
      title="Budgets"
        actions={<IconButton icon={ArrowRightIcon} label="Open budgets" onClick={() => navigate("/budgets")} />}
    >
      {budgets.length ? (
          <List flat label="Budgets">
            {budgets.map((budget) => {
              const category = categoriesById.get(budget.scope_category_id)
              const over = budget.remaining_cents < 0
              return (
                <Row
                  key={budget.scope_category_id}
                  columns="18px 110px minmax(0, 1fr) 110px"
                  mobileColumns="18px 92px minmax(0, 1fr) 84px"
                  label={budget.scope_label}
                  onOpen={() => navigate("/budgets")}
                >
                  <CategoryGlyph categoryId={budget.scope_category_id} icon={category?.icon} name={budget.scope_label} />
                  <Cell>{budget.scope_label}</Cell>
                  <BudgetBar ratio={budget.spent_cents / budget.amount_cents} over={over} pace={pace} />
                  <Cell align="right" tone="muted">
                    {over ? (
                      <>
                        <Amount cents={-budget.remaining_cents} decimals={false} tone="over" /> over
                      </>
                    ) : (
                      <>
                        <Amount cents={budget.remaining_cents} decimals={false} /> left
                      </>
                    )}
                  </Cell>
                </Row>
              )
            })}
          </List>
      ) : (
        <EmptyState inline>No category budgets this month</EmptyState>
      )}
    </Sheet>
  )

  return (
    <Panel
      title="Dashboard"
      actions={
        <>
          <IconButton
            icon={hidden ? EyeIcon : EyeSlashIcon}
            label={hidden ? "Show amounts" : "Hide amounts"}
            aria-pressed={hidden}
            onClick={() => setPrivacy(!hidden)}
          />
          {hiddenCards.length ? (
            <Menu label="More actions" trigger={<IconButton icon={DotsThreeIcon} label="More actions" />}>
              <MenuItem onSelect={showAllCards}>Show hidden cards ({hiddenCards.length})</MenuItem>
            </Menu>
          ) : null}
        </>
      }
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
        </ViewRow>
      }
    >
      {isDesktop ? (
        <>
          <MetricStrip metrics={metrics} />
          <CardRow wide>
            {balanceCard}
            {recentCard}
          </CardRow>
          {spendingCard}
          <CardRow>
            {shareCard}
            {budgetsCard}
          </CardRow>
        </>
      ) : (
        <>
          <SummaryCard lead={spentMetric} budget={summaryBudget} metrics={[balanceMetric, cashInMetric, netMetric]} />
          {budgetsCard}
          {recentCard}
          {balanceCard}
          {spendingCard}
          {shareCard}
        </>
      )}
      <Sheet
        title="Durable purchases"
        menu={
          amortizedCount ? (
            <MenuItem checked={showAmortized} onSelect={() => setShowAmortized(!showAmortized)}>
              Show fully amortized ({amortizedCount})
            </MenuItem>
          ) : undefined
        }
      >
        {durableItems.length ? (
          <List flat label="Durable purchases">
            {durableItems.map((item) => (
              <Row
                key={item.id}
                {...DURABLE_COLUMNS}
                label={item.title || "Untitled"}
                onOpen={() =>
                  navigate(`/transactions/${item.transaction_id}`, { state: { returnTo: "/", returnLabel: "Dashboard" } })
                }
              >
                <CategoryGlyph categoryId={item.category?.id} icon={item.category?.icon} name={item.category?.name} />
                <Cell>{item.title || "Untitled"}</Cell>
                <Cell align="right" tone="muted" hide="mobile">
                  <Amount cents={Math.round(item.cost_per_day_cents)} />
                  /day
                </Cell>
                <Cell hide="mobile">
                  <BudgetBar ratio={item.percent_amortized / 100} />
                </Cell>
                <Cell align="right" tone="muted">
                  {formatCount(item.days_owned)} of {formatCount(item.expected_lifespan_days)} days
                </Cell>
              </Row>
            ))}
          </List>
        ) : (
          <EmptyState inline>No durable purchases are being tracked</EmptyState>
        )}
      </Sheet>
    </Panel>
  )
}

export default DashboardPage
