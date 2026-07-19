import { useCallback, useEffect, useMemo, useState } from "react"
import { GaugeIcon } from "@phosphor-icons/react/Gauge"
import { PiggyBankIcon } from "@phosphor-icons/react/PiggyBank"
import { ReceiptIcon } from "@phosphor-icons/react/Receipt"
import { TargetIcon } from "@phosphor-icons/react/Target"
import { TrashIcon } from "@phosphor-icons/react/Trash"
import { XIcon } from "@phosphor-icons/react/X"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useOutletContext, useSearchParams } from "react-router-dom"
import { apiFetch } from "../app/api"
import type { AppShellOutletContext } from "../app/AppShell"
import { formatCurrency, formatEuroDate } from "../app/format"
import { CategoryIcon } from "../components/CategoryIcon"
import BudgetBurndownChart from "../components/charts/BudgetBurndownChart"
import PageIntro from "../components/PageIntro"
import SegmentedControl from "../components/SegmentedControl"
import {
  FinancialPanel,
  MetricLane,
  SectionHeading,
  WorkspaceToolbar,
} from "../components/product/ProductSurfaces"
import { AppButton } from "../components/ui/product-button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog"
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
    <div className="mt-4 space-y-4 rounded-[1rem] bg-surface p-3.5 shadow-[var(--shadow-soft)] sm:p-4">
      <BudgetBurndownChart
        monthValue={monthValue}
        daysInMonth={data.days_in_month}
        budgetAmountCents={data.budget_amount_cents}
        dailySeries={data.daily_series}
        compareDailySeries={compareEnabled ? data.compare_daily_series : []}
      />
      <div className="grid gap-2.5 sm:grid-cols-3">
        <div className="min-w-0 rounded-[0.875rem] bg-faint/75 p-3">
          <p className="text-xs font-semibold text-muted">Daily allowance</p>
          <p className={`mt-1 break-words font-mono text-sm font-semibold ${dailyAllowance >= 0 ? "text-semantic-green" : "text-semantic-red"}`}>
            {formatCurrency(dailyAllowance)} €/day
          </p>
        </div>
        <div className="min-w-0 rounded-[0.875rem] bg-faint/75 p-3">
          <p className="text-xs font-semibold text-muted">Projected finish</p>
          <p
            className={`mt-1 break-words font-mono text-sm font-semibold ${
              projectedFinish > data.budget_amount_cents ? "text-semantic-red" : "text-semantic-green"
            }`}
          >
            {formatCurrency(projectedFinish)} €
          </p>
        </div>
        <div className="min-w-0 rounded-[0.875rem] bg-faint/75 p-3">
          <p className="text-xs font-semibold text-muted">Best / worst day</p>
          <p className="mt-1 break-words font-mono text-xs font-semibold text-text">
            Best{" "}
            {bestDay
              ? `${bestDay.date ? formatEuroDate(bestDay.date) : `Day ${bestDay.day}`} (${formatCurrency(bestDay.amount_cents)} €)`
              : "-"}
          </p>
          <p className="break-words font-mono text-xs font-semibold text-text">
            Worst{" "}
            {worstDay
              ? `${worstDay.date ? formatEuroDate(worstDay.date) : `Day ${worstDay.day}`} (${formatCurrency(worstDay.amount_cents)} €)`
              : "-"}
          </p>
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold text-muted">Top spending days</p>
        {data.top_spending_days.length ? (
          <div className="mt-2 divide-y divide-border/70 overflow-hidden rounded-[0.875rem] bg-faint/70 px-3">
            {data.top_spending_days.map((day) => (
            <div key={day.day} className="min-w-0 py-3">
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
            ))}
          </div>
        ) : (
          <p className="mt-2 rounded-[0.875rem] bg-faint/70 px-3 py-3 text-xs text-muted">
            No spending days yet for this scope.
          </p>
        )}
      </div>
    </div>
  )
}

function BudgetsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const { setUtilityAction } = useOutletContext<AppShellOutletContext>()
  const [editorOpen, setEditorOpen] = useState(false)
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

  const openBudgetEditor = useCallback(() => {
    setOverrideError("")
    setTemplateError("")
    if (data?.view === "month") {
      setOverrideCategory("")
      setOverrideAmount("")
    } else {
      setTemplateFrequency(data?.view === "year" ? "yearly" : "monthly")
      setTemplateStartsOn("")
      setTemplateEndsOn("")
      setTemplateCategory("")
      setTemplateAmount("")
    }
    setEditorOpen(true)
  }, [data?.view])

  useEffect(() => {
    setUtilityAction({ label: "Add budget", onClick: openBudgetEditor })
    return () => setUtilityAction(null)
  }, [openBudgetEditor, setUtilityAction])

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
      setEditorOpen(false)
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
      setEditorOpen(false)
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

  const setView = (view: string) => {
    setEditorOpen(false)
    setSearchParams(buildSearchParams(searchParams, { view }))
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

  const overallMonthBudget = data.budgets.find(
    (row) => row.scope_category_id === null
  )
  const categoryMonthBudgets = data.budgets.filter(
    (row) => row.scope_category_id !== null
  )
  const overallMonthProgress = progressMap.get("null")
  const monthlyAllocation =
    overallMonthBudget?.amount_cents ??
    categoryMonthBudgets.reduce((total, row) => total + row.amount_cents, 0)
  const monthlySpent =
    overallMonthProgress?.spent_cents ??
    categoryMonthBudgets.reduce(
      (total, row) =>
        total +
        (progressMap.get(String(row.scope_category_id))?.spent_cents ?? 0),
      0
    )
  const monthlyRemaining =
    overallMonthProgress?.remaining_cents ?? monthlyAllocation - monthlySpent
  const monthlyProjected =
    overallMonthProgress?.projected_total_cents ??
    categoryMonthBudgets.reduce(
      (total, row) =>
        total +
        (progressMap.get(String(row.scope_category_id))
          ?.projected_total_cents ?? 0),
      0
    )
  const monthlyUsedPercent = monthlyAllocation
    ? Math.round((monthlySpent / monthlyAllocation) * 100)
    : 0
  const monthlyPaceRatio = monthlyAllocation
    ? monthlyProjected / monthlyAllocation
    : 0
  const monthlyPaceNotStarted =
    monthlyAllocation > 0 &&
    data.progress.length > 0 &&
    data.progress.every((row) => row.days_elapsed === 0)
  const monthlyPaceStatus =
    monthlyAllocation === 0
      ? "No plan yet"
      : monthlyPaceNotStarted
        ? "Not started"
      : monthlyPaceRatio > 1.1
        ? "Over pace"
        : monthlyPaceRatio < 0.9
          ? "Under pace"
          : "On pace"

  const overallYearBudget = data.yearly_budgets.find(
    (row) => row.scope_category_id === null
  )
  const categoryYearBudgets = data.yearly_budgets.filter(
    (row) => row.scope_category_id !== null
  )
  const yearlyAllocation =
    overallYearBudget?.amount_cents ??
    categoryYearBudgets.reduce((total, row) => total + row.amount_cents, 0)
  const yearlySpent =
    yearlySpentMap.get("null")?.spent_cents ??
    categoryYearBudgets.reduce(
      (total, row) =>
        total +
        (yearlySpentMap.get(String(row.scope_category_id))?.spent_cents ?? 0),
      0
    )
  const yearlyRemaining = yearlyAllocation - yearlySpent
  const yearlyUsedPercent = yearlyAllocation
    ? Math.round((yearlySpent / yearlyAllocation) * 100)
    : 0

  return (
    <section className="space-y-4 md:space-y-5">
      <PageIntro title="Budgets" />

      <WorkspaceToolbar
        data-testid="budget-workspace-toolbar"
        className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <SegmentedControl
          value={data.view}
          ariaLabel="Budget view"
          className="w-full sm:w-72"
          equalWidth
          items={[
            { value: "month", label: "Month" },
            { value: "templates", label: "Recurring" },
            { value: "year", label: "Year" },
          ]}
          onValueChange={setView}
        />

        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
          {data.view === "month" ? (
            <AppInput
              type="month"
              value={data.month_value}
              onChange={(event) => setMonthFilter(event.target.value)}
              className="min-h-11 w-full min-w-0 sm:w-[10.75rem]"
              aria-label="Month"
            />
          ) : null}
          {data.view === "year" ? (
            <div className="flex min-w-0 items-center gap-2">
              <AppInput
                type="number"
                min={1970}
                max={3000}
                value={resolvedYearInput}
                onChange={(event) => setYearInput(event.target.value)}
                className="min-h-11 min-w-0 flex-1 sm:w-28 sm:flex-none"
                aria-label="Year"
              />
              <AppButton
                type="button"
                onClick={() => setYearFilter(resolvedYearInput)}
                tone="ghost"
                className="min-h-11 px-4"
              >
                Apply
              </AppButton>
            </div>
          ) : null}
          {data.view === "templates" ? (
            <p className="self-center text-xs text-muted">
              {data.templates.length} recurring {data.templates.length === 1 ? "plan" : "plans"}
            </p>
          ) : null}
          {data.view !== "templates" ? (
            <AppButton
              type="button"
              onClick={() => setView("templates")}
              tone="ghost"
              className="min-h-11 whitespace-normal px-3 text-xs"
            >
              Manage recurring budgets
            </AppButton>
          ) : null}
        </div>
      </WorkspaceToolbar>

      {data.view === "month" ? (
        <>
          <div
            data-testid="budget-summary-grid"
            className="grid grid-cols-2 gap-2.5 xl:grid-cols-4"
          >
            <MetricLane tone="plan" data-testid="budget-summary-allocation" className="p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-[0.625rem] bg-surface-hi/70 text-semantic-blue">
                  <TargetIcon className="h-4 w-4" />
                </span>
                Allocation
              </div>
              <p className="mt-3 break-words font-mono text-xl font-semibold tabular-nums text-text">
                {formatCurrency(monthlyAllocation, false)} €
              </p>
              <p className="mt-1 text-xs text-muted">
                {data.budgets.length} active {data.budgets.length === 1 ? "plan" : "plans"}
              </p>
            </MetricLane>
            <MetricLane tone="expense" data-testid="budget-summary-spent" className="p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-[0.625rem] bg-surface-hi/70 text-semantic-red">
                  <ReceiptIcon className="h-4 w-4" />
                </span>
                Spent
              </div>
              <p className="mt-3 break-words font-mono text-xl font-semibold tabular-nums text-semantic-red">
                {formatCurrency(monthlySpent, false)} €
              </p>
              <p className="mt-1 text-xs text-muted">Actual this month</p>
            </MetricLane>
            <MetricLane
              tone={monthlyRemaining < 0 ? "warning" : "income"}
              data-testid="budget-summary-remaining"
              className="p-4"
            >
              <div className="flex items-center gap-2 text-xs font-semibold text-muted">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-[0.625rem] bg-surface-hi/70 text-semantic-green">
                  <PiggyBankIcon className="h-4 w-4" />
                </span>
                {monthlyRemaining < 0 ? "Over plan" : "Remaining"}
              </div>
              <p
                className={`mt-3 break-words font-mono text-xl font-semibold tabular-nums ${
                  monthlyRemaining < 0 ? "text-semantic-red" : "text-semantic-green"
                }`}
              >
                {formatCurrency(Math.abs(monthlyRemaining), false)} €
              </p>
              <p className="mt-1 text-xs text-muted">Available in the plan</p>
            </MetricLane>
            <MetricLane tone="warning" data-testid="budget-summary-pace" className="p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-[0.625rem] bg-surface-hi/70 text-text">
                  <GaugeIcon className="h-4 w-4" />
                </span>
                Used &amp; pace
              </div>
              <p className="mt-3 font-mono text-xl font-semibold tabular-nums text-text">
                {monthlyUsedPercent}%
              </p>
              <p className="mt-1 break-words text-xs text-muted">
                {monthlyPaceNotStarted
                  ? `Pacing has not started for ${selectedMonthLabel}`
                  : `${monthlyPaceStatus} · ${monthlyPaceRatio
                      .toFixed(2)
                      .replace(/\.00$/, "")}x projected`}
              </p>
            </MetricLane>
          </div>

          <div className="grid items-start gap-4">
            <FinancialPanel role="panel" className="min-w-0 overflow-hidden">
              <SectionHeading>
                <div className="min-w-0">
                  <h2 className="font-head text-lg font-bold text-text">
                    {selectedMonthLabel} plan
                  </h2>
                  <p className="mt-0.5 text-xs text-muted">
                    Actuals, limits, and projected finish by category
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-faint px-2.5 py-1 text-xs text-muted">
                  {data.budgets.length}
                </span>
              </SectionHeading>

              <div className="grid gap-3 p-3.5 md:grid-cols-2 md:p-4">
                {data.budgets.length ? (
                  data.budgets.map((row) => {
                    const scopeKey = String(row.scope_category_id ?? "null")
                    const progress = progressMap.get(scopeKey)
                    const spent = progress?.spent_cents ?? 0
                    const remaining =
                      progress?.remaining_cents ?? row.amount_cents - spent
                    const projected = progress?.projected_total_cents ?? spent
                    const over = remaining < 0
                    const usedPercent = row.amount_cents
                      ? (spent / row.amount_cents) * 100
                      : 0
                    const progressWidth = Math.min(100, Math.max(0, usedPercent))
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
                      <article
                        key={`${row.scope_label}-${row.source_id}`}
                        data-testid="budget-plan-card"
                        className="min-w-0 rounded-[1.125rem] bg-faint/75 p-4 shadow-[inset_0_1px_0_rgb(var(--surface-highlight)_/_0.05)]"
                      >
                        <div className="flex min-w-0 items-start justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <CategoryIcon
                              icon={
                                row.scope_category_id === null
                                  ? null
                                  : (catIconMap[row.scope_category_id] ?? null)
                              }
                              label={row.scope_label}
                            />
                            <div className="min-w-0">
                              <h3 className="truncate font-semibold text-text">
                                {row.scope_label}
                              </h3>
                              <p className="text-xs text-muted">
                                {row.source === "override"
                                  ? "Month override"
                                  : row.source === "template"
                                    ? "Recurring plan"
                                    : row.source}
                              </p>
                            </div>
                          </div>
                          <span className="shrink-0 rounded-full bg-surface-hi/75 px-2 py-1 font-mono text-[10px] text-muted">
                            {Math.round(usedPercent)}% used
                          </span>
                        </div>

                        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
                          <div className="min-w-0">
                            <dt className="text-xs text-muted">Actual</dt>
                            <dd className="mt-0.5 break-words font-mono text-sm font-semibold tabular-nums text-semantic-red">
                              {formatCurrency(spent)} €
                            </dd>
                          </div>
                          <div className="min-w-0">
                            <dt className="text-xs text-muted">Limit</dt>
                            <dd className="mt-0.5 break-words font-mono text-sm font-semibold tabular-nums text-text">
                              {formatCurrency(row.amount_cents)} €
                            </dd>
                          </div>
                          <div className="min-w-0">
                            <dt className="text-xs text-muted">
                              {over ? "Over" : "Remaining"}
                            </dt>
                            <dd
                              className={`mt-0.5 break-words font-mono text-sm font-semibold tabular-nums ${
                                over ? "text-semantic-red" : "text-semantic-green"
                              }`}
                            >
                              {formatCurrency(Math.abs(remaining))} €
                            </dd>
                          </div>
                          <div className="min-w-0">
                            <dt className="text-xs text-muted">Projection</dt>
                            <dd
                              className={`mt-0.5 break-words font-mono text-sm font-semibold tabular-nums ${
                                projected > row.amount_cents
                                  ? "text-semantic-red"
                                  : "text-text"
                              }`}
                            >
                              {formatCurrency(projected)} €
                            </dd>
                          </div>
                        </dl>

                        <div
                          className="mt-4 h-1.5 overflow-hidden rounded-sm bg-surface-hi"
                          role="progressbar"
                          aria-label={`${row.scope_label} budget used`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(progressWidth)}
                          aria-valuetext={`${Math.round(usedPercent)}% used`}
                        >
                          <div
                            className={`h-full rounded-sm ${
                              over ? "bg-semantic-red" : "bg-semantic-green"
                            }`}
                            style={{ width: `${progressWidth}%` }}
                          />
                        </div>

                        <div className="mt-3 flex min-w-0 items-start justify-between gap-3">
                          <p className={`min-w-0 break-words font-mono text-[11px] leading-5 ${pacing.tone}`}>
                            {pacing.text}
                          </p>
                          <span className={`shrink-0 font-mono text-xs font-semibold ${pacing.badgeTone}`}>
                            {velocityRatio.toFixed(2).replace(/\.00$/, "")}x
                          </span>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3">
                          <AppButton
                            type="button"
                            onClick={() =>
                              setExpandedCharts((current) => ({
                                ...current,
                                [scopeKey]: !chartOpen,
                              }))
                            }
                            tone="inline"
                            className="min-h-11"
                          >
                            {chartOpen ? "Hide chart" : "Show chart"}
                          </AppButton>
                          {row.source === "override" ? (
                            <AppButton
                              type="button"
                              onClick={() =>
                                deleteOverrideMutation.mutate(row.source_id)
                              }
                              tone="inlineDanger"
                              className="min-h-11"
                            >
                              <TrashIcon className="h-3.5 w-3.5" />
                              Remove month budget
                            </AppButton>
                          ) : null}
                        </div>

                        {chartOpen ? (
                          <>
                            <label className="mt-2 flex min-h-11 items-center gap-2 text-xs text-muted">
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
                              Compare previous month
                            </label>
                            <BudgetBurndownPanel
                              monthValue={data.month_value}
                              scopeCategoryId={row.scope_category_id}
                              compareEnabled={compareEnabled}
                            />
                          </>
                        ) : null}
                      </article>
                    )
                  })
                ) : (
                  <div className="rounded-[1.125rem] bg-faint/70 px-5 py-8 text-center md:col-span-2">
                    <p className="font-head text-lg font-bold text-text">
                      No plan for {selectedMonthLabel}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      Set a month budget here or add a recurring plan.
                    </p>
                    <AppButton
                      type="button"
                      onClick={() => setView("templates")}
                      tone="ghost"
                      className="mt-4"
                    >
                      Manage recurring budgets
                    </AppButton>
                  </div>
                )}
              </div>
            </FinancialPanel>

          </div>
        </>
      ) : null}

      {data.view === "templates" ? (
        <div className="grid items-start gap-4">
          <FinancialPanel role="panel" className="min-w-0 overflow-hidden">
            <SectionHeading>
              <div>
                <h2 className="font-head text-lg font-bold text-text">
                  Recurring plans
                </h2>
                <p className="mt-0.5 text-xs text-muted">
                  Monthly and yearly limits that repeat automatically
                </p>
              </div>
              <span className="rounded-full bg-faint px-2.5 py-1 text-xs text-muted">
                {data.templates.length}
              </span>
            </SectionHeading>
            <div className="grid gap-3 p-3.5 md:p-4">
              {data.templates.length ? (
                data.templates.map((tmpl) => (
                  <article
                    key={tmpl.id}
                    data-testid="budget-template-card"
                    className="min-w-0 rounded-[1.125rem] bg-faint/75 p-4"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <CategoryIcon
                        icon={
                          tmpl.category
                            ? (catIconMap[tmpl.category.id] ?? null)
                            : null
                        }
                        label={tmpl.category?.name ?? "Overall"}
                      />
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate font-semibold text-text">
                          {tmpl.category?.name ?? "All expense categories"}
                        </h3>
                        <p className="mt-0.5 text-xs capitalize text-muted">
                          {tmpl.frequency} plan
                        </p>
                      </div>
                      <p className="shrink-0 font-mono text-sm font-semibold tabular-nums text-text">
                        {formatCurrency(tmpl.amount_cents)} €
                      </p>
                    </div>
                    <p className="mt-4 text-xs leading-5 text-muted">
                      From {formatEuroDate(tmpl.starts_on)}
                      {tmpl.ends_on ? ` to ${formatEuroDate(tmpl.ends_on)}` : " · No end date"}
                    </p>
                    <div className="mt-3 flex justify-end border-t border-border/70 pt-3">
                      <AppButton
                        type="button"
                        onClick={() => deleteTemplateMutation.mutate(tmpl.id)}
                        tone="inlineDanger"
                        className="min-h-11"
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                        Delete
                      </AppButton>
                    </div>
                  </article>
                ))
              ) : (
                <div className="rounded-[1.125rem] bg-faint/70 px-5 py-8 text-center">
                  <p className="font-head text-lg font-bold text-text">
                    No recurring budgets yet
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    Add a monthly or yearly plan to start here.
                  </p>
                </div>
              )}
            </div>
          </FinancialPanel>

        </div>
      ) : null}

      {data.view === "year" ? (
        <>
          <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
            <MetricLane tone="plan" className="p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted">
                <TargetIcon className="h-4 w-4 text-semantic-blue" />
                Allocation
              </div>
              <p className="mt-3 break-words font-mono text-xl font-semibold tabular-nums text-text">
                {formatCurrency(yearlyAllocation, false)} €
              </p>
              <p className="mt-1 text-xs text-muted">Across {data.year_value}</p>
            </MetricLane>
            <MetricLane tone="expense" className="p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted">
                <ReceiptIcon className="h-4 w-4 text-semantic-red" />
                Spent
              </div>
              <p className="mt-3 break-words font-mono text-xl font-semibold tabular-nums text-semantic-red">
                {formatCurrency(yearlySpent, false)} €
              </p>
              <p className="mt-1 text-xs text-muted">Actual this year</p>
            </MetricLane>
            <MetricLane tone={yearlyRemaining < 0 ? "warning" : "income"} className="p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted">
                <PiggyBankIcon className="h-4 w-4 text-semantic-green" />
                {yearlyRemaining < 0 ? "Over plan" : "Remaining"}
              </div>
              <p
                className={`mt-3 break-words font-mono text-xl font-semibold tabular-nums ${
                  yearlyRemaining < 0 ? "text-semantic-red" : "text-semantic-green"
                }`}
              >
                {formatCurrency(Math.abs(yearlyRemaining), false)} €
              </p>
              <p className="mt-1 text-xs text-muted">Available this year</p>
            </MetricLane>
            <MetricLane tone="warning" className="p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted">
                <GaugeIcon className="h-4 w-4" />
                Used
              </div>
              <p className="mt-3 font-mono text-xl font-semibold tabular-nums text-text">
                {yearlyUsedPercent}%
              </p>
              <p className="mt-1 text-xs text-muted">
                {data.yearly_budgets.length} annual {data.yearly_budgets.length === 1 ? "plan" : "plans"}
              </p>
            </MetricLane>
          </div>

          <FinancialPanel role="panel" className="min-w-0 overflow-hidden">
            <SectionHeading>
              <div>
                <h2 className="font-head text-lg font-bold text-text">
                  {data.year_value} plan
                </h2>
                <p className="mt-0.5 text-xs text-muted">
                  Annual limits and actual spending by category
                </p>
              </div>
              <span className="rounded-full bg-faint px-2.5 py-1 text-xs text-muted">
                {data.yearly_budgets.length}
              </span>
            </SectionHeading>
            <div className="grid gap-3 p-3.5 md:grid-cols-2 md:p-4">
              {data.yearly_budgets.length ? (
                data.yearly_budgets.map((row) => {
                  const spent =
                    yearlySpentMap.get(String(row.scope_category_id ?? "null"))
                      ?.spent_cents ?? 0
                  const remaining = row.amount_cents - spent
                  const over = remaining < 0
                  const usedPercent = row.amount_cents
                    ? (spent / row.amount_cents) * 100
                    : 0
                  const progressWidth = Math.min(100, Math.max(0, usedPercent))
                  return (
                    <article
                      key={`${row.scope_label}-${row.source_id}`}
                      data-testid="budget-year-plan-card"
                      className="min-w-0 rounded-[1.125rem] bg-faint/75 p-4"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <CategoryIcon
                          icon={
                            row.scope_category_id === null
                              ? null
                              : (catIconMap[row.scope_category_id] ?? null)
                          }
                          label={row.scope_label}
                        />
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate font-semibold text-text">
                            {row.scope_label}
                          </h3>
                          <p className="text-xs text-muted">Yearly recurring plan</p>
                        </div>
                        <span className="shrink-0 font-mono text-xs text-muted">
                          {Math.round(usedPercent)}%
                        </span>
                      </div>
                      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                        <div className="min-w-0">
                          <dt className="text-xs text-muted">Actual</dt>
                          <dd className="mt-0.5 break-words font-mono text-sm font-semibold text-semantic-red">
                            {formatCurrency(spent)} €
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-xs text-muted">Limit</dt>
                          <dd className="mt-0.5 break-words font-mono text-sm font-semibold text-text">
                            {formatCurrency(row.amount_cents)} €
                          </dd>
                        </div>
                        <div className="col-span-2 min-w-0 sm:col-span-1">
                          <dt className="text-xs text-muted">{over ? "Over" : "Remaining"}</dt>
                          <dd
                            className={`mt-0.5 break-words font-mono text-sm font-semibold ${
                              over ? "text-semantic-red" : "text-semantic-green"
                            }`}
                          >
                            {formatCurrency(Math.abs(remaining))} €
                          </dd>
                        </div>
                      </dl>
                      <div
                        className="mt-4 h-1.5 overflow-hidden rounded-sm bg-surface-hi"
                        role="progressbar"
                        aria-label={`${row.scope_label} yearly budget used`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(progressWidth)}
                        aria-valuetext={`${Math.round(usedPercent)}% used`}
                      >
                        <div
                          className={`h-full rounded-sm ${
                            over ? "bg-semantic-red" : "bg-semantic-green"
                          }`}
                          style={{ width: `${progressWidth}%` }}
                        />
                      </div>
                    </article>
                  )
                })
              ) : (
                <div className="rounded-[1.125rem] bg-faint/70 px-5 py-8 text-center md:col-span-2">
                  <p className="font-head text-lg font-bold text-text">
                    No yearly budgets yet
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    Add a yearly recurring budget to build the annual plan.
                  </p>
                  <AppButton
                    type="button"
                    onClick={() => setView("templates")}
                    tone="ghost"
                    className="mt-4"
                  >
                    Open recurring budgets
                  </AppButton>
                </div>
              )}
            </div>
          </FinancialPanel>
        </>
      ) : null}

      <Dialog
        open={editorOpen}
        onOpenChange={(open) => {
          if (!open && !overrideMutation.isPending && !templateMutation.isPending) {
            setEditorOpen(false)
          }
        }}
      >
        <DialogContent
          aria-label="Add budget"
          className="max-h-[calc(100dvh-2rem)] overflow-hidden p-5"
        >
          <div className="-mr-5 overflow-y-auto pr-5">
            <DialogHeader>
              <div>
                <DialogTitle>
                  {data.view === "month"
                    ? `Add budget for ${selectedMonthLabel}`
                    : data.view === "year"
                      ? `Add budget for ${data.year_value}`
                      : "Add recurring budget"}
                </DialogTitle>
              </div>
              <DialogClose asChild>
                <AppButton
                  tone="ghost"
                  className="h-9 w-9 rounded-full p-0"
                  aria-label="Close budget editor"
                  disabled={overrideMutation.isPending || templateMutation.isPending}
                >
                  <XIcon className="h-4 w-4" />
                </AppButton>
              </DialogClose>
            </DialogHeader>

            {data.view === "month" ? (
              <form onSubmit={handleOverrideSubmit} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
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
                </div>
                {overrideError ? (
                  <p className="text-xs text-semantic-red">{overrideError}</p>
                ) : null}
                <div className="flex gap-2 border-t border-border pt-4">
                  <AppButton
                    type="submit"
                    className="flex-1"
                    disabled={overrideMutation.isPending}
                  >
                    {overrideMutation.isPending ? "Saving…" : "Save month budget"}
                  </AppButton>
                  <AppButton
                    type="button"
                    onClick={() => setEditorOpen(false)}
                    tone="ghost"
                    disabled={overrideMutation.isPending}
                  >
                    Cancel
                  </AppButton>
                </div>
              </form>
            ) : (
              <form onSubmit={handleTemplateSubmit} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  {data.view === "templates" ? (
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
                  ) : null}
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
                      value={templateAmount}
                      onChange={(event) => setTemplateAmount(event.target.value)}
                      placeholder="e.g. 500.00"
                      inputMode="decimal"
                      className="mt-1"
                      required
                    />
                  </AppFieldLabel>
                </div>
                {templateError ? (
                  <p className="text-xs text-semantic-red">{templateError}</p>
                ) : null}
                <div className="flex gap-2 border-t border-border pt-4">
                  <AppButton
                    type="submit"
                    className="flex-1"
                    disabled={templateMutation.isPending}
                  >
                    {templateMutation.isPending
                      ? "Saving…"
                      : data.view === "year"
                        ? "Save yearly budget"
                        : "Save recurring budget"}
                  </AppButton>
                  <AppButton
                    type="button"
                    onClick={() => setEditorOpen(false)}
                    tone="ghost"
                    disabled={templateMutation.isPending}
                  >
                    Cancel
                  </AppButton>
                </div>
              </form>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}

export default BudgetsPage
