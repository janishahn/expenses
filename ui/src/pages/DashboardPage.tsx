import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowDownLeftIcon } from "@phosphor-icons/react/ArrowDownLeft"
import { ArrowUpRightIcon } from "@phosphor-icons/react/ArrowUpRight"
import { CheckIcon } from "@phosphor-icons/react/Check"
import { EyeIcon } from "@phosphor-icons/react/Eye"
import { EyeSlashIcon } from "@phosphor-icons/react/EyeSlash"
import { GaugeIcon } from "@phosphor-icons/react/Gauge"
import { TrendUpIcon } from "@phosphor-icons/react/TrendUp"
import { Link, useLocation, useSearchParams } from "react-router-dom"
import { apiFetch } from "../app/api"
import type { CategorySummary, TransactionListItem } from "../app/api-types"
import { formatCurrency, formatEuroDate } from "../app/format"
import { CategoryIcon } from "../components/CategoryIcon"
import DashboardBalanceChart from "../components/charts/DashboardBalanceChart"
import type { DashboardForecast } from "../components/charts/DashboardBalanceChart"
import DonutChart from "../components/charts/DonutChart"
import type { BreakdownItem } from "../components/charts/DonutChart"
import SpendingBandsChart from "../components/charts/SpendingBandsChart"
import type { SpendingBandMonth } from "../components/charts/SpendingBandsChart"
import PageIntro from "../components/PageIntro"
import PeriodPicker from "../components/PeriodPicker"
import SegmentedControl from "../components/SegmentedControl"
import {
  FinancialPanel,
  MetricLane,
  SectionHeading,
} from "../components/product/ProductSurfaces"
import TransactionDescription from "../components/TransactionDescription"
import {
  buildCustomPeriodSearchParams,
  buildPresetPeriodSearchParams,
  buildSearchParams,
  type PresetPeriod,
} from "../lib/searchParams"

const EMPTY_CATEGORIES: CategorySummary[] = []

type DurablePurchaseItem = {
  id: number
  transaction_id: number
  expected_lifespan_days: number
  acquired_on: string
  days_owned: number
  cost_per_day_cents: number
  amortized_cents: number
  remaining_cents: number
  percent_amortized: number
  fully_amortized: boolean
  paid_for_itself_on: string
  original_amount_cents: number
  title: string | null
  category: CategorySummary | null
}

type DashboardResponse = {
  period: { slug: string; start: string; end: string }
  filters: { type: string | null }
  kpis: { income: number; expenses: number; balance: number }
  sparklines: { income?: string; expenses?: string; balance?: string }
  deltas: { income: number; expenses: number; balance: number } | null
  donut: {
    has_any_transactions: boolean
    mode?: "both" | "expense-only" | "income-only"
    expense_breakdown?: BreakdownItem[]
    income_breakdown?: BreakdownItem[]
  }
  recent: TransactionListItem[]
  categories: CategorySummary[]
  durable_purchases?: DurablePurchaseItem[]
  budget_pace?: {
    velocity_ratio: number
    projected_cents: number
    budget_cents: number
    sparkline: string
  }
  category_budget_summary?: {
    total: number
    needs_attention: number
    priority: {
      scope_category_id: number
      scope_label: string
      amount_cents: number
      spent_cents: number
      remaining_cents: number
      velocity_ratio: number
    }
  }
}

type DurablePurchasesResponse = {
  items: DurablePurchaseItem[]
}

type SpendingBandsResponse = {
  months: SpendingBandMonth[]
}

