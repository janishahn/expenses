import { useMemo, useRef, useState } from "react"
import { TrashIcon } from "@phosphor-icons/react/Trash"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useOutletContext, useSearchParams } from "react-router-dom"
import type { AppShellOutletContext } from "../app/AppShell"
import { apiFetch } from "../app/api"
import { formatCurrency, formatEuroDate } from "../app/format"
import { CategoryIcon } from "../components/CategoryIcon"
import BudgetBurndownChart from "../components/charts/BudgetBurndownChart"
import PageIntroAddButton from "../components/PageIntroAddButton"
import PageIntro from "../components/PageIntro"
import { AppButton } from "../components/ui/product-button"
import { AppCard } from "../components/ui/product-card"
import {
  AppFieldLabel,
  AppInput,
  AppNativeSelect,
} from "../components/ui/product-fields"
import { buildSearchParams } from "../lib/searchParams"

type BudgetRow = {
  scope_category_id: number | null
  scope_label: string
  amount_cents: number
  source: string
  source_id: number
}

type BudgetProgressRow = {
  scope_category_id: number | null
  spent_cents: number
  remaining_cents: number
  velocity_ratio: number
  daily_remaining_cents: number
  projected_total_cents: number
  days_elapsed: number
  days_remaining: number
}

type BudgetTemplateRow = {
  id: number
  frequency: string
  category: { id: number; name: string } | null
  amount_cents: number
  starts_on: string
  ends_on: string | null
}

type BudgetYearRow = {
  scope_category_id: number | null
  scope_label: string
  amount_cents: number
  source: string
  source_id: number
}

type BudgetYearSpentRow = {
  scope_category_id: number | null
  spent_cents: number
}

type BudgetResponse = {
  view: "month" | "templates" | "year"
  year: number
  month: number
  month_value: string
  budgets: BudgetRow[]
  progress: BudgetProgressRow[]
  categories: Array<{
    id: number
    name: string
    type: string
    icon: string | null
    archived_at: string | null
  }>
  templates: BudgetTemplateRow[]
  year_value: number
  yearly_budgets: BudgetYearRow[]
  yearly_spent: BudgetYearSpentRow[]
  default_month_template_start: string
  default_year_template_start: string
}

type BurndownResponse = {
  budget_amount_cents: number
  days_in_month: number
  daily_series: Array<{ day: number; cumulative_cents: number }>
  compare_month: string | null
  compare_daily_series: Array<{ day: number; cumulative_cents: number }>
  top_spending_days: Array<{
    day: number
    date?: string
    total_cents: number
    transactions: Array<{ id: number; title: string; amount_cents: number }>
  }>
}

function getPreviousMonth(monthValue: string): string {
  const [yearRaw, monthRaw] = monthValue.split("-")
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return monthValue
  }
  const previous = new Date(year, month - 2, 1)
  return `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, "0")}`
}

function formatBudgetMonth(monthValue: string): string {
  const value = new Date(`${monthValue}-01T00:00:00`)
  if (Number.isNaN(value.getTime())) {
    return monthValue
  }
  return value.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  })
}

function paceLabel(progress: BudgetProgressRow, amountCents: number): {
  text: string
  tone: string
  badgeTone: string
} {
  const ratio = progress.velocity_ratio
  if (ratio > 1.1) {
    return {
      text: `Over pace - projected ${formatCurrency(progress.projected_total_cents)} € (budget ${formatCurrency(amountCents)} €)`,
      tone: "text-semantic-red",
      badgeTone: "text-semantic-red",
    }
  }
  if (ratio < 0.9) {
    return {
      text: `On track - ${formatCurrency(progress.daily_remaining_cents)} €/day remaining`,
      tone: "text-semantic-green",
      badgeTone: "text-semantic-green",
    }
  }
  return {
    text: `On pace - ${formatCurrency(progress.daily_remaining_cents)} €/day remaining`,
    tone: "text-muted",
    badgeTone: "text-muted",
  }
}

