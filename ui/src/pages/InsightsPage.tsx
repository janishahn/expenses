import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { XIcon } from "@phosphor-icons/react/X"
import { Link, useOutletContext, useSearchParams } from "react-router-dom"
import type { AppShellOutletContext } from "../app/AppShell"
import { apiFetch } from "../app/api"
import { formatCurrency, formatEuroDate } from "../app/format"
import { CategoryIcon } from "../components/CategoryIcon"
import PageIntroAddButton from "../components/PageIntroAddButton"
import BarChart from "../components/charts/BarChart"
import { readThemeColor } from "../components/charts/chartSetup"
import LineChart from "../components/charts/LineChart"
import { palette } from "../components/charts/palette"
import PageIntro from "../components/PageIntro"
import PeriodPicker from "../components/PeriodPicker"
import SankeyChart from "../components/charts/SankeyChart"
import { AppButton } from "../components/ui/product-button"
import { AppCard } from "../components/ui/product-card"
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
  const { openAddTransaction } = useOutletContext<AppShellOutletContext>()
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
    <section className="space-y-6">
      <PageIntro
        title="Insights"
        actions={
          <>
            {isFetching || flowFetching ? <span className="loading-hint">Updating…</span> : null}
            <PageIntroAddButton onClick={openAddTransaction} />
          </>
        }
      />

      <div className="ptabs">
        <button
          type="button"
          onClick={() => setView("charts")}
          className={`ptab ${activeView === "charts" ? "ptab-active" : ""}`}
        >
          Charts
        </button>
        <button
          type="button"
          onClick={() => setView("flow")}
          className={`ptab ${activeView === "flow" ? "ptab-active" : ""}`}
        >
          Flow
        </button>
      </div>

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

      <AppCard className="hidden gap-4 p-4 desk:grid desk:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <AppFieldLabel>
          <span>Type</span>
          <div className="pill-group self-start">
            {[
              { value: "", label: "All" },
              { value: "expense", label: "Expense" },
              { value: "income", label: "Income" },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => setType(item.value)}
                className={`pill-button ${
                  (filters.type ?? "") === item.value ? "pill-button-active" : ""
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
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
      </AppCard>

      {mobileFiltersOpen && !isDesktop ? (
        <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
          <SheetContent side="bottom" className="max-h-[88vh]" aria-label="Insights filters">
            <SheetHeader className="flex-row items-center justify-between gap-3 px-5 pt-5 pb-0">
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
                <div className="pill-group self-start">
                  {[
                    { value: "", label: "All" },
                    { value: "expense", label: "Expense" },
                    { value: "income", label: "Income" },
                  ].map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => setMobileType(item.value)}
                      className={`pill-button ${
                        mobileType === item.value ? "pill-button-active" : ""
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
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

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <AppCard className="p-5">
          <h2 className="font-head text-lg font-bold">Monthly income vs expenses</h2>
          <p className="text-xs text-muted">
            Last {series.length} months (net after reimbursements).
          </p>
          <div className="mt-4">
            <LineChart
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
        </AppCard>

        <AppCard className="p-5">
          <h2 className="font-head text-lg font-bold">
            {!trendDisabled && selectedTrendCategory
              ? `Category trend: ${selectedTrendCategory}`
              : "Category trend"}
          </h2>
          <p className="text-xs text-muted">
            {trendDisabled
              ? "Category trend is available for expenses only. Switch Type to All or Expense."
              : selectedTrendCategory
              ? trendHasSpend
                ? `Net spend after reimbursements, monthly, last ${trend.length} months ending ${trendWindowEndLabel}.`
                : `No spending in this category during the last ${trend.length} months ending ${trendWindowEndLabel}.`
              : "Create an expense category to track net spend."}
          </p>
          {!trendDisabled && selectedTrendCategory && trendHasSpend ? (
            <div className="mt-4">
              <BarChart
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
          ) : null}
        </AppCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <AppCard className="p-5">
          <h2 className="font-head text-lg font-bold">Top categories</h2>
          <div className="mt-4 space-y-5">
            <div>
              <p className="text-sm font-semibold text-muted">Expenses</p>
              {expense_breakdown.length ? (
                <div className="mt-3 space-y-3">
                  {expense_breakdown.map((row, index) => (
                    <div key={row.name} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 text-text">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: palette[index % palette.length] }} />
                          <CategoryIcon icon={expenseIconMap[row.name] ?? null} />
                          {row.name}
                        </span>
                        <span className="font-mono text-semantic-red">
                          {formatCurrency(row.amount_cents)} €
                        </span>
                      </div>
                      <div className="h-[5px] rounded-full bg-faint">
                        <div
                          className="h-[5px] rounded-full bg-semantic-red"
                          style={{ width: `${row.percent}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted">
                  No expenses in this period.
                </p>
              )}
            </div>
            <div>
              <p className="text-sm font-semibold text-muted">Income</p>
              {income_breakdown.length ? (
                <div className="mt-3 space-y-3">
                  {income_breakdown.map((row, index) => (
                    <div key={row.name} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 text-text">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: palette[index % palette.length] }} />
                          <CategoryIcon icon={incomeIconMap[row.name] ?? null} />
                          {row.name}
                        </span>
                        <span className="font-mono text-semantic-green">
                          {formatCurrency(row.amount_cents)} €
                        </span>
                      </div>
                      <div className="h-[5px] rounded-full bg-faint">
                        <div
                          className="h-[5px] rounded-full bg-semantic-green"
                          style={{ width: `${row.percent}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted">
                  No income in this period.
                </p>
              )}
            </div>
          </div>
        </AppCard>

        <AppCard className="p-5">
          <h2 className="font-head text-lg font-bold">Budget vs actual</h2>
          <p className="text-xs text-muted">Month: {budget_month}</p>
          <div className="mt-4 space-y-4">
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
                return (
                  <div
                    key={`${row.scope_label}-${row.source_id}`}
                    className="surface-card-soft p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-semibold text-text">
                          {row.scope_label}
                        </p>
                        <p className="text-xs text-muted">
                          {row.source} budget {formatCurrency(row.amount_cents)} €
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-xs text-muted">
                          Spent {formatCurrency(spent)} €
                        </p>
                        <p
                          className={`font-mono text-sm font-semibold ${
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
              <p className="text-sm text-muted">No budgets set.</p>
            )}
          </div>
        </AppCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <AppCard className="p-5">
          <h2 className="font-head text-lg font-bold">Biggest deltas</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase text-muted">
                Increases
              </p>
              <div className="mt-3 space-y-2">
                {deltas.increases.length ? (
                  deltas.increases.map((item) => (
                    <div
                      key={item.category_id}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-text">
                        {item.category_name}
                      </span>
                      <span className="font-mono text-semantic-red">
                        +{formatCurrency(item.delta_cents)} €
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted">No increases.</p>
                )}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-muted">
                Decreases
              </p>
              <div className="mt-3 space-y-2">
                {deltas.decreases.length ? (
                  deltas.decreases.map((item) => (
                    <div
                      key={item.category_id}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-text">
                        {item.category_name}
                      </span>
                      <span className="font-mono text-semantic-green">
                        {formatCurrency(item.delta_cents)} €
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted">No decreases.</p>
                )}
              </div>
            </div>
          </div>
        </AppCard>

        <AppCard className="p-5">
          <h2 className="font-head text-lg font-bold">Top tags</h2>
          <div className="mt-4 space-y-3">
            {top_tags.length ? (
              top_tags.map((tag) => (
                <div
                  key={tag.id}
                  className="surface-card-soft flex items-center justify-between px-4 py-2"
                >
                  <Link
                    to={`/tags/${tag.id}`}
                    className="text-sm font-semibold text-text"
                  >
                    {tag.name}
                  </Link>
                  <span className="font-mono text-sm text-muted">
                    {formatCurrency(tag.amount_cents)} €
                  </span>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted">No tags to display.</p>
            )}
          </div>
        </AppCard>
      </div>
        </>
      ) : (
        <div className="space-y-4">
          <AppCard className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-head text-lg font-bold">Cash flow</h2>
                <p className="text-xs text-muted">{summary}</p>
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
            </div>
            {flowError ? (
              <p className="mt-3 text-sm text-semantic-red">Unable to load flow data.</p>
            ) : (
              <div className="mt-4">
                <SankeyChart
                  nodes={flowPayload.nodes}
                  links={flowPayload.links}
                  onCategoryClick={goToCategoryTransactions}
                />
              </div>
            )}
          </AppCard>
          <AppCard className="p-4">
            <h3 className="font-head text-base font-bold">Expense nodes</h3>
            <p className="text-xs text-muted">Click a category to open filtered transactions.</p>
            <div className="mt-3 flex flex-wrap gap-2">
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
                    className="btn-ghost px-3 py-1 text-xs"
                  >
                    {node.label}
                  </button>
                ))
              ) : (
                <p className="text-sm text-muted">No expense nodes in this period.</p>
              )}
            </div>
          </AppCard>
        </div>
      )}
    </section>
  )
}

export default InsightsPage