function DashboardPage() {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const recentListRef = useRef<HTMLDivElement>(null)
  const [showFullyAmortized, setShowFullyAmortized] = useState(false)
  const [isDesktop, setIsDesktop] = useState(() =>
    window.matchMedia("(min-width: 861px)").matches
  )
  const [incognito, setIncognito] = useState(
    () => localStorage.getItem("ew.incognito") === "1",
  )
  const hide = incognito ? "kpi-hidden" : ""
  const returnTo = `${location.pathname}${location.search}`
  const queryString = useMemo(() => {
    const params = new URLSearchParams(searchParams)
    if (!params.get("period")) {
      params.set("period", "this_month")
    }
    return params.toString()
  }, [searchParams])
  const spendingBandsQueryString = useMemo(() => {
    const params = new URLSearchParams({
      view: "monthly",
      period: searchParams.get("period") || "this_month",
    })
    const start = searchParams.get("start")
    const end = searchParams.get("end")
    if (start) params.set("start", start)
    if (end) params.set("end", end)
    return params.toString()
  }, [searchParams])
  const now = new Date()
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-")

  useEffect(() => {
    const media = window.matchMedia("(min-width: 861px)")
    const syncDesktop = () => setIsDesktop(media.matches)
    syncDesktop()
    media.addEventListener("change", syncDesktop)
    return () => media.removeEventListener("change", syncDesktop)
  }, [])

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["dashboard", queryString],
    queryFn: () => apiFetch<DashboardResponse>(`/api/dashboard?${queryString}`),
  })
  const { data: durableData } = useQuery({
    queryKey: ["durable-purchases"],
    queryFn: () => apiFetch<DurablePurchasesResponse>("/api/durable-purchases"),
  })
  const {
    data: forecastData,
    isLoading: forecastLoading,
    isError: forecastUnavailable,
  } = useQuery({
    queryKey: ["forecast", 6, "full"],
    queryFn: () =>
      apiFetch<DashboardForecast>("/api/forecast?horizon=6&mode=full"),
    enabled: isDesktop && Boolean(data && data.period.end >= today),
  })
  const {
    data: spendingBandsData,
    isLoading: spendingBandsLoading,
    isError: spendingBandsUnavailable,
  } = useQuery({
    queryKey: ["dashboard", "spending-bands", spendingBandsQueryString],
    queryFn: () =>
      apiFetch<SpendingBandsResponse>(
        `/api/category-breakdown?${spendingBandsQueryString}`,
      ),
  })

  const categories = data?.categories ?? EMPTY_CATEGORIES

  useLayoutEffect(() => {
    const list = recentListRef.current
    if (!list) return

    const rows = Array.from(
      list.querySelectorAll<HTMLElement>("[data-recent-row]"),
    )
    const updateVisibleRows = () => {
      const listBottom = list.getBoundingClientRect().bottom + 0.5
      for (const row of rows) {
        row.style.visibility =
          getComputedStyle(row).display === "none" ||
          row.getBoundingClientRect().bottom <= listBottom
            ? ""
            : "hidden"
      }
    }
    const resizeObserver = new ResizeObserver(updateVisibleRows)
    resizeObserver.observe(list)
    rows.forEach((row) => resizeObserver.observe(row))
    updateVisibleRows()

    return () => resizeObserver.disconnect()
  }, [data?.recent])

  const categoriesById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  )
  const setPresetPeriod = (value: PresetPeriod) =>
    setSearchParams(buildPresetPeriodSearchParams(searchParams, value))
  const applyCustomPeriod = (start: string, end: string) =>
    setSearchParams(buildCustomPeriodSearchParams(searchParams, start, end))
  const setType = (value: string) =>
    setSearchParams(buildSearchParams(searchParams, { type: value || null }))
  const toggleIncognito = () => {
    setIncognito((previous) => {
      const next = !previous
      localStorage.setItem("ew.incognito", next ? "1" : "0")
      return next
    })
  }

  if (isLoading) {
    return (
      <FinancialPanel className="p-5 text-sm text-muted">
        Loading dashboard…
      </FinancialPanel>
    )
  }
  if (error || !data) {
    return (
      <FinancialPanel className="p-5 text-sm text-semantic-red">
        Unable to load dashboard data.
      </FinancialPanel>
    )
  }

  const { kpis, deltas, donut, recent, period, filters } = data
  const selectedCategoryParam = searchParams.get("category")
  const selectedCategoryId = selectedCategoryParam
    ? Number(selectedCategoryParam)
    : null
  const selectedCategory =
    selectedCategoryId !== null && Number.isFinite(selectedCategoryId)
      ? categories.find((category) => category.id === selectedCategoryId) || null
      : null
  const toggleCategory = (categoryName: string, categoryType: string) => {
    const category = categories.find(
      (item) => item.name === categoryName && item.type === categoryType,
    )
    if (!category) return
    const params = new URLSearchParams(searchParams)
    if (params.get("category") === String(category.id)) {
      params.delete("category")
    } else {
      params.set("category", String(category.id))
    }
    setSearchParams(params)
  }
  const durableItems = durableData ? durableData.items : null
  const activeDurable = durableItems
    ? durableItems.filter((item) => !item.fully_amortized)
    : data.durable_purchases || []
  const fullyAmortized = durableItems
    ? durableItems.filter((item) => item.fully_amortized)
    : []
  const budgetPace = data.budget_pace
  const categoryBudgetSummary = data.category_budget_summary
  const categoryBudgetPriority = categoryBudgetSummary?.priority
  const hasPlanningMetric = Boolean(budgetPace || categoryBudgetSummary)
  const categoryBudgetPriorityDetail = categoryBudgetPriority
    ? categoryBudgetPriority.remaining_cents < 0
      ? `${formatCurrency(Math.abs(categoryBudgetPriority.remaining_cents), false)} € over`
      : `${categoryBudgetPriority.velocity_ratio.toFixed(2).replace(/\.00$/, "")}× pace`
    : ""
  const budgetPaceClass =
    budgetPace && budgetPace.velocity_ratio > 1.1
      ? "text-semantic-red"
      : budgetPace && budgetPace.velocity_ratio < 0.9
        ? "text-semantic-green"
        : "text-muted"
  const secondaryKpis = [
    {
      label: "Cash in",
      value: kpis.income,
      delta: deltas?.income,
      tone: "text-semantic-green",
      laneTone: "income" as const,
      icon: ArrowDownLeftIcon,
    },
    {
      label: "Spent",
      value: kpis.expenses,
      delta: deltas?.expenses,
      tone: "text-semantic-red",
      laneTone: "expense" as const,
      icon: ArrowUpRightIcon,
    },
  ]
  const spendingBandMonths = Array.isArray(spendingBandsData?.months)
    ? spendingBandsData.months
    : []
  const netMovement = kpis.income - kpis.expenses
  const netMovementDelta = deltas
    ? deltas.income - deltas.expenses
    : null
  const forecastStatus =
    period.end < today
      ? "historical"
      : forecastLoading
        ? "loading"
        : forecastUnavailable || !forecastData?.months.length
          ? "unavailable"
          : "ready"

  return (
    <section className="space-y-3 md:space-y-4">
      <div className="grid gap-2.5 desk:grid-cols-[minmax(0,1fr)_auto] desk:items-start">
        <PageIntro
          title="Dashboard"
          actions={isFetching ? <span className="loading-hint">Updating…</span> : null}
        />
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start">
          <PeriodPicker
            periodSlug={period.slug}
            start={period.start}
            end={period.end}
            onSetPreset={setPresetPeriod}
            onApplyCustom={applyCustomPeriod}
          />
          <div className="hidden desk:block">
            <SegmentedControl
              value={filters.type ?? ""}
              ariaLabel="Transaction type"
              className="self-start"
              items={[
                { value: "", label: "All" },
                { value: "income", label: "Income" },
                { value: "expense", label: "Expense" },
              ]}
              onValueChange={setType}
            />
          </div>
        </div>
      </div>

      <FinancialPanel
        role="hero"
        data-testid="dashboard-balance-card"
        className="overflow-hidden"
      >
        <div className="grid min-w-0 desk:grid-cols-[minmax(17rem,0.72fr)_minmax(0,1.28fr)]">
          <div className="p-4 md:p-5 desk:p-6">
            <div className="flex items-center justify-between gap-3">
              <p className="mono-meta flex min-w-0 items-center gap-2 text-muted">
                <span className="h-2 w-2 rounded-[3px] bg-semantic-green" />
                Available position
              </p>
              <button
                type="button"
                onClick={toggleIncognito}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-surface-hi text-muted transition hover:text-text"
                aria-label={incognito ? "Show values" : "Hide values"}
              >
                {incognito ? (
                  <EyeSlashIcon className="h-[1.125rem] w-[1.125rem]" />
                ) : (
                  <EyeIcon className="h-[1.125rem] w-[1.125rem]" />
                )}
              </button>
            </div>
            <p className={`mt-4 whitespace-nowrap font-mono text-[2.15rem] font-medium leading-none tracking-[-0.05em] text-text sm:text-[2.65rem] desk:text-[clamp(2.35rem,4.3vw,3.25rem)] ${hide}`}>
              {formatCurrency(kpis.balance)} €
            </p>

            <div className="mt-4 border-t border-border pt-3 text-xs text-muted">
              {budgetPace ? (
                <p
                  data-testid="dashboard-balance-budget-pace"
                  className="font-mono tabular-nums"
                >
                  <span className="mr-1.5 font-semibold text-text">Budget pace</span>
                  <span className={budgetPaceClass}>
                    {budgetPace.velocity_ratio.toFixed(2).replace(/\.00$/, "")}×
                  </span>
                  <span className="mx-1.5">·</span>
                  {formatCurrency(budgetPace.projected_cents, false)} € projected
                </p>
              ) : null}
            </div>
          </div>

          <div className="hidden min-w-0 border-border desk:block desk:border-l desk:px-6 desk:py-5">
            <DashboardBalanceChart
              actualMonths={spendingBandMonths.flatMap((month) =>
                typeof month.balance_cents === "number"
                  ? [{ month: month.month, balance_cents: month.balance_cents }]
                  : [],
              )}
              currentBalanceCents={kpis.balance}
              forecast={period.end >= today ? forecastData : undefined}
              forecastStatus={forecastStatus}
              incognito={incognito}
            />
          </div>
        </div>
      </FinancialPanel>

      <div
        data-testid="dashboard-metric-grid"
        className={`grid grid-cols-2 gap-2 sm:gap-3 ${hasPlanningMetric ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}
      >
        {secondaryKpis.map((item) => {
          const Icon = item.icon
          return (
            <MetricLane
              key={item.label}
              tone={item.laneTone}
              data-testid="dashboard-secondary-kpi-card"
              className="min-h-[6.75rem] !p-3 sm:min-h-[7.25rem] sm:!p-[1.125rem]"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-sm bg-surface-hi/75">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-xs font-semibold text-muted">{item.label}</span>
              </div>
              <p className={`mt-3 break-words font-mono text-[1.05rem] font-medium tabular-nums sm:text-[1.4rem] ${item.tone} ${hide}`}>
                {formatCurrency(item.value)} €
              </p>
              {item.delta !== undefined && item.delta !== null ? (
                <p className={`mt-1 font-mono text-[11px] tabular-nums text-muted ${hide}`}>
                  {item.delta >= 0 ? "+" : ""}
                  {formatCurrency(item.delta, false)} € vs previous
                </p>
              ) : null}
            </MetricLane>
          )
        })}

        <MetricLane
          tone="plan"
          data-testid="dashboard-net-movement-card"
          className={`${hasPlanningMetric ? "" : "col-span-2 lg:col-span-1"} min-h-[6.75rem] !p-3 sm:min-h-[7.25rem] sm:!p-[1.125rem]`}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-sm bg-surface-hi/75">
              <TrendUpIcon className="h-4 w-4" />
            </span>
            <span className="text-xs font-semibold text-muted">Net movement</span>
          </div>
          <p
            className={`mt-3 break-words font-mono text-[1.05rem] font-medium tabular-nums sm:text-[1.4rem] ${netMovement >= 0 ? "text-semantic-green" : "text-semantic-red"} ${hide}`}
          >
            {netMovement >= 0 ? "+" : ""}
            {formatCurrency(netMovement)} €
          </p>
          {netMovementDelta !== null ? (
            <p className={`mt-1 font-mono text-[11px] tabular-nums text-muted ${hide}`}>
              {netMovementDelta >= 0 ? "+" : ""}
              {formatCurrency(netMovementDelta, false)} € vs previous
            </p>
          ) : null}
        </MetricLane>

        {budgetPace ? (
          <MetricLane
            tone="warning"
            data-testid="dashboard-planning-card"
            className="min-h-[6.75rem] !p-3 sm:min-h-[7.25rem] sm:!p-[1.125rem]"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-sm bg-surface-hi/75">
                <GaugeIcon className="h-4 w-4" />
              </span>
              <span className="text-xs font-semibold text-muted">Plan pace</span>
            </div>
            <p className="mt-3 break-words font-mono text-[1.05rem] font-medium tabular-nums text-text sm:text-[1.4rem]">
              {budgetPace.velocity_ratio.toFixed(2).replace(/\.00$/, "")}× pace
            </p>
            <p className="mt-1 font-mono text-[11px] tabular-nums text-muted">
              {formatCurrency(budgetPace.projected_cents, false)} € projected ·{" "}
              {formatCurrency(budgetPace.budget_cents, false)} € planned
            </p>
          </MetricLane>
        ) : categoryBudgetSummary && categoryBudgetPriority ? (
          <Link
            to="/budgets"
            aria-label="Open category budgets"
            className="block min-w-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <MetricLane
              tone={categoryBudgetSummary.needs_attention > 0 ? "warning" : "plan"}
              data-testid="dashboard-planning-card"
              className="h-full min-h-[6.75rem] !p-3 sm:min-h-[7.25rem] sm:!p-[1.125rem]"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-sm bg-surface-hi/75">
                  <GaugeIcon className="h-4 w-4" />
                </span>
                <span className="text-xs font-semibold text-muted">Category budgets</span>
              </div>
              <p
                className={`mt-3 truncate font-mono text-[1.05rem] font-medium tabular-nums sm:text-[1.4rem] ${categoryBudgetSummary.needs_attention > 0 ? "text-semantic-red" : "text-semantic-green"}`}
              >
                {categoryBudgetSummary.needs_attention > 0
                  ? `${categoryBudgetSummary.needs_attention} at risk`
                  : `${categoryBudgetSummary.total} on track`}
              </p>
              <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
                <span className="truncate font-semibold text-text">
                  {categoryBudgetPriority.scope_label}
                </span>
                <span aria-hidden="true">·</span>
                <span className="shrink-0 font-mono tabular-nums">
                  {categoryBudgetPriorityDetail}
                </span>
              </p>
            </MetricLane>
          </Link>
        ) : null}
      </div>

      <div className="grid min-w-0 gap-3 desk:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] desk:auto-rows-[22rem]">
        <FinancialPanel role="ledger" className="flex min-h-0 flex-col">
          <SectionHeading className="px-4 py-3.5 md:px-[1.125rem]">
            <h2 className="font-head text-base font-bold text-text md:text-lg">
              Recent transactions
            </h2>
            <Link
              to={{ pathname: "/transactions", search: queryString }}
              state={{ returnTo }}
              className="text-xs font-semibold text-primary hover:underline"
            >
              View all
            </Link>
          </SectionHeading>
          {recent.length ? (
            <div
              ref={recentListRef}
              data-testid="dashboard-recent-list"
              className="min-h-0 flex-1 overflow-hidden px-4"
            >
              {recent.map((transaction, index) => {
                const isExpense = transaction.type === "expense"
                const amount = isExpense
                  ? transaction.net_amount_cents
                  : transaction.amount_cents
                const category = transaction.category
                  ? (categoriesById.get(transaction.category.id) ?? transaction.category)
                  : null
                return (
                  <Link
                    key={transaction.id}
                    data-recent-row={transaction.id}
                    to={`/transactions/${transaction.id}`}
                    state={{ returnTo }}
                    className={`${index < 4 ? "flex" : "hidden desk:flex"} min-w-0 items-center gap-3 border-b border-border/80 py-2.5 transition-colors last:border-b-0 hover:bg-faint/45 focus-visible:bg-faint/55`}
                  >
                    <CategoryIcon
                      icon={category?.icon ?? null}
                      label={category?.name ?? (isExpense ? "Expense" : "Income")}
                    />
                    <div className="min-w-0 flex-1 basis-0 overflow-hidden">
                      <p className="mobile-list-title-clamp text-sm font-semibold text-text">
                        {transaction.title || category?.name || "Untitled"}
                      </p>
                      {transaction.description ? (
                        <TransactionDescription
                          markdown={transaction.description}
                          compact
                          clamp
                          className="mt-0.5"
                        />
                      ) : null}
                      <p className="truncate text-xs text-muted">
                        {category?.name ?? "Uncategorized"} · {formatEuroDate(transaction.date)}
                      </p>
                    </div>
                    <p className={`shrink-0 font-mono text-sm font-semibold tabular-nums ${isExpense ? "text-semantic-red" : "text-semantic-green"}`}>
                      {isExpense ? "−" : "+"}
                      {formatCurrency(amount)} €
                    </p>
                  </Link>
                )
              })}
            </div>
          ) : (
            <div className="flex flex-1 items-center px-5 py-6 text-sm text-muted">
              No transactions yet for this period.
            </div>
          )}
        </FinancialPanel>

        <SpendingBandsChart
          months={spendingBandMonths}
          incognito={incognito}
          returnTo={returnTo}
          loading={spendingBandsLoading}
          unavailable={
            spendingBandsUnavailable ||
            (spendingBandsData !== undefined &&
              !Array.isArray(spendingBandsData.months))
          }
        />
      </div>

      {donut.has_any_transactions ? (
        <div className={`grid gap-3 ${donut.mode === "both" ? "lg:grid-cols-2" : "lg:grid-cols-1"}`}>
          {(donut.mode === "both" || donut.mode === "expense-only") && (
            <DonutChart
              title="Expenses"
              breakdown={donut.expense_breakdown ?? []}
              emptyMessage="No expenses in this period"
              selectedCategoryName={
                selectedCategory?.type === "expense" ? selectedCategory.name : null
              }
              onToggleCategory={(categoryName) =>
                toggleCategory(categoryName, "expense")
              }
            />
          )}
          {(donut.mode === "both" || donut.mode === "income-only") && (
            <DonutChart
              title="Income"
              breakdown={donut.income_breakdown ?? []}
              emptyMessage="No income in this period"
              selectedCategoryName={
                selectedCategory?.type === "income" ? selectedCategory.name : null
              }
              onToggleCategory={(categoryName) =>
                toggleCategory(categoryName, "income")
              }
            />
          )}
        </div>
      ) : (
        <FinancialPanel className="p-6 text-center">
          <p className="font-head text-lg font-bold text-text">No transactions yet</p>
          <p className="mt-1 text-sm text-muted">
            Add transactions to see category breakdowns.
          </p>
        </FinancialPanel>
      )}

      {(activeDurable.length > 0 || fullyAmortized.length > 0) && (
        <FinancialPanel className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-head text-lg font-bold">Durable purchases</h2>
            <span className="chip text-xs">{activeDurable.length}</span>
          </div>

          {activeDurable.length > 0 && (
            <div className="grid gap-3 md:grid-cols-2">
              {activeDurable.map((item) => (
                <div key={item.id} className="rounded-lg bg-surface-hi/60 p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <CategoryIcon
                        icon={item.category ? item.category.icon ?? "package" : null}
                        label={item.category?.name}
                      />
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-text">
                          {item.title || item.category?.name || "Durable purchase"}
                        </p>
                        <p className={`font-mono text-xs text-muted ${hide}`}>
                          {formatCurrency(item.original_amount_cents)} €
                        </p>
                      </div>
                    </div>
                    <p className={`shrink-0 font-mono text-sm font-semibold text-text ${hide}`}>
                      {(item.cost_per_day_cents / 100).toFixed(2)} €/day
                    </p>
                  </div>
                  <div className="mt-3 h-[5px] rounded-full bg-faint">
                    <div
                      className="h-[5px] rounded-full bg-primary"
                      style={{
                        width: `${Math.max(0, Math.min(100, item.percent_amortized))}%`,
                      }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    {item.days_owned} days · {Math.round(item.percent_amortized)}% amortized
                  </p>
                </div>
              ))}
            </div>
          )}

          {fullyAmortized.length > 0 && (
            <div className="mt-4 border-t border-border pt-4">
              <button
                type="button"
                onClick={() => setShowFullyAmortized((previous) => !previous)}
                className="text-xs font-semibold text-muted"
              >
                Fully amortized ({fullyAmortized.length})
              </button>
              {showFullyAmortized && (
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {fullyAmortized.map((item) => (
                    <div key={item.id} className="rounded-lg bg-surface-hi/60 p-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <CategoryIcon
                            icon={item.category ? item.category.icon ?? "package" : null}
                            label={item.category?.name}
                          />
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-text">
                              {item.title || item.category?.name || "Durable purchase"}
                            </p>
                            <p className="text-xs text-muted">
                              Paid for itself on {formatEuroDate(item.paid_for_itself_on)}
                            </p>
                          </div>
                        </div>
                        <p className="inline-flex items-center gap-1 font-mono text-sm font-semibold text-muted">
                          <CheckIcon className="h-3.5 w-3.5" />
                          0.00 €/day
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </FinancialPanel>
      )}
    </section>
  )
}

export default DashboardPage