function BudgetBurndownPanel({
  monthValue,
  scopeCategoryId,
  compareEnabled,
}: {
  monthValue: string
  scopeCategoryId: number | null
  compareEnabled: boolean
}) {
  const scope = scopeCategoryId === null ? "overall" : String(scopeCategoryId)
  const compareMonth = getPreviousMonth(monthValue)
  const queryString = compareEnabled
    ? `month=${monthValue}&scope=${scope}&compare_month=${compareMonth}`
    : `month=${monthValue}&scope=${scope}`

  const { data, isLoading, error } = useQuery({
    queryKey: ["budgets", "burndown", monthValue, scope, compareEnabled],
    queryFn: () => apiFetch<BurndownResponse>(`/api/budgets/burndown?${queryString}`),
  })

  if (isLoading) {
    return <p className="text-xs text-muted">Loading chart…</p>
  }
  if (error || !data) {
    return <p className="text-xs text-semantic-red">Unable to load chart.</p>
  }

  const [yearRaw, monthRaw] = monthValue.split("-")
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const dayToIsoDate = (day: number): string | null => {
    if (!Number.isFinite(year) || !Number.isFinite(month)) {
      return null
    }
    const isoMonth = String(month).padStart(2, "0")
    const isoDay = String(day).padStart(2, "0")
    return `${yearRaw}-${isoMonth}-${isoDay}`
  }

  const dailySpend = data.daily_series.map((row, index) =>
    index === 0 ? row.cumulative_cents : row.cumulative_cents - data.daily_series[index - 1].cumulative_cents
  )
  const positiveDays = dailySpend
    .map((value, index) => ({
      day: index + 1,
      amount_cents: value,
      date: dayToIsoDate(index + 1),
    }))
    .filter((row) => row.amount_cents > 0)
  const bestDay = positiveDays.length
    ? positiveDays.reduce((winner, row) => (row.amount_cents < winner.amount_cents ? row : winner))
    : null
  const worstDay = positiveDays.length
    ? positiveDays.reduce((winner, row) => (row.amount_cents > winner.amount_cents ? row : winner))
    : null

  const latestCumulative =
    data.daily_series.length > 0
      ? data.daily_series[data.daily_series.length - 1].cumulative_cents
      : 0
  const now = new Date()
  let daysElapsed = data.days_in_month
  if (Number.isFinite(year) && Number.isFinite(month)) {
    if (now.getFullYear() === year && now.getMonth() + 1 === month) {
      daysElapsed = now.getDate()
    } else if (now.getFullYear() < year || (now.getFullYear() === year && now.getMonth() + 1 < month)) {
      daysElapsed = 0
    }
  }
  const daysRemaining = Math.max(0, data.days_in_month - daysElapsed)
  const dailyAllowance =
    daysRemaining > 0
      ? Math.round((data.budget_amount_cents - latestCumulative) / daysRemaining)
      : data.budget_amount_cents - latestCumulative
  const projectedFinish =
    daysElapsed > 0
      ? Math.round(
          latestCumulative
            + (latestCumulative / daysElapsed) * (data.days_in_month - daysElapsed)
        )
      : latestCumulative

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-border bg-bg p-3">
      <BudgetBurndownChart
        monthValue={monthValue}
        daysInMonth={data.days_in_month}
        budgetAmountCents={data.budget_amount_cents}
        dailySeries={data.daily_series}
        compareDailySeries={compareEnabled ? data.compare_daily_series : []}
      />
      <div className="grid gap-2 sm:grid-cols-3 sm:gap-3">
        <div className="min-w-0 rounded-md border border-border bg-surface px-2 py-1.5">
          <p className="text-[11px] uppercase text-muted">Daily allowance</p>
          <p className={`font-mono text-sm font-semibold ${dailyAllowance >= 0 ? "text-semantic-green" : "text-semantic-red"}`}>
            {formatCurrency(dailyAllowance)} €/day
          </p>
        </div>
        <div className="min-w-0 rounded-md border border-border bg-surface px-2 py-1.5">
          <p className="text-[11px] uppercase text-muted">Projected finish</p>
          <p
            className={`font-mono text-sm font-semibold ${
              projectedFinish > data.budget_amount_cents ? "text-semantic-red" : "text-semantic-green"
            }`}
          >
            {formatCurrency(projectedFinish)} €
          </p>
        </div>
        <div className="min-w-0 rounded-md border border-border bg-surface px-2 py-1.5">
          <p className="text-[11px] uppercase text-muted">Best / Worst day</p>
          <p className="break-all font-mono text-xs font-semibold text-text">
            Best{" "}
            {bestDay
              ? `${bestDay.date ? formatEuroDate(bestDay.date) : `Day ${bestDay.day}`} (${formatCurrency(bestDay.amount_cents)} €)`
              : "-"}
          </p>
          <p className="break-all font-mono text-xs font-semibold text-text">
            Worst{" "}
            {worstDay
              ? `${worstDay.date ? formatEuroDate(worstDay.date) : `Day ${worstDay.day}`} (${formatCurrency(worstDay.amount_cents)} €)`
              : "-"}
          </p>
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Top spending days</p>
        {data.top_spending_days.length ? (
          data.top_spending_days.map((day) => (
            <div key={day.day} className="min-w-0 rounded-md border border-border bg-surface px-3 py-2">
              <div className="flex min-w-0 items-center justify-between gap-3 text-xs text-muted">
                <span>
                  {day.date ? formatEuroDate(day.date) : `Day ${day.day}`}
                </span>
                <span className="font-mono text-semantic-red">{formatCurrency(day.total_cents)} €</span>
              </div>
              <div className="mt-1.5 space-y-1">
                {day.transactions.map((txn) => (
                  <div key={txn.id} className="flex min-w-0 items-center justify-between gap-3 overflow-hidden text-xs">
                    <span className="block min-w-0 flex-1 truncate text-text">{txn.title || "Untitled"}</span>
                    <span className="shrink-0 font-mono text-semantic-red">{formatCurrency(txn.amount_cents)} €</span>
                  </div>
                ))}
              </div>
            </div>
          ))
        ) : (
          <p className="text-xs text-muted">No spending days yet for this scope.</p>
        )}
      </div>
    </div>
  )
}

