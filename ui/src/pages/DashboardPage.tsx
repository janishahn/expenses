import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { CheckIcon } from "@phosphor-icons/react/Check"
import { EyeIcon } from "@phosphor-icons/react/Eye"
import { EyeSlashIcon } from "@phosphor-icons/react/EyeSlash"
import { Link, useLocation, useOutletContext, useSearchParams } from "react-router-dom"
import { apiFetch } from "../app/api"
import type { AppShellOutletContext } from "../app/AppShell"
import type { CategorySummary, TransactionListItem } from "../app/api-types"
import { formatCurrency, formatEuroDate } from "../app/format"
import { CategoryIcon } from "../components/CategoryIcon"
import DonutChart from "../components/charts/DonutChart"
import type { BreakdownItem } from "../components/charts/DonutChart"
import PageIntro from "../components/PageIntro"
import PageIntroAddButton from "../components/PageIntroAddButton"
import PeriodPicker from "../components/PeriodPicker"
import TransactionDescription from "../components/TransactionDescription"
import { AppCard } from "../components/ui/product-card"
import {
  buildCustomPeriodSearchParams,
  buildPresetPeriodSearchParams,
  buildSearchParams,
  type PresetPeriod,
} from "../lib/searchParams"

const EMPTY_CATEGORIES: CategorySummary[] = []

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
  durable_purchases?: Array<{
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
  }>
  budget_pace?: {
    velocity_ratio: number
    projected_cents: number
    budget_cents: number
    sparkline: string
  }
}

type DurablePurchasesResponse = {
  items: Array<{
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
  }>
}

