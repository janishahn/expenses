import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link, useSearchParams } from "react-router-dom"
import { apiFetch } from "../app/api"
import { formatCurrency, formatEuroDate } from "../app/format"
import { CategoryIcon } from "../components/CategoryIcon"
import ActiveFilterChips from "../components/ActiveFilterChips"
import TagFilterPicker, { type TagFilterMode } from "../components/TagFilterPicker"
import BarChart from "../components/charts/BarChart"
import LineChart from "../components/charts/LineChart"
import { palette } from "../components/charts/palette"
import WaterfallChart, { type FlowNode } from "../components/charts/WaterfallChart"
import PeriodPicker from "../components/PeriodPicker"
import PageFilterBar from "../components/PageFilterBar"
import PageFilterControl from "../components/PageFilterControl"
import PageScopeHeader from "../components/PageScopeHeader"
import { PageTabPanel, PageTabs } from "../components/PageTabs"
import {
  FinancialPanel,
  MetricLane,
  SectionHeading,
} from "../components/product/ProductSurfaces"
import { AppButton } from "../components/ui/product-button"
import { AppFieldLabel, AppInput, AppNativeSelect } from "../components/ui/product-fields"
import {
  buildCustomPeriodSearchParams,
  buildPresetPeriodSearchParams,
  buildSearchParams,
  type PresetPeriod,
} from "../lib/searchParams"
import { canonicalizeTagScope, serializeTagIds } from "../lib/tagFilters"
import RouteLoading from "../components/RouteLoading"
import RouteError from "../components/RouteError"

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
  filters: {
    tag_id: number | null
    included_tag_ids: number[]
    excluded_tag_ids: number[]
  }
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
  filters: {
    tag_id: number | null
    included_tag_ids: number[]
    excluded_tag_ids: number[]
  }
  nodes: FlowNode[]
  links: Array<{ from: string; to: string; amount_cents: number }>
}

function InsightsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [draftTagMode, setDraftTagMode] = useState<TagFilterMode>("include")
  const [draftTagIds, setDraftTagIds] = useState<number[]>([])
  const [isDesktop, setIsDesktop] = useState(() =>
    window.matchMedia("(min-width: 861px)").matches
  )
  const activeView = searchParams.get("view") === "net" ? "net" : "charts"
  const queryString = useMemo(() => {
    const params = canonicalizeTagScope(searchParams)
    if (!params.get("period")) {
      params.set("period", "all")
    }
    params.delete("type")
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
    refetch: refetchFlow,
  } = useQuery({
    queryKey: ["insights", "flow", queryString],
    queryFn: () => apiFetch<InsightsFlowResponse>(`/api/insights/flow?${queryString}`),
    enabled: activeView === "net",
  })

  const updateParam = (key: string, value: string | null) => {
    setSearchParams(buildSearchParams(searchParams, { [key]: value }))
  }

  const setPresetPeriod = (value: PresetPeriod) =>
    setSearchParams(buildPresetPeriodSearchParams(searchParams, value))

  const applyCustomPeriod = (start: string, end: string) =>
    setSearchParams(buildCustomPeriodSearchParams(searchParams, start, end))
  const setTagFilter = (mode: TagFilterMode, ids: number[]) => {
    setSearchParams(
      buildSearchParams(searchParams, {
        tag: null,
        tags: mode === "include" ? serializeTagIds(ids) : null,
        exclude_tags: mode === "exclude" ? serializeTagIds(ids) : null,
      })
    )
  }
  const setTrendCategory = (value: string) =>
    updateParam("trend_category", value || null)
  const setBudgetMonth = (value: string) =>
    updateParam("budget_month", value || null)
  const setView = (view: "charts" | "net") =>
    setSearchParams(
      buildSearchParams(searchParams, { view: view === "net" ? "net" : null })
    )

  useEffect(() => {
    const media = window.matchMedia("(min-width: 861px)")
    const syncDesktop = () => setIsDesktop(media.matches)
    syncDesktop()
    media.addEventListener("change", syncDesktop)
    return () => media.removeEventListener("change", syncDesktop)
  }, [])

  useEffect(() => {
    const hasContradictoryTagScope =
      searchParams.has("exclude_tags") &&
      (searchParams.has("tag") || searchParams.has("tags"))
    if (!searchParams.has("type") && !hasContradictoryTagScope) return
    const params = canonicalizeTagScope(searchParams)
    params.delete("type")
    setSearchParams(params, { replace: true })
  }, [searchParams, setSearchParams])

  if (isLoading) {
    return <RouteLoading title="Insights" label="Loading insights…" />
  }
  if (error || !data) {
    return <RouteError title="Insights" message="Unable to load insights." />
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
  const tagMode: TagFilterMode = filters.excluded_tag_ids.length ? "exclude" : "include"
  const selectedTagIds =
    tagMode === "exclude" ? filters.excluded_tag_ids : filters.included_tag_ids
  const selectedTags = selectedTagIds.flatMap((id) => {
    const tag = tags.find((item) => item.id === id)
    return tag ? [tag] : []
  })
  const selectedTrendCategory = trend_category_id
    ? expenseCategories.find((category) => category.id === trend_category_id)?.name
    : null
  const trendHasSpend = trend.some((row) => row.amount_cents > 0)
  const trendWindowEndLabel = new Date(`${period.end}T00:00:00`).toLocaleDateString(
    "en-GB",
    { month: "short", year: "numeric" }
  )
  const tagFilterLabel = selectedTagIds.length === 1 && selectedTags[0]
    ? `${tagMode === "include" ? "Only" : "Excluding"}: ${selectedTags[0].name}`
    : `${tagMode === "include" ? "Only" : "Excluding"}: ${selectedTagIds.length} tags`
  const activeFilters = [
    selectedTagIds.length
      ? {
          key: "tags",
          label: tagFilterLabel,
          onRemove: () => setTagFilter(tagMode, []),
        }
      : null,
  ].filter(Boolean) as Array<{
    key: string
    label: string
    onRemove: () => void
  }>
  const incomeColor = "rgb(var(--semantic-green))"
  const expenseColor = "rgb(var(--semantic-red))"
  const trendColor = "rgb(var(--accent))"
  const flowPeriodLabel =
    period.slug === "all"
      ? "All time"
      : `${formatEuroDate(period.start)} → ${formatEuroDate(period.end)}`

  const openFilters = () => {
    setDraftTagMode(tagMode)
    setDraftTagIds(selectedTagIds)
  }

  const clearFilterDraft = () => {
    setDraftTagIds([])
  }

  const clearFilters = () => {
    const params = new URLSearchParams(searchParams)
    params.delete("tag")
    params.delete("tags")
    params.delete("exclude_tags")
    setSearchParams(params)
  }

  const applyFilters = () => {
    const params = new URLSearchParams(searchParams)
    params.delete("tag")
    params.delete("tags")
    params.delete("exclude_tags")
    const serializedTags = serializeTagIds(draftTagIds)
    if (serializedTags) {
      params.set(draftTagMode === "include" ? "tags" : "exclude_tags", serializedTags)
    }
    setSearchParams(params)
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
    const serializedTags = serializeTagIds(selectedTagIds)
    if (serializedTags) {
      params.set(tagMode === "include" ? "tags" : "exclude_tags", serializedTags)
    }
    window.location.assign(`/transactions?${params.toString()}`)
  }

  const filterControl = (
    <PageFilterControl
      title="Insights filters"
      activeCount={activeFilters.length}
      isDesktop={isDesktop}
      onOpen={openFilters}
      onClear={clearFilterDraft}
      onApply={applyFilters}
    >
      <TagFilterPicker
        tags={tags}
        mode={draftTagMode}
        selectedIds={draftTagIds}
        onModeChange={setDraftTagMode}
        onChange={setDraftTagIds}
      />
    </PageFilterControl>
  )

  return (
    <section className="space-y-4 md:space-y-5">
      <PageScopeHeader
        title="Insights"
        titleAccessory={
          isFetching || flowFetching ? <span className="loading-hint">Updating…</span> : null
        }
        titleAccessoryAlign="end"
        controls={
          <PageFilterBar
            period={
              <PeriodPicker
                periodSlug={period.slug}
                start={period.start}
                end={period.end}
                onSetPreset={setPresetPeriod}
                onApplyCustom={applyCustomPeriod}
              />
            }
            filters={filterControl}
          />
        }
      />

      <PageTabs
        value={activeView}
        ariaLabel="Insights views"
        items={[
          { value: "charts", label: "Analysis" },
          { value: "net", label: "Net" },
        ]}
        onValueChange={(value) => setView(value as "charts" | "net")}
        className="space-y-4 md:space-y-5"
      >
        <ActiveFilterChips
          filters={activeFilters}
          onClear={clearFilters}
        />

        <PageTabPanel value="charts" className="space-y-4 md:space-y-5">
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
          <SectionHeading className="flex-wrap items-start">
            <div className="min-w-0">
              <h2 className="truncate font-head text-lg font-bold">
                {selectedTrendCategory
                  ? `Category trend: ${selectedTrendCategory}`
                  : "Category trend"}
              </h2>
              <p className="mt-0.5 text-xs text-muted">
                {selectedTrendCategory
                  ? trendHasSpend
                    ? `${trend.length} months ending ${trendWindowEndLabel}`
                    : `No spend ending ${trendWindowEndLabel}`
                  : "Choose an expense category"}
              </p>
            </div>
            <AppFieldLabel className="w-full shrink-0 sm:w-44">
              <span>Trend category</span>
              <AppNativeSelect
                className="h-10 py-1.5 text-sm"
                value={trend_category_id ?? ""}
                onChange={(event) => setTrendCategory(event.target.value)}
                disabled={expenseCategories.length === 0}
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
            </AppFieldLabel>
          </SectionHeading>
          <div className="flex min-h-[16rem] items-center p-4 md:p-5">
            {selectedTrendCategory && trendHasSpend ? (
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
                {selectedTrendCategory
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
          <SectionHeading className="flex-wrap items-start">
            <div>
              <h2 className="font-head text-lg font-bold">Budget vs actual</h2>
              <p className="mt-0.5 text-xs text-muted">{budget_month}</p>
            </div>
            <AppFieldLabel className="w-full shrink-0 sm:w-40">
              <span>Budget month</span>
              <AppInput
                className="h-10 py-1.5 text-sm"
                type="month"
                value={budget_month}
                onChange={(event) => setBudgetMonth(event.target.value)}
              />
            </AppFieldLabel>
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
        </PageTabPanel>
        <PageTabPanel value="net">
          {flowError ? (
            <div className="flex flex-wrap items-center gap-2 py-5 text-sm text-semantic-red">
              <span>Unable to load income and spending.</span>
              <AppButton type="button" tone="inline" onClick={() => void refetchFlow()}>
                Retry
              </AppButton>
            </div>
          ) : (
            <WaterfallChart
              key={queryString}
              nodes={flowData?.nodes ?? []}
              periodLabel={flowPeriodLabel}
              onCategoryClick={goToCategoryTransactions}
            />
          )}
        </PageTabPanel>
      </PageTabs>
    </section>
  )
}

export default InsightsPage
