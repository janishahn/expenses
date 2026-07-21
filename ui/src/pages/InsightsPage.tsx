import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { XIcon } from "@phosphor-icons/react/X"
import { Link, useSearchParams } from "react-router-dom"
import { apiFetch } from "../app/api"
import { formatCurrency, formatEuroDate } from "../app/format"
import { CategoryIcon } from "../components/CategoryIcon"
import BarChart from "../components/charts/BarChart"
import { readThemeColor } from "../components/charts/chartSetup"
import LineChart from "../components/charts/LineChart"
import { palette } from "../components/charts/palette"
import PeriodPicker from "../components/PeriodPicker"
import SankeyChart from "../components/charts/SankeyChart"
import SegmentedControl from "../components/SegmentedControl"
import {
  FinancialPanel,
  MetricLane,
  SectionHeading,
  WorkspaceToolbar,
} from "../components/product/ProductSurfaces"
import { AppButton } from "../components/ui/product-button"
import { AppFieldLabel, AppInput, AppNativeSelect } from "../components/ui/product-fields"
import {
  buildCustomPeriodSearchParams,
  buildPresetPeriodSearchParams,
  buildSearchParams,
  type PresetPeriod,
} from "../lib/searchParams"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "../components/ui/sheet"
import { useThemePreference } from "../theme/useThemePreference"
import {
  buildGroupedFlow,
  type FlowLink,
  type FlowNode,
} from "../components/charts/flowGrouping"

type MonthlySeriesPoint = {
  year: number
  month: number
  label: string
  income_cents: number
  expense_cents: number
  net_cents: number
}

type BreakdownItem = {
  name: string
  amount_cents: number
  percent: number
}

type DeltaItem = {
  category_id: number
  category_name: string
  current_cents: number
  previous_cents: number
  delta_cents: number
}

type BudgetEffective = {
  scope_category_id: number | null
  scope_label: string
  amount_cents: number
  source: string
  source_id: number
}

type InsightsResponse = {
  period: { slug: string; start: string; end: string }
  filters: { type: string | null; tag_id: number | null }
  tags: Array<{ id: number; name: string }>
  categories: Array<{ id: number; name: string; type: string; icon: string | null }>
  series: MonthlySeriesPoint[]
  expense_breakdown: BreakdownItem[]
  income_breakdown: BreakdownItem[]
  deltas: { increases: DeltaItem[]; decreases: DeltaItem[] }
  top_tags: Array<{ id: number; name: string; amount_cents: number }>
  trend_category_id: number | null
  trend: Array<{ year: number; month: number; label: string; amount_cents: number }>
  budget_month: string
  budget_effective: BudgetEffective[]
  budget_progress: Record<string, { spent_cents: number; remaining_cents: number }>
}

type InsightsFlowResponse = {
  period: { slug: string; start: string; end: string }
  filters: { type: string | null; tag_id: number | null }
  nodes: FlowNode[]
  links: FlowLink[]
}