function DashboardPage() {
  const location = useLocation()
  const { openAddTransaction } = useOutletContext<AppShellOutletContext>()
  const [searchParams, setSearchParams] = useSearchParams()
  const [showFullyAmortized, setShowFullyAmortized] = useState(false)
  const [incognito, setIncognito] = useState(
    () => localStorage.getItem("ew.incognito") === "1",
  )
  const toggleIncognito = () => {
    setIncognito((prev) => {
      const next = !prev
      localStorage.setItem("ew.incognito", next ? "1" : "0")
      return next
    })
  }
  const hide = incognito ? "kpi-hidden" : ""
  const returnTo = `${location.pathname}${location.search}`
  const queryString = useMemo(() => {
    const params = new URLSearchParams(searchParams)
    if (!params.get("period")) {
      params.set("period", "this_month")
    }
    return params.toString()
  }, [searchParams])

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["dashboard", queryString],
    queryFn: () => apiFetch<DashboardResponse>(`/api/dashboard?${queryString}`),
  })
  const { data: durableData } = useQuery({
    queryKey: ["durable-purchases"],
    queryFn: () => apiFetch<DurablePurchasesResponse>("/api/durable-purchases"),
  })

  const categories = data?.categories ?? EMPTY_CATEGORIES
  const categoriesById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  )
  const expenseIconMap = useMemo(
    () =>
      Object.fromEntries(
        categories
          .filter((category) => category.type === "expense")
          .map((category) => [category.name, category.icon]),
      ),
    [categories],
  )
  const incomeIconMap = useMemo(
    () =>
      Object.fromEntries(
        categories
          .filter((category) => category.type === "income")
          .map((category) => [category.name, category.icon]),
      ),
    [categories],
  )

  const setPresetPeriod = (value: PresetPeriod) =>
    setSearchParams(buildPresetPeriodSearchParams(searchParams, value))

  const applyCustomPeriod = (start: string, end: string) =>
    setSearchParams(buildCustomPeriodSearchParams(searchParams, start, end))

  const setType = (value: string) =>
    setSearchParams(buildSearchParams(searchParams, { type: value || null }))

  if (isLoading) {
    return <div className="text-muted">Loading dashboard…</div>
  }
  if (error || !data) {
    return (
      <div className="text-semantic-red">Unable to load dashboard data.</div>
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
      (item) => item.name === categoryName && item.type === categoryType
    )
    if (!category) {
      return
    }
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
  const budgetPaceClass =
    budgetPace && budgetPace.velocity_ratio > 1.1
      ? "text-semantic-red"
      : budgetPace && budgetPace.velocity_ratio < 0.9
        ? "text-semantic-green"
        : "text-muted"
  const balanceTone =
    kpis.balance >= 0 ? "text-semantic-green" : "text-semantic-red"
  const secondaryKpis = [
    {
      label: "Income",
      value: kpis.income,
      delta: deltas?.income,
      tone: "text-semantic-green",
    },
    {
      label: "Expenses",
      value: kpis.expenses,
      delta: deltas?.expenses,
      tone: "text-semantic-red",
    },
  ]

  return (
    <section className="space-y-5 md:space-y-6 desk:space-y-4">
      <PageIntro
        title="Dashboard"
        actions={
          <>
            {isFetching ? <span className="loading-hint">Updating…</span> : null}
            <PageIntroAddButton onClick={openAddTransaction} />
          </>
        }
      />

      <PeriodPicker
        periodSlug={period.slug}
        start={period.start}
        end={period.end}
        onSetPreset={setPresetPeriod}
        onApplyCustom={applyCustomPeriod}
      />

      <div className="space-y-2.5 md:space-y-3 desk:grid desk:grid-cols-[minmax(0,1.45fr)_minmax(0,0.9fr)_minmax(0,0.9fr)] desk:gap-3 desk:space-y-0">
        <AppCard
          data-testid="dashboard-balance-card"
          className="relative overflow-hidden p-4 md:p-5 desk:h-full desk:p-5"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted md:text-xs">
                Balance
              </p>
              <p className={`mt-1 font-mono tabular-nums font-semibold ${balanceTone} ${hide}`}>
                <span className="text-[1.8rem] leading-none md:hidden">
                  {formatCurrency(kpis.balance, false)} €
                </span>
                <span className="hidden text-[2.15rem] leading-none md:inline">
                  {formatCurrency(kpis.balance)} €
                </span>
              </p>
            </div>
            <button
              type="button"
              onClick={toggleIncognito}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/80 bg-surface-hi/80 text-muted shadow-[0_16px_30px_-24px_rgba(0,0,0,0.82)] transition hover:border-border-hi hover:text-text"
              aria-label={incognito ? "Show values" : "Hide values"}
            >
              {incognito ? <EyeSlashIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
            </button>
          </div>

          {(deltas?.balance !== undefined && deltas.balance !== null) || budgetPace ? (
            <div className={`mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border/70 pt-3 text-[11px] text-muted desk:gap-x-3 ${hide}`}>
              {deltas?.balance !== undefined && deltas.balance !== null ? (
                <p
                  data-testid="dashboard-balance-delta"
                  className="font-mono tabular-nums"
                >
                  {deltas.balance >= 0 ? "+" : ""}
                  {formatCurrency(deltas.balance)} € vs prev
                </p>
              ) : null}
              {budgetPace ? (
                <p
                  data-testid="dashboard-balance-budget-pace"
                  className="font-mono tabular-nums"
                >
                  <span className="mr-1 font-semibold uppercase tracking-[0.08em] text-muted">
                    Budget pace
                  </span>
                  <span className={budgetPaceClass}>
                    {budgetPace.velocity_ratio.toFixed(2).replace(/\.00$/, "")}x
                  </span>
                  <span className="mx-1.5 text-muted">·</span>
                  {formatCurrency(budgetPace.projected_cents, false)} € of{" "}
                  {formatCurrency(budgetPace.budget_cents, false)} €
                </p>
              ) : null}
            </div>
          ) : null}
        </AppCard>

        <div className="grid grid-cols-2 gap-2.5 md:gap-3 desk:contents">
          {secondaryKpis.map((item) => (
            <AppCard
              key={item.label}
              data-testid="dashboard-secondary-kpi-card"
              className="relative overflow-hidden h-full min-h-[76px] p-3.5 md:p-4 desk:p-4"
            >
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted md:text-xs">
                  {item.label}
                </p>
                <p className={`mt-1 whitespace-nowrap font-mono tabular-nums font-semibold ${item.tone} ${hide}`}>
                  <span className="text-[1.45rem] leading-tight md:hidden">
                    {formatCurrency(item.value, false)} €
                  </span>
                  <span className="hidden text-2xl md:inline">
                    {formatCurrency(item.value)} €
                  </span>
                </p>
              </div>
              {item.delta !== undefined && item.delta !== null && (
                <p className={`mt-2 text-[10px] font-mono tabular-nums text-muted md:text-[11px] ${hide}`}>
                  {item.delta >= 0 ? "+" : ""}
                  {formatCurrency(item.delta, false)} € vs prev
                </p>
              )}
            </AppCard>
          ))}
        </div>
      </div>

      <div className="pill-group">
        {["", "income", "expense"].map((value) => (
          <button
            key={value || "all"}
            type="button"
            onClick={() => setType(value)}
            className={`pill-button ${
              (filters.type ?? "") === value
                ? "pill-button-active"
                : ""
            }`}
          >
            {value ? value[0].toUpperCase() + value.slice(1) : "All"}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:gap-5 lg:grid-cols-[1.1fr_0.9fr] lg:gap-6">
        <AppCard className="p-4 md:p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-head text-lg font-bold text-text">Recent transactions</h2>
          </div>
          <div className="mt-3 md:mt-4">
          {recent.length ? (
              <div className="surface-list-shell">
                <div className="divide-y divide-border/80">
                  {recent.map((txn) => {
                    const isExpense = txn.type === "expense"
                    const amount = isExpense
                      ? txn.net_amount_cents
                      : txn.amount_cents
                    const category = txn.category
                      ? (categoriesById.get(txn.category.id) ?? txn.category)
                      : null
                    return (
                      <Link
                        key={txn.id}
                        to={`/transactions/${txn.id}`}
                        state={{ returnTo }}
                        className="flex min-w-0 items-center gap-3 px-3 py-3 transition-colors hover:bg-faint/65 focus-visible:bg-faint/70"
                      >
                        <CategoryIcon icon={category?.icon ?? null} />
                        <div className="min-w-0 flex-1 basis-0 overflow-hidden">
                          <p className="mobile-list-title-clamp text-sm font-semibold text-text">
                            {txn.title || category?.name || "Untitled"}
                          </p>
                          <TransactionDescription
                            markdown={txn.description}
                            compact
                            clamp
                            className="mt-1"
                          />
                          <p className="text-xs text-muted">
                            {category?.name ?? "Uncategorized"}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p
                            className={`font-mono text-sm font-semibold tabular-nums ${
                              isExpense ? "text-semantic-red" : "text-semantic-green"
                            }`}
                          >
                            {isExpense ? "-" : "+"}
                            {formatCurrency(amount)} €
                          </p>
                          <p className="text-xs text-muted">
                            {formatEuroDate(txn.date)}
                          </p>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className="surface-list-shell px-3 py-4 text-sm text-muted">
                No transactions yet for this period.
              </div>
            )}
          </div>
        </AppCard>

        <div className="space-y-4">
          {donut.has_any_transactions ? (
            <div className="space-y-6">
              {donut.mode === "both" && (
                <div className="grid gap-6">
                  <DonutChart
                    title="Expenses"
                    breakdown={donut.expense_breakdown ?? []}
                    emptyMessage="No expenses in this period"
                    iconMap={expenseIconMap}
                    selectedCategoryName={
                      selectedCategory?.type === "expense"
                        ? selectedCategory.name
                        : null
                    }
                    onToggleCategory={(categoryName) =>
                      toggleCategory(categoryName, "expense")
                    }
                  />
                  <DonutChart
                    title="Income"
                    breakdown={donut.income_breakdown ?? []}
                    emptyMessage="No income in this period"
                    iconMap={incomeIconMap}
                    selectedCategoryName={
                      selectedCategory?.type === "income"
                        ? selectedCategory.name
                        : null
                    }
                    onToggleCategory={(categoryName) =>
                      toggleCategory(categoryName, "income")
                    }
                  />
                </div>
              )}
              {donut.mode === "expense-only" && (
                <DonutChart
                  title="Expenses"
                  breakdown={donut.expense_breakdown ?? []}
                  emptyMessage="No expenses in this period"
                  iconMap={expenseIconMap}
                  selectedCategoryName={
                    selectedCategory?.type === "expense"
                      ? selectedCategory.name
                      : null
                  }
                  onToggleCategory={(categoryName) =>
                    toggleCategory(categoryName, "expense")
                  }
                />
              )}
              {donut.mode === "income-only" && (
                <DonutChart
                  title="Income"
                  breakdown={donut.income_breakdown ?? []}
                  emptyMessage="No income in this period"
                  iconMap={incomeIconMap}
                  selectedCategoryName={
                    selectedCategory?.type === "income"
                      ? selectedCategory.name
                      : null
                  }
                  onToggleCategory={(categoryName) =>
                    toggleCategory(categoryName, "income")
                  }
                />
              )}
            </div>
          ) : (
            <AppCard className="p-6 text-center">
              <p className="font-head text-lg font-bold text-text">
                No transactions yet
              </p>
              <p className="text-sm text-muted">
                Add transactions to see category breakdowns.
              </p>
            </AppCard>
          )}
        </div>
      </div>

      {(activeDurable.length > 0 || fullyAmortized.length > 0) && (
        <AppCard className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-head text-lg font-bold">Durable purchases</h2>
            <span className="chip text-xs">
              {activeDurable.length}
            </span>
          </div>

          {activeDurable.length > 0 && (
            <div className="space-y-3">
              {activeDurable.map((item) => (
                <div
                  key={item.id}
                  className="rounded-[1.25rem] border border-border bg-surface-hi/55 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <CategoryIcon icon={item.category?.icon ?? null} />
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-text">
                          {item.title || item.category?.name || "Durable purchase"}
                        </p>
                        <p className="text-xs font-mono text-muted">
                          {formatCurrency(item.original_amount_cents)} €
                        </p>
                      </div>
                    </div>
                    <p className="shrink-0 font-mono text-sm font-semibold text-text">
                      {(item.cost_per_day_cents / 100).toFixed(2)} €/day
                    </p>
                  </div>
                  <div className="mt-3 h-[5px] rounded-full bg-faint">
                    <div
                      className="h-[5px] rounded-full bg-accent"
                      style={{ width: `${Math.max(0, Math.min(100, item.percent_amortized))}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    {item.days_owned} days · {Math.round(item.percent_amortized)}%
                    {" "}
                    amortized
                  </p>
                </div>
              ))}
            </div>
          )}

          {fullyAmortized.length > 0 && (
            <div className="mt-4 border-t border-border pt-4">
              <button
                type="button"
                onClick={() => setShowFullyAmortized((prev) => !prev)}
                className="text-xs font-semibold uppercase tracking-wide text-muted"
              >
                Fully amortized ({fullyAmortized.length})
              </button>
              {showFullyAmortized && (
                <div className="mt-3 space-y-2">
                  {fullyAmortized.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-[1.25rem] border border-border bg-surface-hi/55 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <CategoryIcon icon={item.category?.icon ?? null} />
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-text">
                              {item.title || item.category?.name || "Durable purchase"}
                            </p>
                            <p className="text-xs text-muted">
                              Paid for itself on{" "}
                              {formatEuroDate(item.paid_for_itself_on)}
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
        </AppCard>
      )}

    </section>
  )
}

export default DashboardPage
