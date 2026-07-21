import { useCallback, useEffect, useMemo, useState } from "react"
import { CaretLeftIcon } from "@phosphor-icons/react/CaretLeft"
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight"
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
import {
  FinancialPanel,
  MetricLane,
  SectionHeading,
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
  category: { id: number; name: string; icon: string | null } | null
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
  view: "month" | "templates" | "year" | "workspace"
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

function shiftBudgetMonth(monthValue: string, offset: number): string {
  const [yearRaw, monthRaw] = monthValue.split("-")
  const value = new Date(Number(yearRaw), Number(monthRaw) - 1 + offset, 1)
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`
}

function paceLabel(progress: BudgetProgressRow, amountCents: number): {
  text: string
  tone: string
} {
  const ratio = progress.velocity_ratio
  if (ratio > 1.1) {
    return {
      text: `Over pace - projected ${formatCurrency(progress.projected_total_cents)} € (budget ${formatCurrency(amountCents)} €)`,
      tone: "text-semantic-red",
    }
  }
  if (ratio < 0.9) {
    return {
      text: `On track - ${formatCurrency(progress.daily_remaining_cents)} €/day remaining`,
      tone: "text-semantic-green",
    }
  }
  return {
    text: `On pace - ${formatCurrency(progress.daily_remaining_cents)} €/day remaining`,
    tone: "text-muted",
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
  const [editorKind, setEditorKind] = useState<"create" | "month" | "year">(
    "create"
  )
  const [editingBudget, setEditingBudget] = useState<BudgetRow | null>(null)
  const [editingTemplateId, setEditingTemplateId] = useState<number | null>(null)
  const [editingUsualAmount, setEditingUsualAmount] = useState<number | null>(null)
  const [editorFrequency, setEditorFrequency] = useState<"monthly" | "yearly">(
    "monthly"
  )
  const [editorCategory, setEditorCategory] = useState("")
  const [editorAmount, setEditorAmount] = useState("")
  const [editorStart, setEditorStart] = useState("")
  const [editorEnd, setEditorEnd] = useState("")
  const [applyRange, setApplyRange] = useState<"period" | "future">("period")
  const [editorError, setEditorError] = useState("")
  const [expandedCharts, setExpandedCharts] = useState<Record<string, boolean>>({})
  const [compareMonth, setCompareMonth] = useState<Record<string, boolean>>({})

  const queryString = useMemo(() => {
    const params = new URLSearchParams(searchParams)
    params.set("view", "workspace")
    const selectedMonth = params.get("month")
    if (selectedMonth) {
      params.set("year", selectedMonth.slice(0, 4))
    } else {
      params.delete("year")
    }
    return params.toString()
  }, [searchParams])

  const { data, isLoading, error } = useQuery({
    queryKey: ["budgets", queryString],
    queryFn: () => apiFetch<BudgetResponse>(`/api/budgets?${queryString}`),
  })

  useEffect(() => {
    if (!searchParams.has("view")) {
      return
    }
    setSearchParams(buildSearchParams(searchParams, { view: null, year: null }), {
      replace: true,
    })
  }, [searchParams, setSearchParams])

  const openCreateEditor = useCallback(
    (frequency: "monthly" | "yearly" = "monthly", categoryId = "") => {
      if (!data) {
        return
      }
      setEditorKind("create")
      setEditingBudget(null)
      setEditingTemplateId(null)
      setEditingUsualAmount(null)
      setEditorFrequency(frequency)
      setEditorCategory(categoryId)
      setEditorAmount("")
      setEditorStart(
        frequency === "monthly" ? data.month_value : String(data.year_value)
      )
      setEditorEnd("")
      setApplyRange("future")
      setEditorError("")
      setEditorOpen(true)
    },
    [data]
  )

  useEffect(() => {
    setUtilityAction({
      label: "Add budget",
      onClick: () => openCreateEditor("monthly"),
    })
    return () => setUtilityAction(null)
  }, [openCreateEditor, setUtilityAction])

  const invalidateBudgets = () => {
    queryClient.invalidateQueries({ queryKey: ["budgets"] })
  }

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
      setEditorOpen(false)
      invalidateBudgets()
    },
    onError: (mutationError) => {
      setEditorError(
        mutationError instanceof Error
          ? mutationError.message
          : "Could not save the month adjustment."
      )
    },
  })

  const applyFromMutation = useMutation({
    mutationFn: (payload: {
      frequency: "monthly" | "yearly"
      category_id: number | null
      amount_cents: number
      starts_on: string
    }) =>
      apiFetch("/api/budgets/templates/apply-from", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      setEditorOpen(false)
      invalidateBudgets()
    },
    onError: (mutationError) => {
      setEditorError(
        mutationError instanceof Error
          ? mutationError.message
          : "Could not save the budget."
      )
    },
  })

  const templateMutation = useMutation({
    mutationFn: (payload: {
      frequency: "monthly" | "yearly"
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
      setEditorOpen(false)
      invalidateBudgets()
    },
    onError: (mutationError) => {
      setEditorError(
        mutationError instanceof Error
          ? mutationError.message
          : "Could not save the budget."
      )
    },
  })

  const deleteOverrideMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/budgets/overrides/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setEditorOpen(false)
      invalidateBudgets()
    },
  })

  const deleteTemplateMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/budgets/templates/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setEditorOpen(false)
      invalidateBudgets()
    },
  })

  if (isLoading) {
    return <div className="text-muted">Loading budgets…</div>
  }
  if (error || !data) {
    return <div className="text-semantic-red">Unable to load budgets.</div>
  }

  const selectedMonthLabel = formatBudgetMonth(data.month_value)
  const selectedMonthStart = `${data.month_value}-01`
  const expenseCategories = data.categories.filter(
    (category) => category.type === "expense" && !category.archived_at
  )
  const categoryIcons = new Map(
    data.categories.map((category) => [category.id, category.icon])
  )
  const progressMap = new Map(
    data.progress.map((row) => [String(row.scope_category_id ?? "null"), row])
  )
  const yearlySpentMap = new Map(
    data.yearly_spent.map((row) => [String(row.scope_category_id ?? "null"), row])
  )

  const activeMonthlyTemplates = new Map<string, BudgetTemplateRow>()
  for (const template of [...data.templates]
    .filter(
      (row) =>
        row.frequency === "monthly" &&
        row.starts_on <= selectedMonthStart &&
        (!row.ends_on || row.ends_on >= selectedMonthStart)
    )
    .sort((left, right) => right.starts_on.localeCompare(left.starts_on))) {
    const key = String(template.category?.id ?? "null")
    if (!activeMonthlyTemplates.has(key)) {
      activeMonthlyTemplates.set(key, template)
    }
  }

  const selectedYearStart = `${data.year_value}-01-01`
  const activeYearlyTemplates = new Map<string, BudgetTemplateRow>()
  for (const template of [...data.templates]
    .filter(
      (row) =>
        row.frequency === "yearly" &&
        row.starts_on <= selectedYearStart &&
        (!row.ends_on || row.ends_on >= selectedYearStart)
    )
    .sort((left, right) => right.starts_on.localeCompare(left.starts_on))) {
    const key = String(template.category?.id ?? "null")
    if (!activeYearlyTemplates.has(key)) {
      activeYearlyTemplates.set(key, template)
    }
  }

  const activeTemplateIds = new Set([
    ...[...activeMonthlyTemplates.values()].map((row) => row.id),
    ...[...activeYearlyTemplates.values()].map((row) => row.id),
  ])
  const inactiveTemplates = data.templates.filter(
    (template) => !activeTemplateIds.has(template.id)
  )

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
  const monthlyPaceNotStarted =
    monthlyAllocation > 0 &&
    data.progress.length > 0 &&
    data.progress.every((row) => row.days_elapsed === 0)
  const monthlyPaceRatio = monthlyAllocation
    ? monthlyProjected / monthlyAllocation
    : 0
  const monthlyPaceStatus = monthlyPaceNotStarted
    ? `Pacing has not started for ${selectedMonthLabel}`
    : monthlyPaceRatio > 1.1
      ? `Over pace · ${monthlyPaceRatio.toFixed(2)}x projected`
      : monthlyPaceRatio < 0.9
        ? `On track · ${monthlyPaceRatio.toFixed(2)}x projected`
        : `On pace · ${monthlyPaceRatio.toFixed(2)}x projected`
  const categoryBudgetTotal = categoryMonthBudgets.reduce(
    (total, row) => total + row.amount_cents,
    0
  )

  const setMonthFilter = (monthValue: string) =>
    setSearchParams(
      buildSearchParams(searchParams, {
        view: null,
        month: monthValue,
        year: null,
      })
    )

  const openMonthEditor = (row: BudgetRow) => {
    const template = activeMonthlyTemplates.get(
      String(row.scope_category_id ?? "null")
    )
    setEditorKind("month")
    setEditingBudget(row)
    setEditingTemplateId(row.source === "template" ? row.source_id : null)
    setEditingUsualAmount(template?.amount_cents ?? null)
    setEditorFrequency("monthly")
    setEditorCategory(
      row.scope_category_id === null ? "" : String(row.scope_category_id)
    )
    setEditorAmount(formatCurrency(row.amount_cents, false))
    setEditorStart(data.month_value)
    setEditorEnd("")
    setApplyRange("period")
    setEditorError("")
    setEditorOpen(true)
  }

  const openYearEditor = (row: BudgetYearRow) => {
    setEditorKind("year")
    setEditingBudget(row)
    setEditingTemplateId(row.source_id)
    setEditingUsualAmount(null)
    setEditorFrequency("yearly")
    setEditorCategory(
      row.scope_category_id === null ? "" : String(row.scope_category_id)
    )
    setEditorAmount(formatCurrency(row.amount_cents, false))
    setEditorStart(String(data.year_value))
    setEditorEnd("")
    setApplyRange("future")
    setEditorError("")
    setEditorOpen(true)
  }

  const parseAmount = (raw: string) => {
    const value = Number(raw.replace(/\s/g, "").replace(",", "."))
    if (!Number.isFinite(value) || value < 0) {
      return null
    }
    return Math.round(value * 100)
  }

  const handleEditorSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setEditorError("")
    const amountCents = parseAmount(editorAmount)
    if (amountCents === null) {
      setEditorError("Enter a valid amount.")
      return
    }
    const categoryId = editorCategory ? Number(editorCategory) : null

    if (editorKind === "month") {
      const [yearRaw, monthRaw] = data.month_value.split("-")
      if (applyRange === "period") {
        overrideMutation.mutate({
          year: Number(yearRaw),
          month: Number(monthRaw),
          category_id: categoryId,
          amount_cents: amountCents,
        })
      } else {
        applyFromMutation.mutate({
          frequency: "monthly",
          category_id: categoryId,
          amount_cents: amountCents,
          starts_on: `${data.month_value}-01`,
        })
      }
      return
    }

    if (editorKind === "year") {
      applyFromMutation.mutate({
        frequency: "yearly",
        category_id: categoryId,
        amount_cents: amountCents,
        starts_on: `${data.year_value}-01-01`,
      })
      return
    }

    const startsOn =
      editorFrequency === "monthly"
        ? `${editorStart}-01`
        : `${editorStart}-01-01`
    if (!editorStart || startsOn.includes("--")) {
      setEditorError("Choose when the budget starts.")
      return
    }
    const existingAtStart = data.templates.find(
      (template) =>
        template.frequency === editorFrequency &&
        (template.category?.id ?? null) === categoryId &&
        template.starts_on <= startsOn &&
        (!template.ends_on || template.ends_on >= startsOn)
    )
    if (existingAtStart) {
      const categoryLabel =
        existingAtStart.category?.name ?? "All expense categories"
      setEditorError(
        `${categoryLabel} already has a ${editorFrequency === "monthly" ? "monthly" : "yearly"} budget for this period. Edit that budget instead.`
      )
      return
    }

    if (!editorEnd) {
      applyFromMutation.mutate({
        frequency: editorFrequency,
        category_id: categoryId,
        amount_cents: amountCents,
        starts_on: startsOn,
      })
      return
    }

    let endsOn: string
    if (editorFrequency === "monthly") {
      const [endYearRaw, endMonthRaw] = editorEnd.split("-")
      const endDay = new Date(
        Number(endYearRaw),
        Number(endMonthRaw),
        0
      ).getDate()
      endsOn = `${editorEnd}-${String(endDay).padStart(2, "0")}`
    } else {
      endsOn = `${editorEnd}-12-31`
    }
    if (endsOn < startsOn) {
      setEditorError("The end must not be before the start.")
      return
    }
    templateMutation.mutate({
      frequency: editorFrequency,
      category_id: categoryId,
      amount_cents: amountCents,
      starts_on: startsOn,
      ends_on: endsOn,
    })
  }

  const saving =
    overrideMutation.isPending ||
    applyFromMutation.isPending ||
    templateMutation.isPending
  const dialogTitle =
    editorKind === "create"
      ? editorFrequency === "yearly"
        ? "Add annual budget"
        : "Add budget"
      : `Edit ${editingBudget?.scope_label ?? "budget"}`

  return (
    <section className="space-y-4 md:space-y-5">
      <PageIntro title="Budgets" />

      <FinancialPanel
        role="panel"
        data-testid="budget-workspace-toolbar"
        className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="grid min-w-0 grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-1.5 sm:flex">
          <AppButton
            type="button"
            tone="ghost"
            className="h-11 w-11 p-0"
            aria-label="Previous month"
            onClick={() => setMonthFilter(shiftBudgetMonth(data.month_value, -1))}
          >
            <CaretLeftIcon className="h-4 w-4" />
          </AppButton>
          <AppInput
            type="month"
            value={data.month_value}
            onChange={(event) => setMonthFilter(event.target.value)}
            className="min-h-11 min-w-0 sm:w-[11rem]"
            aria-label="Budget month"
          />
          <AppButton
            type="button"
            tone="ghost"
            className="h-11 w-11 p-0"
            aria-label="Next month"
            onClick={() => setMonthFilter(shiftBudgetMonth(data.month_value, 1))}
          >
            <CaretRightIcon className="h-4 w-4" />
          </AppButton>
        </div>
        <div className="flex min-w-0 items-center justify-between gap-3 sm:justify-end">
          <p className="min-w-0 text-xs text-muted">
            Monthly plans and {data.year_value} annual budgets
          </p>
          <AppButton
            type="button"
            tone="inline"
            className="min-h-11 shrink-0"
            onClick={() => {
              const today = new Date()
              setMonthFilter(
                `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`
              )
            }}
          >
            Today
          </AppButton>
        </div>
      </FinancialPanel>

      {data.budgets.length ? (
        <FinancialPanel role="panel" className="overflow-hidden p-3.5 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold text-muted">
                {overallMonthBudget
                  ? "Overall spending plan"
                  : "Budgeted categories"}
              </p>
              <h2 className="mt-1 font-head text-lg font-bold text-text">
                {overallMonthBudget
                  ? "All expense categories"
                  : selectedMonthLabel}
              </h2>
            </div>
            <div className="flex items-baseline gap-1.5 sm:text-right">
              <span className="font-mono text-lg font-semibold text-text">
                {formatCurrency(monthlyAllocation)} €
              </span>
              <span className="font-mono text-[10px] text-muted">per month</span>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2.5 xl:grid-cols-4">
            <MetricLane
              tone="plan"
              data-testid="budget-summary-allocation"
              className="col-span-2 p-4 xl:col-span-1"
            >
              <div className="flex items-center gap-2 text-xs font-semibold text-muted">
                <TargetIcon className="h-4 w-4 text-semantic-blue" />
                Used
              </div>
              <p className="mt-3 font-mono text-xl font-semibold text-text">
                {monthlyUsedPercent}%
              </p>
              <div
                className="mt-3 h-1.5 overflow-hidden rounded-sm bg-surface-hi"
                role="progressbar"
                aria-label="Monthly budget used"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.min(100, Math.max(0, monthlyUsedPercent))}
                aria-valuetext={`${monthlyUsedPercent}% used`}
              >
                <div
                  className="h-full rounded-sm bg-accent"
                  style={{ width: `${Math.min(100, Math.max(0, monthlyUsedPercent))}%` }}
                />
              </div>
            </MetricLane>
            <MetricLane
              tone="expense"
              data-testid="budget-summary-spent"
              className="p-4"
            >
              <div className="flex items-center gap-2 text-xs font-semibold text-muted">
                <ReceiptIcon className="h-4 w-4 text-semantic-red" />
                Spent
              </div>
              <p className="mt-3 font-mono text-xl font-semibold text-semantic-red">
                {formatCurrency(monthlySpent, false)} €
              </p>
              <p className="mt-1 text-xs text-muted">In planned spending</p>
            </MetricLane>
            <MetricLane
              tone={monthlyRemaining < 0 ? "warning" : "income"}
              data-testid="budget-summary-remaining"
              className="p-4"
            >
              <div className="flex items-center gap-2 text-xs font-semibold text-muted">
                <PiggyBankIcon className="h-4 w-4 text-semantic-green" />
                {monthlyRemaining < 0 ? "Over plan" : "Remaining"}
              </div>
              <p
                className={`mt-3 font-mono text-xl font-semibold ${
                  monthlyRemaining < 0
                    ? "text-semantic-red"
                    : "text-semantic-green"
                }`}
              >
                {formatCurrency(Math.abs(monthlyRemaining), false)} €
              </p>
              <p className="mt-1 text-xs text-muted">Within planned spending</p>
            </MetricLane>
            <MetricLane
              tone="warning"
              data-testid="budget-summary-pace"
              className="col-span-2 p-4 xl:col-span-1"
            >
              <div className="flex items-center gap-2 text-xs font-semibold text-muted">
                <GaugeIcon className="h-4 w-4" />
                Projected
              </div>
              <p className="mt-3 font-mono text-xl font-semibold text-text">
                {formatCurrency(monthlyProjected, false)} €
              </p>
              <p className="mt-1 text-xs text-muted">{monthlyPaceStatus}</p>
            </MetricLane>
          </div>

          <div className="mt-4 flex flex-col gap-2 border-t border-border/70 pt-3 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
            <p>
              {overallMonthBudget
                ? `Category budgets total ${formatCurrency(categoryBudgetTotal)} €. The ${formatCurrency(overallMonthBudget.amount_cents)} € overall cap remains separate.`
                : `${formatCurrency(monthlySpent)} € spent across categories with ${formatCurrency(categoryBudgetTotal)} € in limits. No overall cap is configured.`}
            </p>
            <div className="flex shrink-0 flex-wrap gap-2">
              {overallMonthBudget ? (
                <>
                  <AppButton
                    type="button"
                    tone="inline"
                    className="min-h-11"
                    onClick={() =>
                      setExpandedCharts((current) => ({
                        ...current,
                        overall: !current.overall,
                      }))
                    }
                  >
                    {expandedCharts.overall ? "Hide details" : "View details"}
                  </AppButton>
                  <AppButton
                    type="button"
                    tone="inline"
                    className="min-h-11"
                    onClick={() => openMonthEditor(overallMonthBudget)}
                  >
                    Edit overall plan
                  </AppButton>
                </>
              ) : (
                <AppButton
                  type="button"
                  tone="inline"
                  className="min-h-11"
                  onClick={() => openCreateEditor("monthly", "")}
                >
                  Add overall budget
                </AppButton>
              )}
            </div>
          </div>
          {overallMonthBudget && expandedCharts.overall ? (
            <>
              <label className="mt-2 flex min-h-11 items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={compareMonth.overall ?? false}
                  onChange={(event) =>
                    setCompareMonth((current) => ({
                      ...current,
                      overall: event.target.checked,
                    }))
                  }
                  className="control-check"
                />
                Compare previous month
              </label>
              <BudgetBurndownPanel
                monthValue={data.month_value}
                scopeCategoryId={null}
                compareEnabled={compareMonth.overall ?? false}
              />
            </>
          ) : null}
        </FinancialPanel>
      ) : null}

      <FinancialPanel role="panel" className="min-w-0 overflow-hidden">
        <SectionHeading>
          <div className="min-w-0">
            <h2 className="font-head text-lg font-bold text-text">
              Monthly budgets
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              Usual limits, with {selectedMonthLabel} adjustments shown in context
            </p>
          </div>
          <span className="rounded-full bg-faint px-2.5 py-1 text-xs text-muted">
            {categoryMonthBudgets.length}
          </span>
        </SectionHeading>
        {categoryMonthBudgets.length ? (
          <div className="divide-y divide-border/70 px-3.5 sm:px-5">
            {categoryMonthBudgets.map((row) => {
              const scopeKey = String(row.scope_category_id)
              const progress = progressMap.get(scopeKey)
              const spent = progress?.spent_cents ?? 0
              const remaining = progress?.remaining_cents ?? row.amount_cents - spent
              const usedPercent = row.amount_cents
                ? (spent / row.amount_cents) * 100
                : 0
              const projected = progress?.projected_total_cents ?? spent
              const template = activeMonthlyTemplates.get(scopeKey)
              const chartOpen = expandedCharts[scopeKey] ?? false
              const compareEnabled = compareMonth[scopeKey] ?? false
              const pacing = progress
                ? paceLabel(progress, row.amount_cents)
                : { text: "No pace available", tone: "text-muted" }
              return (
                <article
                  key={`${row.scope_label}-${row.source_id}`}
                  data-testid="budget-plan-card"
                  className="min-w-0 py-4"
                >
                  <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(13rem,1.15fr)_auto] md:items-center">
                    <div className="flex min-w-0 items-start gap-3">
                      <CategoryIcon
                        icon={
                          row.scope_category_id === null
                            ? null
                            : (categoryIcons.get(row.scope_category_id) ?? null)
                        }
                        label={row.scope_label}
                      />
                      <div className="min-w-0">
                        <h3 className="truncate font-semibold leading-5 text-text">
                          {row.scope_label}
                        </h3>
                        <p className="mt-1 font-mono text-xs leading-4 text-muted">
                          {formatCurrency(row.amount_cents)} €{" "}
                          {row.source === "override" ? `in ${selectedMonthLabel}` : "per month"}
                        </p>
                        {row.source === "override" ? (
                          <span className="mt-1.5 block text-xs font-semibold leading-4 text-warning-ink">
                            {template
                              ? `Adjusted this month · usually ${formatCurrency(template.amount_cents)} €`
                              : `Only ${selectedMonthLabel}`}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="grid min-h-11 min-w-0 grid-rows-[1.5rem_1rem] content-center">
                      <div
                        className="h-1.5 self-center overflow-hidden rounded-sm bg-surface-hi"
                        role="progressbar"
                        aria-label={`${row.scope_label} budget used`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(
                          Math.min(100, Math.max(0, usedPercent))
                        )}
                        aria-valuetext={`${Math.round(usedPercent)}% used`}
                      >
                        <div
                          className={`h-full rounded-sm ${remaining < 0 ? "bg-semantic-red" : "bg-semantic-green"}`}
                          style={{
                            width: `${Math.min(100, Math.max(0, usedPercent))}%`,
                          }}
                        />
                      </div>
                      <div className="flex justify-between gap-3 font-mono text-xs leading-4 text-muted">
                        <span>{formatCurrency(spent)} € spent</span>
                        <span>
                          {formatCurrency(Math.abs(remaining))} €{" "}
                          {remaining < 0 ? "over" : "left"}
                        </span>
                      </div>
                    </div>

                    <div className="flex min-w-0 items-center justify-between gap-3 md:justify-end">
                      <div className="grid min-h-11 min-w-0 grid-rows-[1.5rem_1rem] content-center text-left md:text-right">
                        <p className="self-center font-mono text-xs font-semibold leading-4 text-text">
                          {Math.round(usedPercent)}% used
                        </p>
                        <p className={`max-w-[18rem] text-xs leading-4 ${pacing.tone}`}>
                          {progress?.days_elapsed === 0
                            ? `Pacing has not started for ${selectedMonthLabel}`
                            : `Projected ${formatCurrency(projected)} € · ${pacing.text.split(" - ")[0]}`}
                        </p>
                      </div>
                      <AppButton
                        type="button"
                        tone="inline"
                        className="min-h-11 shrink-0"
                        onClick={() => openMonthEditor(row)}
                      >
                        Edit
                      </AppButton>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 sm:pl-12">
                    <AppButton
                      type="button"
                      tone="inline"
                      className="min-h-11"
                      onClick={() =>
                        setExpandedCharts((current) => ({
                          ...current,
                          [scopeKey]: !chartOpen,
                        }))
                      }
                    >
                      {chartOpen ? "Hide details" : "View details"}
                    </AppButton>
                    {row.source === "override" ? (
                      <AppButton
                        type="button"
                        tone="inline"
                        className="min-h-11"
                        onClick={() => deleteOverrideMutation.mutate(row.source_id)}
                      >
                        {template
                          ? `Reset to ${formatCurrency(template.amount_cents)} €`
                          : `Remove ${selectedMonthLabel} budget`}
                      </AppButton>
                    ) : null}
                  </div>

                  {chartOpen ? (
                    <>
                      <label className="mt-2 flex min-h-11 items-center gap-2 text-xs text-muted sm:ml-12">
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
            })}
          </div>
        ) : (
          <div className="px-5 py-8 text-center">
            <p className="font-head text-lg font-bold text-text">
              {data.budgets.length
                ? "No category budgets yet"
                : `No budgets for ${selectedMonthLabel}`}
            </p>
            <p className="mt-1 text-sm text-muted">
              Add a usual monthly limit. You can adjust individual months later.
            </p>
            <AppButton
              type="button"
              tone="ghost"
              className="mt-4"
              onClick={() => openCreateEditor("monthly")}
            >
              Add monthly budget
            </AppButton>
          </div>
        )}
      </FinancialPanel>

      <FinancialPanel role="panel" className="min-w-0 overflow-hidden">
        <SectionHeading>
          <div className="min-w-0">
            <h2 className="font-head text-lg font-bold text-text">
              Annual budgets · {data.year_value}
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              Longer-term limits stay visible in the same workspace
            </p>
          </div>
          <AppButton
            type="button"
            tone="inline"
            className="min-h-11 shrink-0"
            onClick={() => openCreateEditor("yearly")}
          >
            Add annual
          </AppButton>
        </SectionHeading>
        {data.yearly_budgets.length ? (
          <div className="divide-y divide-border/70 px-3.5 sm:px-5">
            {data.yearly_budgets.map((row) => {
              const scopeKey = String(row.scope_category_id ?? "null")
              const spent = yearlySpentMap.get(scopeKey)?.spent_cents ?? 0
              const remaining = row.amount_cents - spent
              const usedPercent = row.amount_cents
                ? (spent / row.amount_cents) * 100
                : 0
              return (
                <article
                  key={`${row.scope_label}-${row.source_id}`}
                  data-testid="budget-year-plan-card"
                  className="grid min-w-0 gap-4 py-4 md:grid-cols-[minmax(0,1fr)_minmax(13rem,1.15fr)_auto] md:items-center"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <CategoryIcon
                      icon={
                        row.scope_category_id === null
                          ? null
                          : (categoryIcons.get(row.scope_category_id) ?? null)
                      }
                      label={row.scope_label}
                    />
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold leading-5 text-text">
                        {row.scope_label}
                      </h3>
                      <p className="mt-1 font-mono text-xs leading-4 text-muted">
                        {formatCurrency(row.amount_cents)} € per year
                      </p>
                    </div>
                  </div>
                  <div className="grid min-h-11 min-w-0 grid-rows-[1.5rem_1rem] content-center">
                    <div
                      className="h-1.5 self-center overflow-hidden rounded-sm bg-surface-hi"
                      role="progressbar"
                      aria-label={`${row.scope_label} annual budget used`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(
                        Math.min(100, Math.max(0, usedPercent))
                      )}
                      aria-valuetext={`${Math.round(usedPercent)}% used`}
                    >
                      <div
                        className={`h-full rounded-sm ${remaining < 0 ? "bg-semantic-red" : "bg-semantic-purple"}`}
                        style={{
                          width: `${Math.min(100, Math.max(0, usedPercent))}%`,
                        }}
                      />
                    </div>
                    <div className="flex justify-between gap-3 font-mono text-xs leading-4 text-muted">
                      <span>{formatCurrency(spent)} € spent</span>
                      <span>
                        {formatCurrency(Math.abs(remaining))} €{" "}
                        {remaining < 0 ? "over" : "left"}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 md:justify-end">
                    <p className="font-mono text-xs font-semibold leading-4 text-text">
                      {Math.round(usedPercent)}% used
                    </p>
                    <AppButton
                      type="button"
                      tone="inline"
                      className="min-h-11"
                      onClick={() => openYearEditor(row)}
                    >
                      Edit
                    </AppButton>
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <div className="px-5 py-6 text-sm text-muted">
            No annual budgets for {data.year_value}. Add one for travel, repairs, or another longer-term limit.
          </div>
        )}
      </FinancialPanel>

      {inactiveTemplates.length ? (
        <details className="rounded-[1rem] bg-surface px-4 py-2 shadow-[var(--shadow-soft)]">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-text">
            Show {inactiveTemplates.length} future or ended {inactiveTemplates.length === 1 ? "budget" : "budgets"}
          </summary>
          <div className="divide-y divide-border/70 border-t border-border/70">
            {inactiveTemplates.map((template) => (
              <div
                key={template.id}
                className="flex min-w-0 flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-text">
                    {template.category?.name ?? "All expense categories"}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {formatCurrency(template.amount_cents)} € per {template.frequency === "monthly" ? "month" : "year"} · {formatEuroDate(template.starts_on)}
                    {template.ends_on ? ` – ${formatEuroDate(template.ends_on)}` : " onward"}
                  </p>
                </div>
                <AppButton
                  type="button"
                  tone="inlineDanger"
                  className="min-h-11 shrink-0"
                  onClick={() => deleteTemplateMutation.mutate(template.id)}
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                  Remove
                </AppButton>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      <Dialog
        open={editorOpen}
        onOpenChange={(open) => {
          if (!open && !saving) {
            setEditorOpen(false)
          }
        }}
      >
        <DialogContent
          aria-label={dialogTitle}
          className="max-h-[calc(100dvh-2rem)] overflow-hidden p-5"
        >
          <div className="-mr-5 overflow-y-auto pr-5">
            <DialogHeader>
              <div>
                <p className="text-xs font-semibold text-muted">
                  {editorKind === "create"
                    ? "Create a usual plan"
                    : editorKind === "month"
                      ? "Monthly budget"
                      : "Annual budget"}
                </p>
                <DialogTitle>{dialogTitle}</DialogTitle>
              </div>
              <DialogClose asChild>
                <AppButton
                  tone="ghost"
                  className="h-9 w-9 rounded-full p-0"
                  aria-label="Close budget editor"
                  disabled={saving}
                >
                  <XIcon className="h-4 w-4" />
                </AppButton>
              </DialogClose>
            </DialogHeader>

            <form onSubmit={handleEditorSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <AppFieldLabel>
                  Category
                  <AppNativeSelect
                    value={editorCategory}
                    onChange={(event) => setEditorCategory(event.target.value)}
                    className="mt-1"
                    disabled={editorKind !== "create"}
                  >
                    <option value="">All expense categories</option>
                    {expenseCategories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </AppNativeSelect>
                </AppFieldLabel>

                {editorKind === "create" ? (
                  <AppFieldLabel>
                    Repeats
                    <AppNativeSelect
                      value={editorFrequency}
                      onChange={(event) => {
                        const frequency = event.target.value as "monthly" | "yearly"
                        setEditorFrequency(frequency)
                        setEditorStart(
                          frequency === "monthly"
                            ? data.month_value
                            : String(data.year_value)
                        )
                        setEditorEnd("")
                      }}
                      className="mt-1"
                    >
                      <option value="monthly">Every month</option>
                      <option value="yearly">Every year</option>
                    </AppNativeSelect>
                  </AppFieldLabel>
                ) : null}

                <AppFieldLabel className={editorKind !== "create" ? "sm:col-span-2" : ""}>
                  Amount
                  <div className="mt-1 grid grid-cols-[minmax(0,1fr)_7.5rem] gap-2">
                    <AppInput
                      value={editorAmount}
                      onChange={(event) => setEditorAmount(event.target.value)}
                      placeholder="e.g. 500.00"
                      inputMode="decimal"
                      required
                    />
                    <div className="flex min-h-11 items-center rounded-lg border border-border bg-faint px-3 text-xs text-muted">
                      per {editorFrequency === "monthly" ? "month" : "year"}
                    </div>
                  </div>
                </AppFieldLabel>
              </div>

              {editorKind === "month" ? (
                <fieldset className="rounded-[0.875rem] bg-warning-soft p-3.5">
                  <legend className="px-1 text-xs font-semibold text-warning-ink">
                    Apply this amount to
                  </legend>
                  <label className="flex min-h-11 cursor-pointer items-start gap-2.5 py-1 text-xs text-text">
                    <input
                      type="radio"
                      name="apply-range"
                      value="period"
                      checked={applyRange === "period"}
                      onChange={() => setApplyRange("period")}
                      className="mt-0.5 accent-accent"
                    />
                    <span>
                      <strong>Only {selectedMonthLabel}</strong>
                      <span className="mt-0.5 block text-muted">
                        {editingUsualAmount !== null
                          ? `Future months keep the usual amount of ${formatCurrency(editingUsualAmount)} €.`
                          : "No budget is added to future months."}
                      </span>
                    </span>
                  </label>
                  <label className="flex min-h-11 cursor-pointer items-start gap-2.5 py-1 text-xs text-text">
                    <input
                      type="radio"
                      name="apply-range"
                      value="future"
                      checked={applyRange === "future"}
                      onChange={() => setApplyRange("future")}
                      className="mt-0.5 accent-accent"
                    />
                    <span>
                      <strong>{selectedMonthLabel} and future months</strong>
                      <span className="mt-0.5 block text-muted">
                        This becomes the usual amount from {selectedMonthLabel} onward.
                      </span>
                    </span>
                  </label>
                </fieldset>
              ) : null}

              {editorKind === "create" ? (
                <details>
                  <summary className="flex min-h-11 cursor-pointer items-center text-xs font-semibold text-accent">
                    Advanced timing
                  </summary>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <AppFieldLabel>
                      Starts
                      <AppInput
                        type={editorFrequency === "monthly" ? "month" : "number"}
                        min={editorFrequency === "monthly" ? undefined : 1970}
                        max={editorFrequency === "monthly" ? undefined : 3000}
                        value={editorStart}
                        onChange={(event) => setEditorStart(event.target.value)}
                        className="mt-1"
                        required
                      />
                    </AppFieldLabel>
                    <AppFieldLabel>
                      Ends (optional)
                      <AppInput
                        type={editorFrequency === "monthly" ? "month" : "number"}
                        min={editorFrequency === "monthly" ? undefined : 1970}
                        max={editorFrequency === "monthly" ? undefined : 3000}
                        value={editorEnd}
                        onChange={(event) => setEditorEnd(event.target.value)}
                        className="mt-1"
                      />
                    </AppFieldLabel>
                  </div>
                </details>
              ) : null}

              {editorError ? (
                <p className="text-xs text-semantic-red">{editorError}</p>
              ) : null}

              <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row">
                {editorKind === "month" && editingBudget?.source === "override" ? (
                  <AppButton
                    type="button"
                    tone="inlineDanger"
                    className="min-h-11 sm:mr-auto"
                    disabled={deleteOverrideMutation.isPending}
                    onClick={() =>
                      deleteOverrideMutation.mutate(editingBudget.source_id)
                    }
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                    {editingUsualAmount !== null
                      ? "Remove this month’s adjustment"
                      : `Remove ${selectedMonthLabel} budget`}
                  </AppButton>
                ) : editorKind !== "create" && editingTemplateId !== null ? (
                  <AppButton
                    type="button"
                    tone="inlineDanger"
                    className="min-h-11 sm:mr-auto"
                    disabled={deleteTemplateMutation.isPending}
                    onClick={() => deleteTemplateMutation.mutate(editingTemplateId)}
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                    Remove budget
                  </AppButton>
                ) : null}
                <div className="flex flex-1 gap-2 sm:justify-end">
                  <AppButton type="submit" className="flex-1 sm:flex-none" disabled={saving}>
                    {saving
                      ? "Saving…"
                      : editorKind === "create"
                        ? "Save budget"
                        : "Save change"}
                  </AppButton>
                  <AppButton
                    type="button"
                    tone="ghost"
                    disabled={saving}
                    onClick={() => setEditorOpen(false)}
                  >
                    Cancel
                  </AppButton>
                </div>
              </div>
            </form>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}

export default BudgetsPage