function InsightsPage() {
  useThemePreference()
  const [searchParams, setSearchParams] = useSearchParams()
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [groupedFlow, setGroupedFlow] = useState(false)
  const [mobileType, setMobileType] = useState("")
  const [mobileTag, setMobileTag] = useState("")
  const [mobileTrendCategory, setMobileTrendCategory] = useState("")
  const [mobileBudgetMonth, setMobileBudgetMonth] = useState("")
  const [isDesktop, setIsDesktop] = useState(() =>
    window.matchMedia("(min-width: 861px)").matches
  )
  const activeView = searchParams.get("view") === "flow" ? "flow" : "charts"
  const queryString = useMemo(() => {
    const params = new URLSearchParams(searchParams)
    if (!params.get("period")) {
      params.set("period", "all")
    }
    return params.toString()
  }, [searchParams])

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["insights", queryString],
    queryFn: () => apiFetch<InsightsResponse>(`/api/insights?${queryString}`),
  })
  const {
    data: flowData,
    isFetching: flowFetching,
    error: flowError,
  } = useQuery({
    queryKey: ["insights", "flow", queryString],
    queryFn: () => apiFetch<InsightsFlowResponse>(`/api/insights/flow?${queryString}`),
    enabled: activeView === "flow",
  })

  const flowPayload = useMemo(
    () =>
      flowData
        ? groupedFlow
          ? buildGroupedFlow(flowData.nodes, flowData.links)
          : { nodes: flowData.nodes, links: flowData.links }
        : { nodes: [], links: [] },
    [flowData, groupedFlow],
  )

  const updateParam = (key: string, value: string | null) => {
    setSearchParams(buildSearchParams(searchParams, { [key]: value }))
  }

  const setPresetPeriod = (value: PresetPeriod) =>
    setSearchParams(buildPresetPeriodSearchParams(searchParams, value))

  const applyCustomPeriod = (start: string, end: string) =>
    setSearchParams(buildCustomPeriodSearchParams(searchParams, start, end))
  const setType = (value: string) => updateParam("type", value || null)
  const setTag = (value: string) => updateParam("tag", value || null)
  const setTrendCategory = (value: string) =>
    updateParam("trend_category", value || null)
  const setBudgetMonth = (value: string) =>
    updateParam("budget_month", value || null)
  const setView = (view: "charts" | "flow") =>
    setSearchParams(
      buildSearchParams(searchParams, { view: view === "flow" ? "flow" : null })
    )

  useEffect(() => {
    const media = window.matchMedia("(min-width: 861px)")
    const syncDesktop = () => {
      setIsDesktop(media.matches)
      if (media.matches) {
        setMobileFiltersOpen(false)
      }
    }
    syncDesktop()
    media.addEventListener("change", syncDesktop)
    return () => media.removeEventListener("change", syncDesktop)
  }, [])

  if (isLoading) {
    return <div className="text-muted">Loading insights…</div>
  }
  if (error || !data) {
    return <div className="text-semantic-red">Unable to load insights.</div>
  }

  const {
    period,
    filters,
    tags,
    categories,
    series,
    expense_breakdown,
    income_breakdown,
    deltas,
    top_tags,
    trend,
    trend_category_id,
    budget_month,
    budget_effective,
    budget_progress,
  } = data
  const expenseCategories = categories.filter((category) => category.type === "expense")
  const summary =
    period.slug === "all"
      ? "Date: All time"
      : `Date: ${formatEuroDate(period.start)} → ${formatEuroDate(period.end)}`
  const [rangeStartYear, rangeStartMonth] = period.start.split("-").map(Number)
  const [rangeEndYear, rangeEndMonth] = period.end.split("-").map(Number)
  const rangeMonthCount =
    (rangeEndYear - rangeStartYear) * 12 + rangeEndMonth - rangeStartMonth + 1

  const expenseIconMap = Object.fromEntries(
    expenseCategories
      .map((category) => [category.name, category.icon])
  )
  const incomeIconMap = Object.fromEntries(
    categories
      .filter((category) => category.type === "income")
      .map((category) => [category.name, category.icon])
  )

  const seriesLabels = series.map((row) => row.label)
  const trendLabels = trend.map((row) =>
    new Date(
      `${row.year}-${String(row.month).padStart(2, "0")}-01T00:00:00`
    ).toLocaleDateString("en-GB", { month: "short", year: "numeric" })
  )
  const selectedTag = filters.tag_id
    ? tags.find((tag) => tag.id === filters.tag_id)?.name
    : null
  const selectedTrendCategory = trend_category_id
    ? expenseCategories.find((category) => category.id === trend_category_id)?.name
    : null
  const trendDisabled = filters.type === "income"
  const trendHasSpend = trend.some((row) => row.amount_cents > 0)
  const trendWindowEndLabel = new Date(`${period.end}T00:00:00`).toLocaleDateString(
    "en-GB",
    { month: "short", year: "numeric" }
  )
  const activeFilters = [
    filters.type ? `Type: ${filters.type}` : null,
    selectedTag ? `Tag: ${selectedTag}` : null,
    !trendDisabled && selectedTrendCategory ? `Trend: ${selectedTrendCategory}` : null,
    budget_month ? `Budget month: ${budget_month}` : null,
  ].filter(Boolean) as string[]
  const incomeColor = readThemeColor("--semantic-green", "98 196 146")
  const expenseColor = readThemeColor("--semantic-red", "224 114 102")
  const trendColor = readThemeColor("--accent", "245 185 85")
  const flowExpenseNodes = flowPayload.nodes.filter(
    (node) => node.type === "expense" && node.category_id != null && Number.isFinite(node.category_id)
  )

  const openMobileFilters = () => {
    setMobileType(filters.type ?? "")
    setMobileTag(filters.tag_id ? String(filters.tag_id) : "")
    setMobileTrendCategory(trend_category_id ? String(trend_category_id) : "")
    setMobileBudgetMonth(budget_month)
    setMobileFiltersOpen(true)
  }

  const clearFilters = () => {
    const params = new URLSearchParams(searchParams)
    params.delete("type")
    params.delete("tag")
    params.delete("trend_category")
    params.delete("budget_month")
    setSearchParams(params)
  }

  const applyMobileFilters = () => {
    const params = new URLSearchParams(searchParams)
    if (mobileType) {
      params.set("type", mobileType)
    } else {
      params.delete("type")
    }
    if (mobileTag) {
      params.set("tag", mobileTag)
    } else {
      params.delete("tag")
    }
    if (mobileTrendCategory) {
      params.set("trend_category", mobileTrendCategory)
    } else {
      params.delete("trend_category")
    }
    if (mobileBudgetMonth) {
      params.set("budget_month", mobileBudgetMonth)
    } else {
      params.delete("budget_month")
    }
    setSearchParams(params)
    setMobileFiltersOpen(false)
  }

  const goToCategoryTransactions = (categoryId: number) => {
    const params = new URLSearchParams()
    params.set("period", period.slug)
    if (period.slug === "custom") {
      params.set("start", period.start)
      params.set("end", period.end)
    }
    params.set("type", "expense")
    params.set("category", String(categoryId))
    if (filters.tag_id) {
      params.set("tag", String(filters.tag_id))
    }
    window.location.assign(`/transactions?${params.toString()}`)
  }

  return (
    <section className="space-y-4 md:space-y-5">
      <header className="flex min-h-11 flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-head text-2xl font-bold tracking-tight text-text md:text-3xl">
            Insights
          </h1>
          <p className="mt-1 text-sm text-muted">{summary}</p>
        </div>
        {isFetching || flowFetching ? <span className="loading-hint">Updating…</span> : null}
      </header>

      <WorkspaceToolbar className="insights-view-switcher justify-between">
        <SegmentedControl
          value={activeView}
          ariaLabel="Insights view"
          items={[
            { value: "charts", label: "Analysis" },
            { value: "flow", label: "Flow" },
          ]}
          onValueChange={setView}
        />
        <span className="mono-meta hidden text-muted sm:block">
          {rangeMonthCount} {rangeMonthCount === 1 ? "month" : "months"} view
        </span>
      </WorkspaceToolbar>

      <PeriodPicker
        periodSlug={period.slug}
        start={period.start}
        end={period.end}
        onSetPreset={setPresetPeriod}
        onApplyCustom={applyCustomPeriod}
      />

      {activeView === "charts" ? (
        <>
      <div className="desk:hidden">
        <div className="flex items-center gap-2">
          <AppButton
            type="button"
            onClick={openMobileFilters}
            tone="ghost"
            className="flex-1 text-xs"
          >
            Filters {activeFilters.length ? `(${activeFilters.length})` : ""}
          </AppButton>
          {activeFilters.length > 0 && (
            <AppButton
              type="button"
              onClick={clearFilters}
              tone="ghost"
              className="text-xs text-muted"
            >
              Clear
            </AppButton>
          )}
        </div>
        {activeFilters.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {activeFilters.map((filter) => (
              <span
                key={filter}
                className="chip text-[11px]"
              >
                {filter}
              </span>
            ))}
          </div>
        )}
      </div>

      <WorkspaceToolbar className="hidden gap-4 desk:grid desk:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <AppFieldLabel>
          <span>Type</span>
          <SegmentedControl
            value={filters.type ?? ""}
            ariaLabel="Transaction type"
            className="self-start"
            items={[
              { value: "", label: "All" },
              { value: "expense", label: "Expense" },
              { value: "income", label: "Income" },
            ]}
            onValueChange={setType}
          />
        </AppFieldLabel>
        <AppFieldLabel>
          <span>Tag filter</span>
          <AppNativeSelect
            value={filters.tag_id ?? ""}
            onChange={(event) => setTag(event.target.value)}
          >
            <option value="">All tags</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </AppNativeSelect>
        </AppFieldLabel>
        <AppFieldLabel>
          <span>Trend category</span>
          <AppNativeSelect
            value={trend_category_id ?? ""}
            onChange={(event) => setTrendCategory(event.target.value)}
            disabled={trendDisabled || expenseCategories.length === 0}
          >
            {expenseCategories.length ? (
              expenseCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))
            ) : (
              <option value="">No expense categories</option>
            )}
          </AppNativeSelect>
          {trendDisabled ? (
            <span className="text-[11px] font-medium normal-case tracking-normal text-muted">
              Expense only
            </span>
          ) : null}
        </AppFieldLabel>
        <AppFieldLabel>
          <span>Budget month</span>
          <AppInput
            type="month"
            value={budget_month}
            onChange={(event) => setBudgetMonth(event.target.value)}
          />
        </AppFieldLabel>
      </WorkspaceToolbar>

      {mobileFiltersOpen && !isDesktop ? (
        <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
          <SheetContent side="bottom" className="max-h-[88vh]" aria-label="Insights filters">
            <SheetHeader>
              <SheetTitle className="text-sm">Insights filters</SheetTitle>
              <SheetClose asChild>
                <AppButton
                  tone="ghost"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border p-0 text-muted hover:border-border-hi hover:text-text"
                  aria-label="Close filters"
                >
                  <XIcon className="h-4 w-4" />
                </AppButton>
              </SheetClose>
            </SheetHeader>
            <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-5 py-4">
              <AppFieldLabel>
                <span>Type</span>
                <SegmentedControl
                  value={mobileType}
                  ariaLabel="Transaction type"
                  className="self-start"
                  items={[
                    { value: "", label: "All" },
                    { value: "expense", label: "Expense" },
                    { value: "income", label: "Income" },
                  ]}
                  onValueChange={setMobileType}
                />
              </AppFieldLabel>
              <AppFieldLabel>
                <span>Tag filter</span>
                <AppNativeSelect
                  value={mobileTag}
                  onChange={(event) => setMobileTag(event.target.value)}
                >
                  <option value="">All tags</option>
                  {tags.map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name}
                    </option>
                  ))}
                </AppNativeSelect>
              </AppFieldLabel>
              <AppFieldLabel>
                <span>Trend category</span>
                <AppNativeSelect
                  value={mobileTrendCategory}
                  onChange={(event) => setMobileTrendCategory(event.target.value)}
                  disabled={mobileType === "income" || expenseCategories.length === 0}
                >
                  {expenseCategories.length ? (
                    expenseCategories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))
                  ) : (
                    <option value="">No expense categories</option>
                  )}
                </AppNativeSelect>
                {mobileType === "income" ? (
                  <span className="text-[11px] font-medium normal-case tracking-normal text-muted">
                    Expense only
                  </span>
                ) : null}
              </AppFieldLabel>
              <AppFieldLabel>
                <span>Budget month</span>
                <AppInput
                  type="month"
                  value={mobileBudgetMonth}
                  onChange={(event) => setMobileBudgetMonth(event.target.value)}
                />
              </AppFieldLabel>
            </div>
            <SheetFooter className="mt-0 flex shrink-0 flex-row gap-2 p-5 pt-0">
              <AppButton
                type="button"
                onClick={() => {
                  clearFilters()
                  setMobileFiltersOpen(false)
                }}
                tone="ghost"
              >
                Clear
              </AppButton>
              <SheetClose asChild>
                <AppButton type="button" tone="ghost">
                  Cancel
                </AppButton>
              </SheetClose>
              <AppButton
                type="button"
                onClick={applyMobileFilters}
                className="flex-1"
              >
                Apply
              </AppButton>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <FinancialPanel role="chart">
          <SectionHeading>
            <div>
              <h2 className="font-head text-lg font-bold">Monthly income vs expenses</h2>
              <p className="mt-0.5 text-xs text-muted">
                Net after reimbursements · {series.length} months
              </p>
            </div>
            <span className="mono-meta text-muted">Trend</span>
          </SectionHeading>
          <div className="p-4 md:p-5">
            <LineChart
              ariaLabel="Monthly income compared with expenses"
              labels={seriesLabels}
              series={[
                {
                  label: "Income",
                  data: series.map((row) => row.income_cents),
                  color: incomeColor,
                  fill: true,
                },
                {
                  label: "Expenses",
                  data: series.map((row) => row.expense_cents),
                  color: expenseColor,
                  fill: true,
                },
              ]}
            />
          </div>
        </FinancialPanel>

        <FinancialPanel role="chart">
          <SectionHeading>
            <div className="min-w-0">
              <h2 className="truncate font-head text-lg font-bold">
                {!trendDisabled && selectedTrendCategory
                  ? `Category trend: ${selectedTrendCategory}`
                  : "Category trend"}
              </h2>
              <p className="mt-0.5 text-xs text-muted">
                {trendDisabled
                  ? "Available for expense activity"
                  : selectedTrendCategory
                    ? trendHasSpend
                      ? `${trend.length} months ending ${trendWindowEndLabel}`
                      : `No spend ending ${trendWindowEndLabel}`
                    : "Choose an expense category"}
              </p>
            </div>
          </SectionHeading>
          <div className="flex min-h-[16rem] items-center p-4 md:p-5">
            {!trendDisabled && selectedTrendCategory && trendHasSpend ? (
              <div className="w-full">
                <BarChart
                  ariaLabel={`Monthly net spending for ${selectedTrendCategory}`}
                  labels={trendLabels}
                  series={[
                    {
                      label: "Net spend",
                      data: trend.map((row) => row.amount_cents),
                      color: trendColor,
                    },
                  ]}
                  height={220}
                />
              </div>
            ) : (
              <p className="mx-auto max-w-xs text-center text-sm text-muted">
                {trendDisabled
                  ? "Switch Type to All or Expense to compare category spending."
                  : selectedTrendCategory
                    ? "No spending in this category during the selected trend window."
                    : "Create an expense category to start a category trend."}
              </p>
            )}
          </div>
        </FinancialPanel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <FinancialPanel>
          <SectionHeading>
            <div>
              <h2 className="font-head text-lg font-bold">Top categories</h2>
              <p className="mt-0.5 text-xs text-muted">Where money entered and left</p>
            </div>
          </SectionHeading>
          <div className="grid gap-3 p-3 sm:grid-cols-2 md:p-4">
            <MetricLane tone="expense">
              <p className="text-sm font-semibold text-text">Expenses</p>
              {expense_breakdown.length ? (
                <div className="mt-3 space-y-3">
                  {expense_breakdown.map((row, index) => (
                    <div key={row.name} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="flex min-w-0 items-center gap-2 text-text">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: palette[index % palette.length] }}
                          />
                          <CategoryIcon
                            icon={expenseIconMap[row.name] ?? null}
                            label={row.name}
                          />
                          <span className="truncate">{row.name}</span>
                        </span>
                        <span className="amount-text shrink-0 text-semantic-red">
                          {formatCurrency(row.amount_cents)} €
                        </span>
                      </div>
                      <div className="h-[5px] rounded-full bg-surface/70">
                        <div
                          className="h-[5px] rounded-full bg-semantic-red"
                          style={{ width: `${row.percent}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted">No expenses in this period.</p>
              )}
            </MetricLane>
            <MetricLane tone="income">
              <p className="text-sm font-semibold text-text">Income</p>
              {income_breakdown.length ? (
                <div className="mt-3 space-y-3">
                  {income_breakdown.map((row, index) => (
                    <div key={row.name} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="flex min-w-0 items-center gap-2 text-text">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: palette[index % palette.length] }}
                          />
                          <CategoryIcon
                            icon={incomeIconMap[row.name] ?? null}
                            label={row.name}
                          />
                          <span className="truncate">{row.name}</span>
                        </span>
                        <span className="amount-text shrink-0 text-semantic-green">
                          {formatCurrency(row.amount_cents)} €
                        </span>
                      </div>
                      <div className="h-[5px] rounded-full bg-surface/70">
                        <div
                          className="h-[5px] rounded-full bg-semantic-green"
                          style={{ width: `${row.percent}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted">No income in this period.</p>
              )}
            </MetricLane>
          </div>
        </FinancialPanel>

        <FinancialPanel role="ledger">
          <SectionHeading>
            <div>
              <h2 className="font-head text-lg font-bold">Budget vs actual</h2>
              <p className="mt-0.5 text-xs text-muted">{budget_month}</p>
            </div>
            <span className="mono-meta text-muted">Plan</span>
          </SectionHeading>
          <div className="divide-y divide-border px-4">
            {budget_effective.length ? (
              budget_effective.map((row) => {
                const progress =
                  budget_progress[String(row.scope_category_id ?? "null")] ??
                  budget_progress[String(row.scope_category_id ?? "")] ??
                  { spent_cents: 0, remaining_cents: row.amount_cents }
                const spent = progress.spent_cents
                const remaining = progress.remaining_cents
                const over = remaining < 0
                const pct = row.amount_cents
                  ? Math.min(100, (spent / row.amount_cents) * 100)
                  : 0
                const budgetCategory = expenseCategories.find(
                  (category) => category.id === row.scope_category_id
                )
                return (
                  <div key={`${row.scope_label}-${row.source_id}`} className="py-3.5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <CategoryIcon
                          icon={budgetCategory?.icon ?? null}
                          label={row.scope_label}
                        />
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-text">{row.scope_label}</p>
                          <p className="text-xs text-muted">
                            {row.source} · {formatCurrency(row.amount_cents)} € planned
                          </p>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="mono-meta text-muted">Spent {formatCurrency(spent)} €</p>
                        <p
                          className={`amount-text text-sm ${
                            over ? "text-semantic-red" : "text-semantic-green"
                          }`}
                        >
                          {over ? "Over" : "Left"} {formatCurrency(Math.abs(remaining))} €
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 h-[5px] rounded-full bg-faint">
                      <div
                        className={`h-[5px] rounded-full ${
                          over ? "bg-semantic-red" : "bg-semantic-green"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })
            ) : (
              <p className="py-5 text-sm text-muted">No budgets set.</p>
            )}
          </div>
        </FinancialPanel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <FinancialPanel>
          <SectionHeading>
            <div>
              <h2 className="font-head text-lg font-bold">Biggest deltas</h2>
              <p className="mt-0.5 text-xs text-muted">Largest changes from the prior period</p>
            </div>
          </SectionHeading>
          <div className="grid gap-3 p-3 sm:grid-cols-2 md:p-4">
            <MetricLane tone="expense">
              <p className="text-sm font-semibold text-text">Increases</p>
              <div className="mt-3 space-y-2">
                {deltas.increases.length ? (
                  deltas.increases.map((item) => (
                    <div key={item.category_id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate text-text">{item.category_name}</span>
                      <span className="amount-text shrink-0 text-semantic-red">
                        +{formatCurrency(item.delta_cents)} €
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted">No increases.</p>
                )}
              </div>
            </MetricLane>
            <MetricLane tone="income">
              <p className="text-sm font-semibold text-text">Decreases</p>
              <div className="mt-3 space-y-2">
                {deltas.decreases.length ? (
                  deltas.decreases.map((item) => (
                    <div key={item.category_id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate text-text">{item.category_name}</span>
                      <span className="amount-text shrink-0 text-semantic-green">
                        {formatCurrency(item.delta_cents)} €
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted">No decreases.</p>
                )}
              </div>
            </MetricLane>
          </div>
        </FinancialPanel>

        <FinancialPanel role="ledger">
          <SectionHeading>
            <div>
              <h2 className="font-head text-lg font-bold">Top tags</h2>
              <p className="mt-0.5 text-xs text-muted">Highest tagged expense totals</p>
            </div>
          </SectionHeading>
          <div className="divide-y divide-border px-4">
            {top_tags.length ? (
              top_tags.map((tag) => (
                <Link
                  key={tag.id}
                  to={`/tags/${tag.id}`}
                  className="flex min-h-12 items-center justify-between gap-3 py-3 text-sm transition-colors hover:text-accent"
                >
                  <span className="font-semibold text-text">{tag.name}</span>
                  <span className="amount-text text-muted">
                    {formatCurrency(tag.amount_cents)} €
                  </span>
                </Link>
              ))
            ) : (
              <p className="py-5 text-sm text-muted">No tags to display.</p>
            )}
          </div>
        </FinancialPanel>
      </div>
        </>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <FinancialPanel role="chart">
            <SectionHeading>
              <div>
                <h2 className="font-head text-lg font-bold">Cash flow</h2>
                <p className="mt-0.5 text-xs text-muted">Income paths into expense categories</p>
              </div>
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-muted">
                <input
                  type="checkbox"
                  className="control-check"
                  checked={groupedFlow}
                  onChange={(event) => setGroupedFlow(event.target.checked)}
                />
                Group by Fixed / Variable / Discretionary
              </label>
            </SectionHeading>
            {flowError ? (
              <p className="p-5 text-sm text-semantic-red">Unable to load flow data.</p>
            ) : (
              <div className="p-4 md:p-5">
                <SankeyChart
                  nodes={flowPayload.nodes}
                  links={flowPayload.links}
                  onCategoryClick={goToCategoryTransactions}
                />
              </div>
            )}
          </FinancialPanel>
          <FinancialPanel role="ledger">
            <SectionHeading>
              <div>
                <h3 className="font-head text-base font-bold">Expense nodes</h3>
                <p className="mt-0.5 text-xs text-muted">Open the underlying ledger</p>
              </div>
            </SectionHeading>
            <div className="grid gap-2 p-3">
              {flowExpenseNodes.length ? (
                flowExpenseNodes.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => {
                      if (node.category_id) {
                        goToCategoryTransactions(node.category_id)
                      }
                    }}
                    className="flex min-h-11 items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-semibold text-text transition-colors hover:bg-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  >
                    <CategoryIcon
                      icon={
                        expenseCategories.find((category) => category.id === node.category_id)
                          ?.icon ?? null
                      }
                      label={node.label}
                    />
                    <span className="truncate">{node.label}</span>
                  </button>
                ))
              ) : (
                <p className="text-sm text-muted">No expense nodes in this period.</p>
              )}
            </div>
          </FinancialPanel>
        </div>
      )}
    </section>
  )
}

export default InsightsPage
