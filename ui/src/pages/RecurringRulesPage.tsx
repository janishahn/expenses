import { Fragment, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { TrashIcon } from "@phosphor-icons/react/Trash"
import { Link, useSearchParams } from "react-router-dom"
import { apiFetch } from "../app/api"
import { formatCurrency, formatEuroDate } from "../app/format"
import { Toggle } from "../components/Toggle"
import { CategoryIcon } from "../components/CategoryIcon"
import PageIntro from "../components/PageIntro"
import DonutChart from "../components/charts/DonutChart"
import type { BreakdownItem } from "../components/charts/DonutChart"
import { AppButton } from "../components/ui/product-button"
import { AppCard } from "../components/ui/product-card"
import {
  AppFieldLabel,
  AppInput,
  AppNativeSelect,
} from "../components/ui/product-fields"

type RuleCategory = {
  id: number
  name: string
  type: string
  icon: string | null
}

type RecurringRuleRow = {
  id: number
  name: string | null
  type: string
  currency_code: string
  amount_cents: number
  monthly_equivalent_cents: number
  category_id: number
  category: RuleCategory | null
  anchor_date: string
  interval_unit: string
  interval_count: number
  next_occurrence: string
  end_date: string | null
  auto_post: boolean
  skip_weekends: boolean
  month_day_policy: string
}

type RecurringStats = {
  total_monthly_income: number
  total_monthly_expenses: number
  net_monthly: number
  coverage_ratio: number
  expense_breakdown: Array<{ name: string; amount_cents: number; percent: number }>
  income_breakdown: Array<{ name: string; amount_cents: number; percent: number }>
  rule_counts: { income: number; expense: number; total: number }
}

type RecurringResponse = {
  rules: RecurringRuleRow[]
  stats: RecurringStats
  categories: RuleCategory[]
}

function frequencyLabel(rule: RecurringRuleRow): string {
  if (rule.interval_unit === "month" && rule.interval_count === 1) {
    return "Monthly"
  }
  if (rule.interval_unit === "year" && rule.interval_count === 1) {
    return "Yearly"
  }
  if (rule.interval_count === 1) {
    return `Every ${rule.interval_unit}`
  }
  return `Every ${rule.interval_count} ${rule.interval_unit}s`
}

function RecurringRulesPage() {
  const queryClient = useQueryClient()
  const formRef = useRef<HTMLFormElement | null>(null)
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const [editingId, setEditingId] = useState<number | null>(null)
  const [name, setName] = useState("")
  const [type, setType] = useState("expense")
  const [currency, setCurrency] = useState("EUR")
  const [amount, setAmount] = useState("")
  const [categoryId, setCategoryId] = useState("")
  const [anchorDate, setAnchorDate] = useState("")
  const [intervalUnit, setIntervalUnit] = useState("month")
  const [intervalCount, setIntervalCount] = useState("1")
  const [endDate, setEndDate] = useState("")
  const [autoPost, setAutoPost] = useState(true)
  const [skipWeekends, setSkipWeekends] = useState(false)
  const [monthDayPolicy, setMonthDayPolicy] = useState("snap_to_end")
  const [nextOccurrence, setNextOccurrence] = useState("")
  const [formError, setFormError] = useState("")
  const [evaluatingRuleId, setEvaluatingRuleId] = useState<number | null>(null)
  const [replacementNotes, setReplacementNotes] = useState<Record<number, string>>({})

  const activeView = searchParams.get("view") === "audit" ? "audit" : "rules"

  const { data, isLoading, error } = useQuery({
    queryKey: ["recurring"],
    queryFn: () => apiFetch<RecurringResponse>("/api/recurring"),
  })

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch("/api/recurring", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recurring"] })
      setEditingId(null)
      setFormError("")
    },
  })

  const updateMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch(`/api/recurring/${editingId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recurring"] })
      setEditingId(null)
      setFormError("")
    },
  })

  const toggleMutation = useMutation({
    mutationFn: (payload: { id: number; auto_post: boolean }) =>
      apiFetch(`/api/recurring/${payload.id}/toggle`, {
        method: "POST",
        body: JSON.stringify({ auto_post: payload.auto_post }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recurring"] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/recurring/${id}`, { method: "DELETE" }),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["recurring"] })
      if (evaluatingRuleId === id) {
        setEvaluatingRuleId(null)
      }
    },
  })

  const deleteRule = (rule: RecurringRuleRow) => {
    const label = rule.name || rule.category?.name || "Untitled"
    if (!confirm(`Delete recurring rule "${label}"?`)) {
      return
    }
    deleteMutation.mutate(rule.id)
  }

  const handleEditRule = (rule: RecurringRuleRow) => {
    setEditingId(rule.id)
    setName(rule.name ?? "")
    setType(rule.type)
    setCurrency(rule.currency_code)
    setAmount((rule.amount_cents / 100).toFixed(2))
    setCategoryId(String(rule.category_id))
    setAnchorDate(rule.anchor_date)
    setIntervalUnit(rule.interval_unit)
    setIntervalCount(String(rule.interval_count))
    setEndDate(rule.end_date ?? "")
    setAutoPost(rule.auto_post)
    setSkipWeekends(rule.skip_weekends)
    setMonthDayPolicy(rule.month_day_policy)
    setNextOccurrence(rule.next_occurrence)
  }

  const showMonthPolicy = useMemo(() => {
    if (!anchorDate) return false
    const day = Number(anchorDate.split("-")[2])
    return (
      (intervalUnit === "month" || intervalUnit === "year") &&
      Number.isFinite(day) &&
      day > 28
    )
  }, [anchorDate, intervalUnit])

  const parseAmount = (raw: string) => {
    const normalized = raw.replace(/\s/g, "").replace(",", ".")
    const value = Number(normalized)
    if (!Number.isFinite(value) || value < 0) {
      return null
    }
    return Math.round(value * 100)
  }

  const previewIntervalCount = Number(intervalCount) || 1
  const {
    data: previewData,
    error: previewQueryError,
    isFetching: previewLoading,
  } = useQuery({
    queryKey: [
      "recurring",
      "preview",
      anchorDate,
      intervalUnit,
      previewIntervalCount,
      monthDayPolicy,
      skipWeekends,
    ],
    queryFn: () =>
      apiFetch<{ occurrences: string[]; error?: string }>("/api/recurring/preview", {
        method: "POST",
        body: JSON.stringify({
          start_date: anchorDate,
          interval_unit: intervalUnit,
          interval_count: previewIntervalCount,
          month_day_policy: monthDayPolicy,
          skip_weekends: skipWeekends,
        }),
      }),
    enabled: Boolean(anchorDate),
    retry: 0,
  })

  const previewError = anchorDate
    ? previewData?.error || (previewQueryError ? "Preview unavailable" : "")
    : ""
  const preview = previewError ? [] : previewData?.occurrences || []

  const resetForm = () => {
    const nextType = "expense"
    const defaultCategory = data?.categories.find((c) => c.type === nextType)
    setEditingId(null)
    setName("")
    setType(nextType)
    setCurrency("EUR")
    setAmount("")
    setCategoryId(defaultCategory ? String(defaultCategory.id) : "")
    setAnchorDate("")
    setIntervalUnit("month")
    setIntervalCount("1")
    setEndDate("")
    setAutoPost(true)
    setSkipWeekends(false)
    setMonthDayPolicy("snap_to_end")
    setNextOccurrence("")
    setFormError("")
  }

  const jumpToForm = () => {
    resetForm()
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      nameInputRef.current?.focus()
    })
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError("")
    const amountCents = parseAmount(amount)
    if (amountCents === null) {
      setFormError("Enter a valid amount.")
      return
    }
    if (!anchorDate) {
      setFormError("Select a start date.")
      return
    }
    if (!categoryId) {
      setFormError("Select a category.")
      return
    }
    const payload = {
      name: name.trim() || null,
      type,
      currency_code: currency,
      amount_cents: amountCents,
      category_id: Number(categoryId),
      anchor_date: anchorDate,
      interval_unit: intervalUnit,
      interval_count: previewIntervalCount,
      next_occurrence: editingId ? nextOccurrence : anchorDate,
      end_date: endDate || null,
      auto_post: autoPost,
      skip_weekends: skipWeekends,
      month_day_policy: monthDayPolicy,
    }
    if (editingId) {
      updateMutation.mutate(payload)
      return
    }
    createMutation.mutate(payload)
  }

  const setView = (view: "rules" | "audit") => {
    const next = new URLSearchParams(searchParams)
    if (view === "audit") {
      next.set("view", "audit")
    } else {
      next.delete("view")
    }
    setSearchParams(next)
  }

  if (isLoading) {
    return <div className="text-muted">Loading recurring rules…</div>
  }
  if (error || !data) {
    return <div className="text-semantic-red">Unable to load recurring rules.</div>
  }

  const categoryOptions = data.categories.filter((c) => c.type === type)
  const expenseRules = data.rules
    .filter((rule) => rule.type === "expense")
    .slice()
    .sort(
      (a, b) =>
        b.monthly_equivalent_cents * 60 - a.monthly_equivalent_cents * 60
    )
  const annualDonut: BreakdownItem[] = data.stats.expense_breakdown.map((item) => ({
    name: item.name,
    amount_cents: item.amount_cents * 12,
    percent: item.percent,
  }))
  const iconMap = Object.fromEntries(
    data.categories
      .filter((category) => category.type === "expense")
      .map((category) => [category.name, category.icon])
  )

  return (
    <section className="space-y-6">
      <PageIntro
        title="Recurring Rules"
        actions={
          activeView === "rules" ? (
            <AppButton
              type="button"
              onClick={jumpToForm}
              className="desk:hidden"
            >
              Add rule
            </AppButton>
          ) : null
        }
      />

      <div className="ptabs">
        <button
          type="button"
          className={`ptab ${activeView === "rules" ? "ptab-active" : ""}`}
          onClick={() => setView("rules")}
        >
          Rules
        </button>
        <button
          type="button"
          className={`ptab ${activeView === "audit" ? "ptab-active" : ""}`}
          onClick={() => setView("audit")}
        >
          Audit
        </button>
      </div>

      {activeView === "rules" && (
        <>
          {data.stats.rule_counts.total > 0 && (
            <div className="grid gap-4 md:grid-cols-3">
              <AppCard className="p-4">
                <p className="text-xs font-semibold uppercase text-muted">
                  Monthly income
                </p>
                <p className="font-mono text-2xl font-semibold text-semantic-green">
                  {formatCurrency(data.stats.total_monthly_income)} €
                </p>
                <p className="text-xs text-muted">
                  {data.stats.rule_counts.income} income rule(s)
                </p>
              </AppCard>
              <AppCard className="p-4">
                <p className="text-xs font-semibold uppercase text-muted">
                  Monthly expenses
                </p>
                <p className="font-mono text-2xl font-semibold text-semantic-red">
                  {formatCurrency(data.stats.total_monthly_expenses)} €
                </p>
                <p className="text-xs text-muted">
                  {data.stats.rule_counts.expense} expense rule(s)
                </p>
              </AppCard>
              <AppCard className="p-4">
                <p className="text-xs font-semibold uppercase text-muted">
                  Coverage ratio
                </p>
                <p
                  className={`font-mono text-2xl font-semibold ${
                    data.stats.coverage_ratio >= 100
                      ? "text-semantic-green"
                      : "text-semantic-red"
                  }`}
                >
                  {Math.round(data.stats.coverage_ratio)}%
                </p>
                <p className="text-xs text-muted">
                  Net {formatCurrency(data.stats.net_monthly)} € per month
                </p>
              </AppCard>
            </div>
          )}

          {(data.stats.expense_breakdown.length > 0 ||
            data.stats.income_breakdown.length > 0) && (
            <div className="grid gap-6 lg:grid-cols-2">
              <AppCard className="p-5">
                <h2 className="font-head text-lg font-bold">Expense categories</h2>
                <div className="mt-4 space-y-3">
                  {data.stats.expense_breakdown.length ? (
                    data.stats.expense_breakdown.map((row) => (
                      <div key={row.name} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-text">{row.name}</span>
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
                    ))
                  ) : (
                    <p className="text-sm text-muted">No expense rules.</p>
                  )}
                </div>
              </AppCard>
              <AppCard className="p-5">
                <h2 className="font-head text-lg font-bold">Income categories</h2>
                <div className="mt-4 space-y-3">
                  {data.stats.income_breakdown.length ? (
                    data.stats.income_breakdown.map((row) => (
                      <div key={row.name} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-text">{row.name}</span>
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
                    ))
                  ) : (
                    <p className="text-sm text-muted">No income rules.</p>
                  )}
                </div>
              </AppCard>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <AppCard>
              <div className="surface-section-header">
                <h2 className="font-head text-lg font-bold">Rules</h2>
              </div>
              <div className="divide-y divide-border">
                {data.rules.length ? (
                  data.rules.map((rule) => {
                    const symbol = rule.currency_code === "USD" ? "$" : "€"
                    const label = rule.name || rule.category?.name || "Untitled"
                    return (
                      <div
                        key={rule.id}
                        className="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between"
                      >
                        <div className="min-w-0 flex items-start gap-2">
                          <CategoryIcon icon={rule.category?.icon ?? null} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3 md:block">
                              <p className="font-semibold text-text">{label}</p>
                              <span
                                className={`shrink-0 font-mono text-sm font-semibold md:hidden ${
                                  rule.type === "income"
                                    ? "text-semantic-green"
                                    : "text-semantic-red"
                                }`}
                              >
                                {rule.type === "income" ? "+" : "-"}
                                {formatCurrency(rule.amount_cents)} {symbol}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-muted">
                              {rule.category?.name ?? "Uncategorized"} · Every{" "}
                              {rule.interval_count} {rule.interval_unit}
                              {rule.interval_count > 1 ? "s" : ""} · Next{" "}
                              {formatEuroDate(rule.next_occurrence)}
                            </p>
                          </div>
                        </div>
                        <div className="hidden flex-wrap items-center gap-2 md:flex">
                          <span
                            className={`font-mono text-sm font-semibold ${
                              rule.type === "income"
                                ? "text-semantic-green"
                                : "text-semantic-red"
                            }`}
                          >
                            {rule.type === "income" ? "+" : "-"}
                            {formatCurrency(rule.amount_cents)} {symbol}
                          </span>
                          <div className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1">
                            <span className="text-[11px] font-semibold text-muted">
                              Auto-post
                            </span>
                            <Toggle
                              on={rule.auto_post}
                              ariaLabel={`Toggle auto-post for ${label}`}
                              onChange={(val) =>
                                toggleMutation.mutate({
                                  id: rule.id,
                                  auto_post: val,
                                })
                              }
                            />
                          </div>
                          <Link
                            to={`/recurring/${rule.id}/occurrences`}
                            className="btn-inline"
                          >
                            History
                          </Link>
                          <AppButton
                            type="button"
                            onClick={() => handleEditRule(rule)}
                            tone="inline"
                          >
                            Edit
                          </AppButton>
                          <AppButton
                            type="button"
                            onClick={() => deleteRule(rule)}
                            tone="inlineDanger"
                          >
                            <TrashIcon className="h-3.5 w-3.5" />
                            Delete
                          </AppButton>
                        </div>
                        <div className="space-y-2 md:hidden">
                          <div className="flex items-center justify-between rounded-lg border border-border bg-bg px-3 py-2">
                            <span className="text-xs font-semibold text-muted">
                              Auto-post
                            </span>
                            <Toggle
                              on={rule.auto_post}
                              ariaLabel={`Toggle auto-post for ${label}`}
                              onChange={(val) =>
                                toggleMutation.mutate({
                                  id: rule.id,
                                  auto_post: val,
                                })
                              }
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <Link
                              to={`/recurring/${rule.id}/occurrences`}
                              className="btn-inline w-full"
                            >
                              History
                            </Link>
                            <AppButton
                              type="button"
                              onClick={() => handleEditRule(rule)}
                              tone="inline"
                              className="w-full"
                            >
                              Edit
                            </AppButton>
                          </div>
                          <AppButton
                            type="button"
                            onClick={() => deleteRule(rule)}
                            tone="inlineDanger"
                            className="w-full"
                          >
                            <TrashIcon className="h-3.5 w-3.5" />
                            Delete
                          </AppButton>
                        </div>
                      </div>
                    )
                  })
                ) : (
                  <div className="px-4 py-6 text-sm text-muted">
                    No recurring rules yet.
                  </div>
                )}
              </div>
            </AppCard>

            <AppCard>
              <form ref={formRef} onSubmit={handleSubmit} className="editor-rail">
                <div className="surface-section-header">
                  <p className="text-xs font-semibold uppercase text-muted">
                    Editor
                  </p>
                  <h2 className="font-head text-lg font-bold">
                    {editingId ? "Edit rule" : "Add rule"}
                  </h2>
                </div>
                <div className="surface-section-body space-y-4">
                  <AppFieldLabel>
                  Name
                  <AppInput
                    ref={nameInputRef}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="mt-1"
                    placeholder="e.g. Netflix"
                  />
                  </AppFieldLabel>
                  <AppFieldLabel>
                  Type
                  <AppNativeSelect
                    value={type}
                    onChange={(event) => {
                      const nextType = event.target.value
                      const defaultCategory = data.categories.find(
                        (category) => category.type === nextType
                      )
                      setType(nextType)
                      setCategoryId(defaultCategory ? String(defaultCategory.id) : "")
                    }}
                    className="mt-1"
                  >
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                  </AppNativeSelect>
                  </AppFieldLabel>
                  <AppFieldLabel>
                  Amount
                  <div className="mt-1 grid grid-cols-[7.25rem_minmax(0,1fr)] gap-2">
                    <AppNativeSelect
                      value={currency}
                      onChange={(event) => setCurrency(event.target.value)}
                      className="min-w-0"
                    >
                      <option value="EUR">EUR (€)</option>
                      <option value="USD">USD ($)</option>
                    </AppNativeSelect>
                    <AppInput
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      inputMode="decimal"
                      className="min-w-0"
                      placeholder="0.00"
                      required
                    />
                  </div>
                  </AppFieldLabel>
                  <AppFieldLabel>
                  Category
                  <AppNativeSelect
                    value={categoryId}
                    onChange={(event) => setCategoryId(event.target.value)}
                    className="mt-1"
                    required
                  >
                    <option value="">Select a category</option>
                    {categoryOptions.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </AppNativeSelect>
                  </AppFieldLabel>
                  <AppFieldLabel>
                  Start date
                  <AppInput
                    type="date"
                    value={anchorDate}
                    onChange={(event) => setAnchorDate(event.target.value)}
                    className="mt-1"
                    required
                  />
                  </AppFieldLabel>
                <div className="grid grid-cols-[auto_1fr] items-end gap-2">
                    <AppFieldLabel>
                    Every
                    <AppInput
                      type="number"
                      min={1}
                      value={intervalCount}
                      onChange={(event) => setIntervalCount(event.target.value)}
                      className="mt-1 w-20"
                    />
                    </AppFieldLabel>
                    <AppFieldLabel>
                    Interval
                    <AppNativeSelect
                      value={intervalUnit}
                      onChange={(event) => setIntervalUnit(event.target.value)}
                      className="mt-1"
                    >
                      <option value="day">Day(s)</option>
                      <option value="week">Week(s)</option>
                      <option value="month">Month(s)</option>
                      <option value="year">Year(s)</option>
                    </AppNativeSelect>
                    </AppFieldLabel>
                </div>
                  <AppFieldLabel>
                  End date (optional)
                  <AppInput
                    type="date"
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                    className="mt-1"
                  />
                  </AppFieldLabel>
                <div className="flex items-center gap-3 rounded-md border border-border bg-bg px-3 py-2 text-xs text-muted">
                  <Toggle on={autoPost} onChange={setAutoPost} />
                  Post automatically
                </div>
                <label className="flex items-center gap-3 rounded-md border border-border bg-bg px-3 py-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={skipWeekends}
                    onChange={(event) => setSkipWeekends(event.target.checked)}
                    className="control-check"
                  />
                  Skip weekends
                </label>
                {showMonthPolicy && (
                    <AppFieldLabel>
                    If day doesn't exist in month
                    <AppNativeSelect
                      value={monthDayPolicy}
                      onChange={(event) => setMonthDayPolicy(event.target.value)}
                      className="mt-1"
                    >
                      <option value="snap_to_end">Post on last day</option>
                      <option value="skip">Skip that month</option>
                      <option value="carry_forward">Use previous month's day</option>
                    </AppNativeSelect>
                    </AppFieldLabel>
                )}
                <div className="rounded-lg border border-border bg-bg p-3">
                  <p className="text-xs font-semibold text-muted">Upcoming</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
                    {previewLoading && <span className="text-muted">Calculating…</span>}
                    {previewError && <span>{previewError}</span>}
                    {!previewLoading && !previewError && preview.length === 0 && (
                      <span className="text-muted">
                        {anchorDate ? "No upcoming dates." : "Enter a start date."}
                      </span>
                    )}
                    {!previewError &&
                      preview.map((occurrence) => (
                        <span
                          key={occurrence}
                          className="rounded-sm bg-surface-hi px-2 py-1"
                        >
                          {formatEuroDate(occurrence)}
                        </span>
                      ))}
                  </div>
                </div>
                {formError && (
                  <p className="text-xs text-semantic-red">{formError}</p>
                )}
                <div className="flex gap-2">
                    <AppButton
                    type="submit"
                    className="flex-1"
                    disabled={createMutation.isPending || updateMutation.isPending}
                  >
                    {editingId
                      ? updateMutation.isPending
                        ? "Saving…"
                        : "Update rule"
                      : createMutation.isPending
                        ? "Saving…"
                        : "Save rule"}
                    </AppButton>
                  {editingId && (
                      <AppButton type="button" onClick={resetForm} tone="ghost">
                      Cancel
                      </AppButton>
                  )}
                </div>
                </div>
              </form>
            </AppCard>
          </div>
        </>
      )}

      {activeView === "audit" && (
        <>
          <AppCard className="p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              Subscription Audit
            </p>
            <p className="mt-1 text-sm text-muted">
              You are committed to spending {formatCurrency(data.stats.total_monthly_expenses * 12)} € over the next 12 months on recurring expenses.
            </p>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-border bg-bg p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Monthly total
                </p>
                <p className="font-mono text-2xl font-semibold text-semantic-red">
                  {formatCurrency(data.stats.total_monthly_expenses)} €
                </p>
              </div>
              <div className="rounded-lg border border-border bg-bg p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Annual total
                </p>
                <p className="font-mono text-2xl font-semibold text-semantic-red">
                  {formatCurrency(data.stats.total_monthly_expenses * 12)} €
                </p>
              </div>
              <div className="rounded-lg border border-border bg-bg p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  5-year total
                </p>
                <p className="font-mono text-2xl font-semibold text-semantic-red">
                  {formatCurrency(data.stats.total_monthly_expenses * 60)} €
                </p>
              </div>
            </div>

            <div className="mt-5">
              <DonutChart
                title="Annual expense mix"
                breakdown={annualDonut}
                emptyMessage="No expense rules"
                iconMap={iconMap}
              />
            </div>
          </AppCard>

          <AppCard className="p-5">
            <h2 className="font-head text-lg font-bold">True cost</h2>

            {expenseRules.length === 0 ? (
              <p className="mt-4 text-sm text-muted">No expense recurring rules.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border text-left text-xs uppercase text-muted">
                    <tr>
                      <th className="px-2 py-2">Service</th>
                      <th className="px-2 py-2">Frequency</th>
                      <th className="px-2 py-2">Next charge</th>
                      <th className="px-2 py-2 text-right">Per month</th>
                      <th className="px-2 py-2 text-right">Per year</th>
                      <th className="px-2 py-2 text-right">5-year cost</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {expenseRules.map((rule) => {
                      const serviceName = rule.name || rule.category?.name || "Untitled"
                      const perMonth = rule.monthly_equivalent_cents
                      const perYear = perMonth * 12
                      const fiveYears = perMonth * 60
                      const daily = fiveYears / 1825
                      const weekly = fiveYears / 260
                      const isExpanded = evaluatingRuleId === rule.id

                      return (
                        <Fragment key={rule.id}>
                          <tr>
                            <td className="px-2 py-3">
                              <div className="flex items-center gap-2">
                                <CategoryIcon icon={rule.category?.icon ?? null} />
                                <span className="font-semibold text-text">{serviceName}</span>
                              </div>
                            </td>
                            <td className="px-2 py-3 text-muted">{frequencyLabel(rule)}</td>
                            <td className="px-2 py-3 text-muted">{formatEuroDate(rule.next_occurrence)}</td>
                            <td className="px-2 py-3 text-right font-mono text-text">
                              {formatCurrency(perMonth)} €
                            </td>
                            <td className="px-2 py-3 text-right font-mono text-text">
                              {formatCurrency(perYear)} €
                            </td>
                            <td className="px-2 py-3 text-right font-mono font-semibold text-semantic-red">
                              {formatCurrency(fiveYears)} €
                            </td>
                            <td className="px-2 py-3 text-right">
                              <AppButton
                                type="button"
                                onClick={() =>
                                  setEvaluatingRuleId((current) =>
                                    current === rule.id ? null : rule.id
                                  )
                                }
                                tone="ghost"
                                className="px-2 py-1 text-xs"
                              >
                                Evaluate
                              </AppButton>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr>
                              <td className="px-2 pb-4" colSpan={7}>
                                <div className="rounded-lg border border-border bg-bg p-3">
                                  <p className="font-semibold text-text">
                                    Canceling {serviceName} saves you {formatCurrency(fiveYears)} € over the next 5 years.
                                  </p>
                                  <p className="mt-1 text-sm text-muted">
                                    That's equivalent to {(daily / 100).toFixed(2)} € per day, or {Math.round(weekly / 100)} € per week.
                                  </p>
                                  <AppFieldLabel className="mt-3">
                                    What would you replace this with?
                                    <AppInput
                                      value={replacementNotes[rule.id] || ""}
                                      onChange={(event) =>
                                        setReplacementNotes((current) => ({
                                          ...current,
                                          [rule.id]: event.target.value,
                                        }))
                                      }
                                      className="mt-1"
                                      placeholder="Optional"
                                    />
                                  </AppFieldLabel>
                                  <div className="mt-3 flex gap-2">
                                    <AppButton
                                      type="button"
                                      onClick={() => deleteMutation.mutate(rule.id)}
                                      tone="danger"
                                      disabled={deleteMutation.isPending}
                                    >
                                      I canceled it
                                    </AppButton>
                                    <AppButton
                                      type="button"
                                      onClick={() => setEvaluatingRuleId(null)}
                                      tone="ghost"
                                    >
                                      Keep it
                                    </AppButton>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </AppCard>
        </>
      )}
    </section>
  )
}

export default RecurringRulesPage