function BudgetsPage() {
  const { openAddTransaction } = useOutletContext<AppShellOutletContext>()
  const templateFormRef = useRef<HTMLFormElement | null>(null)
  const templateAmountInputRef = useRef<HTMLInputElement | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const [overrideCategory, setOverrideCategory] = useState("")
  const [overrideAmount, setOverrideAmount] = useState("")
  const [overrideError, setOverrideError] = useState("")

  const [templateFrequency, setTemplateFrequency] = useState("monthly")
  const [templateStartsOn, setTemplateStartsOn] = useState("")
  const [templateEndsOn, setTemplateEndsOn] = useState("")
  const [templateCategory, setTemplateCategory] = useState("")
  const [templateAmount, setTemplateAmount] = useState("")
  const [templateError, setTemplateError] = useState("")

  const [yearInput, setYearInput] = useState("")
  const [expandedCharts, setExpandedCharts] = useState<Record<string, boolean>>({})
  const [compareMonth, setCompareMonth] = useState<Record<string, boolean>>({})

  const queryString = useMemo(() => {
    const params = new URLSearchParams(searchParams)
    if (!params.get("view")) {
      params.set("view", "month")
    }
    return params.toString()
  }, [searchParams])

  const { data, isLoading, error } = useQuery({
    queryKey: ["budgets", queryString],
    queryFn: () => apiFetch<BudgetResponse>(`/api/budgets?${queryString}`),
  })

  const overrideMutation = useMutation({
    mutationFn: (payload: {
      year: number
      month: number
      category_id: number | null
      amount_cents: number
    }) =>
      apiFetch("/api/budgets/overrides", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      setOverrideAmount("")
      queryClient.invalidateQueries({ queryKey: ["budgets"] })
    },
  })

  const deleteOverrideMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/budgets/overrides/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budgets"] })
    },
  })

  const templateMutation = useMutation({
    mutationFn: (payload: {
      frequency: string
      category_id: number | null
      amount_cents: number
      starts_on: string
      ends_on: string | null
    }) =>
      apiFetch("/api/budgets/templates", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      setTemplateAmount("")
      setTemplateEndsOn("")
      queryClient.invalidateQueries({ queryKey: ["budgets"] })
    },
  })

  const deleteTemplateMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/budgets/templates/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budgets"] })
    },
  })

  const setView = (view: string) =>
    setSearchParams(buildSearchParams(searchParams, { view }))

  const jumpToTemplateForm = () => {
    requestAnimationFrame(() => {
      templateFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      templateAmountInputRef.current?.focus()
    })
  }

  const setMonthFilter = (value: string) =>
    setSearchParams(buildSearchParams(searchParams, { view: "month", month: value }))

  const setYearFilter = (value: string) =>
    setSearchParams(buildSearchParams(searchParams, { view: "year", year: value }))

  const parseAmount = (raw: string) => {
    const normalized = raw.replace(/\s/g, "").replace(",", ".")
    const value = Number(normalized)
    if (!Number.isFinite(value) || value < 0) {
      return null
    }
    return Math.round(value * 100)
  }

  if (isLoading) {
    return <div className="text-muted">Loading budgets…</div>
  }
  if (error || !data) {
    return <div className="text-semantic-red">Unable to load budgets.</div>
  }

  const handleOverrideSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setOverrideError("")
    const amount = parseAmount(overrideAmount)
    if (!amount && amount !== 0) {
      setOverrideError("Enter a valid amount.")
      return
    }
    const [yearStr, monthStr] = data.month_value.split("-")
    const year = Number(yearStr)
    const month = Number(monthStr)
    overrideMutation.mutate({
      year,
      month,
      category_id: overrideCategory ? Number(overrideCategory) : null,
      amount_cents: amount,
    })
  }

  const handleTemplateSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setTemplateError("")
    const amount = parseAmount(templateAmount)
    if (!amount && amount !== 0) {
      setTemplateError("Enter a valid amount.")
      return
    }
    const resolvedTemplateStartsOn =
      templateStartsOn ||
      (templateFrequency === "yearly"
        ? data.default_year_template_start
        : data.default_month_template_start)
    if (!resolvedTemplateStartsOn) {
      setTemplateError("Pick a start date.")
      return
    }
    templateMutation.mutate({
      frequency: templateFrequency,
      category_id: templateCategory ? Number(templateCategory) : null,
      amount_cents: amount,
      starts_on: resolvedTemplateStartsOn,
      ends_on: templateEndsOn || null,
    })
  }

  const resolvedYearInput = yearInput || String(data.year_value)
  const resolvedTemplateStartsOn =
    templateStartsOn ||
    (templateFrequency === "yearly"
      ? data.default_year_template_start
      : data.default_month_template_start)

  const expenseCategories = data.categories.filter(
    (category) => category.type === "expense" && !category.archived_at
  )

  const progressMap = new Map(
    data.progress.map((row) => [String(row.scope_category_id ?? "null"), row])
  )
  const yearlySpentMap = new Map(
    data.yearly_spent.map((row) => [String(row.scope_category_id ?? "null"), row])
  )
  const catIconMap = Object.fromEntries(data.categories.map(c => [c.id, c.icon]))
  const selectedMonthLabel = formatBudgetMonth(data.month_value)

  return (
    <section className="space-y-6">
      <PageIntro
        title="Budgets"
        actions={
          <>
            {data.view === "templates" ? (
              <AppButton
                type="button"
                onClick={jumpToTemplateForm}
                className="desk:hidden"
              >
                Add recurring budget
              </AppButton>
            ) : null}
            <PageIntroAddButton onClick={openAddTransaction} />
          </>
        }
      />

      <div className="ptabs">
        {[
          { value: "month", label: "Month" },
          { value: "templates", label: "Recurring" },
          { value: "year", label: "Year" },
        ].map((view) => (
          <button
            key={view.value}
            type="button"
            onClick={() => setView(view.value)}
            className={`ptab ${data.view === view.value ? "ptab-active" : ""}`}
          >
            {view.label}
          </button>
        ))}
      </div>

      {data.view === "month" && (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
          <AppCard className="order-2 lg:order-none">
            <form onSubmit={handleOverrideSubmit} className="editor-rail">
              <div className="surface-section-header">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-head text-lg font-bold">Set month budget</h2>
                  <span className="rounded-full border border-border px-3 py-1 text-xs text-muted">
                    {selectedMonthLabel}
                  </span>
                </div>
              </div>
              <div className="surface-section-body space-y-4">
                <AppFieldLabel>
                  Category
                  <AppNativeSelect
                  value={overrideCategory}
                  onChange={(event) => setOverrideCategory(event.target.value)}
                  className="mt-1"
                >
                  <option value="">All expense categories</option>
                  {expenseCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                  </AppNativeSelect>
                </AppFieldLabel>
                <AppFieldLabel>
                  Amount
                  <AppInput
                  value={overrideAmount}
                  onChange={(event) => setOverrideAmount(event.target.value)}
                  placeholder="e.g. 500.00"
                  inputMode="decimal"
                  className="mt-1"
                  required
                />
                </AppFieldLabel>
                {overrideError && (
                  <p className="text-xs text-semantic-red">{overrideError}</p>
                )}
                <AppButton
                  type="submit"
                  className="w-full"
                  disabled={overrideMutation.isPending}
                >
                  {overrideMutation.isPending ? "Saving…" : "Save month budget"}
                </AppButton>
              </div>
            </form>
          </AppCard>

          <div className="order-1 min-w-0 space-y-4 lg:order-none lg:col-span-2">
            <AppCard>
              <div className="flex flex-col gap-3 border-b border-border px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="font-head text-lg font-bold">
                    {selectedMonthLabel} budgets
                  </h2>
                  <span className="rounded-full border border-border px-3 py-1 text-xs text-muted">
                    {data.budgets.length} total
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <AppInput
                    type="month"
                    value={data.month_value}
                    onChange={(event) => setMonthFilter(event.target.value)}
                    className="field-sm w-[11rem] min-w-0"
                    aria-label="Month"
                  />
                  <AppButton
                    type="button"
                    onClick={() => setView("templates")}
                    tone="ghost"
                    className="px-3 py-2 text-xs"
                  >
                    Manage recurring budgets
                  </AppButton>
                </div>
              </div>
              <div className="space-y-3 px-4 py-4">
                {data.budgets.length ? (
                  data.budgets.map((row) => {
                    const scopeKey = String(row.scope_category_id ?? "null")
                    const progress = progressMap.get(
                      scopeKey
                    )
                    const spent = progress?.spent_cents ?? 0
                    const remaining =
                      progress?.remaining_cents ?? row.amount_cents - spent
                    const over = remaining < 0
                    const pct = row.amount_cents
                      ? Math.min(100, (spent / row.amount_cents) * 100)
                      : 0
                    const pacing = progress
                      ? paceLabel(progress, row.amount_cents)
                      : {
                          text: "On pace - 0 €/day remaining",
                          tone: "text-muted",
                          badgeTone: "text-muted",
                        }
                    const velocityRatio = progress?.velocity_ratio ?? 0
                    const chartOpen = expandedCharts[scopeKey] ?? false
                    const compareEnabled = compareMonth[scopeKey] ?? false
                    return (
                      <div
                        key={`${row.scope_label}-${row.source_id}`}
                        className="rounded-lg border border-border bg-bg p-4"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-center gap-2">
                            <CategoryIcon
                              icon={
                                row.scope_category_id === null
                                  ? null
                                  : (catIconMap[row.scope_category_id] ?? null)
                              }
                            />
                            <div>
                              <p className="font-semibold text-text">
                                {row.scope_label}
                              </p>
                              <p className="text-xs text-muted">
                                <span className="chip">
                                  {row.source === "override"
                                    ? "Month"
                                    : row.source === "template"
                                      ? "Recurring"
                                      : row.source}
                                </span>{" "}
                                Budget {formatCurrency(row.amount_cents)} €
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-mono text-xs text-semantic-red">
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
                        <div className="mt-2 flex flex-col items-start gap-1.5 sm:flex-row sm:items-center sm:justify-between">
                          <p className={`min-w-0 break-words text-xs font-mono ${pacing.tone}`}>
                            {pacing.text}
                          </p>
                          <span className={`chip font-mono ${pacing.badgeTone}`}>
                            {velocityRatio.toFixed(2).replace(/\.00$/, "")}x
                          </span>
                        </div>
                        <div className="mt-2 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <AppButton
                            type="button"
                            onClick={() =>
                              setExpandedCharts((current) => ({
                                ...current,
                                [scopeKey]: !chartOpen,
                              }))
                            }
                            tone="ghost"
                            className="px-2 py-1 text-xs"
                          >
                            {chartOpen ? "Hide chart" : "Show chart"}
                          </AppButton>
                          {chartOpen ? (
                            <label className="inline-flex items-center gap-1 text-xs text-muted">
                              <input
                                type="checkbox"
                                checked={compareEnabled}
                                onChange={(event) =>
                                  setCompareMonth((current) => ({
                                    ...current,
                                    [scopeKey]: event.target.checked,
                                  }))
                                }
                                className="control-check"
                              />
                              <span className="leading-tight">Compare previous month</span>
                            </label>
                          ) : null}
                        </div>
                        {chartOpen ? (
                          <BudgetBurndownPanel
                            monthValue={data.month_value}
                            scopeCategoryId={row.scope_category_id}
                            compareEnabled={compareEnabled}
                          />
                        ) : null}
                        {row.source === "override" && (
                          <div className="mt-3 flex justify-end">
                            <AppButton
                              type="button"
                              onClick={() =>
                                deleteOverrideMutation.mutate(row.source_id)
                              }
                              tone="inlineDanger"
                            >
                              <TrashIcon className="h-3.5 w-3.5" />
                              Remove month budget
                            </AppButton>
                          </div>
                        )}
                      </div>
                    )
                  })
                ) : (
                  <div className="py-6 text-center">
                    <p className="font-head text-lg font-bold text-text">
                      No budgets for {selectedMonthLabel}
                    </p>
                    <p className="text-sm text-muted">
                      Set a month budget or open recurring budgets.
                    </p>
                    <AppButton
                      type="button"
                      onClick={() => setView("templates")}
                      tone="ghost"
                      className="mt-3 px-4 py-2 text-xs"
                    >
                      Manage recurring budgets
                    </AppButton>
                  </div>
                )}
              </div>
            </AppCard>
          </div>
        </div>
      )}

      {data.view === "templates" && (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
          <AppCard className="order-2 lg:order-none">
            <form
              ref={templateFormRef}
              onSubmit={handleTemplateSubmit}
              className="editor-rail"
            >
              <div className="surface-section-header">
                <h2 className="font-head text-lg font-bold">New recurring budget</h2>
              </div>
              <div className="surface-section-body space-y-4">
                <AppFieldLabel>
                  Frequency
                  <AppNativeSelect
                  value={templateFrequency}
                  onChange={(event) => setTemplateFrequency(event.target.value)}
                  className="mt-1"
                >
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                  </AppNativeSelect>
                </AppFieldLabel>
                <AppFieldLabel>
                  Starts on
                  <AppInput
                  type="date"
                  value={resolvedTemplateStartsOn}
                  onChange={(event) => setTemplateStartsOn(event.target.value)}
                  className="mt-1"
                  required
                />
                </AppFieldLabel>
                <AppFieldLabel>
                  Ends on (optional)
                  <AppInput
                  type="date"
                  value={templateEndsOn}
                  onChange={(event) => setTemplateEndsOn(event.target.value)}
                  className="mt-1"
                />
                </AppFieldLabel>
                <AppFieldLabel>
                  Category
                  <AppNativeSelect
                  value={templateCategory}
                  onChange={(event) => setTemplateCategory(event.target.value)}
                  className="mt-1"
                >
                  <option value="">All expense categories</option>
                  {expenseCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                  </AppNativeSelect>
                </AppFieldLabel>
                <AppFieldLabel>
                  Amount
                  <AppInput
                  ref={templateAmountInputRef}
                  value={templateAmount}
                  onChange={(event) => setTemplateAmount(event.target.value)}
                  placeholder="e.g. 500.00"
                  inputMode="decimal"
                  className="mt-1"
                  required
                />
                </AppFieldLabel>
                {templateError && (
                  <p className="text-xs text-semantic-red">{templateError}</p>
                )}
                <AppButton
                  type="submit"
                  className="w-full"
                  disabled={templateMutation.isPending}
                >
                  {templateMutation.isPending ? "Saving…" : "Save recurring budget"}
                </AppButton>
              </div>
            </form>
          </AppCard>

          <div className="order-1 min-w-0 space-y-4 lg:order-none lg:col-span-2">
            <AppCard>
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h2 className="font-head text-lg font-bold">Recurring budgets</h2>
                <span className="rounded-full border border-border px-3 py-1 text-xs text-muted">
                  {data.templates.length} total
                </span>
              </div>
              <div className="space-y-3 px-4 py-4">
                {data.templates.length ? (
                  data.templates.map((tmpl) => (
                    <div
                      key={tmpl.id}
                      className="rounded-lg border border-border bg-bg p-4"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-semibold text-text">
                            {tmpl.category?.name ?? "All expense categories"}
                          </p>
                          <p className="text-xs text-muted">
                            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted">
                              {tmpl.frequency}
                            </span>{" "}
                            From {formatEuroDate(tmpl.starts_on)}
                            {tmpl.ends_on
                              ? ` to ${formatEuroDate(tmpl.ends_on)}`
                              : ""}
                          </p>
                        </div>
                        <p className="font-mono text-sm font-semibold text-text">
                          {formatCurrency(tmpl.amount_cents)} €
                        </p>
                      </div>
                      <div className="mt-3 flex justify-end">
                        <AppButton
                          type="button"
                          onClick={() => deleteTemplateMutation.mutate(tmpl.id)}
                          tone="inlineDanger"
                        >
                          <TrashIcon className="h-3.5 w-3.5" />
                          Delete
                        </AppButton>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted">No recurring budgets yet.</p>
                )}
              </div>
            </AppCard>
          </div>
        </div>
      )}

      {data.view === "year" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <AppFieldLabel>
              Year
              <AppInput
                type="number"
                min={1970}
                max={3000}
                value={resolvedYearInput}
                onChange={(event) => setYearInput(event.target.value)}
                className="mt-1 field-sm"
              />
            </AppFieldLabel>
            <AppButton
              type="button"
              onClick={() => setYearFilter(resolvedYearInput)}
              tone="ghost"
              className="px-4 py-2 text-xs"
            >
              Go
            </AppButton>
          </div>

          <AppCard>
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <p className="text-xs font-semibold uppercase text-muted">
                  Yearly
                </p>
                <h2 className="font-head text-lg font-bold">
                  {data.year_value} budgets
                </h2>
              </div>
              <AppButton
                type="button"
                onClick={() => setView("templates")}
                tone="ghost"
                className="px-3 py-2 text-xs"
              >
                Manage recurring budgets
              </AppButton>
            </div>
            <div className="space-y-3 px-4 py-4">
              {data.yearly_budgets.length ? (
                data.yearly_budgets.map((row) => {
                  const spent =
                    yearlySpentMap.get(String(row.scope_category_id ?? "null"))
                      ?.spent_cents ?? 0
                  const remaining = row.amount_cents - spent
                  const over = remaining < 0
                  const pct = row.amount_cents
                    ? Math.min(100, (spent / row.amount_cents) * 100)
                    : 0
                  return (
                    <div
                      key={`${row.scope_label}-${row.source_id}`}
                      className="rounded-lg border border-border bg-bg p-4"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-2">
                          <CategoryIcon
                            icon={
                              row.scope_category_id === null
                                ? null
                                : (catIconMap[row.scope_category_id] ?? null)
                            }
                          />
                          <div>
                            <p className="font-semibold text-text">
                              {row.scope_label}
                            </p>
                            <p className="text-xs text-muted">
                              <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted">
                                Yearly
                              </span>{" "}
                              Budget {formatCurrency(row.amount_cents)} €
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-mono text-xs text-semantic-red">
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
                <AppCard className="p-6 text-center">
                  <p className="font-head text-lg font-bold text-text">
                    No yearly budgets yet
                  </p>
                  <p className="text-sm text-muted">
                    Add yearly recurring budgets in Recurring.
                  </p>
                  <AppButton
                    type="button"
                    onClick={() => setView("templates")}
                    tone="ghost"
                    className="mt-3 px-4 py-2 text-xs"
                  >
                    Open recurring budgets
                  </AppButton>
                </AppCard>
              )}
            </div>
          </AppCard>
        </div>
      )}
    </section>
  )
}

export default BudgetsPage
