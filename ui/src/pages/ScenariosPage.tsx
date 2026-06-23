import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { CurrencyCircleDollarIcon } from "@phosphor-icons/react/CurrencyCircleDollar"
import { ListDashesIcon } from "@phosphor-icons/react/ListDashes"
import { PencilLineIcon } from "@phosphor-icons/react/PencilLine"
import { SlidersHorizontalIcon } from "@phosphor-icons/react/SlidersHorizontal"
import { SparkleIcon } from "@phosphor-icons/react/Sparkle"
import { TrashIcon } from "@phosphor-icons/react/Trash"
import { useSearchParams } from "react-router-dom"
import { apiFetch } from "../app/api"
import { formatCurrency } from "../app/format"
import LineChart from "../components/charts/LineChart"
import { readThemeAlpha, readThemeColor } from "../components/charts/chartSetup"
import PageIntro from "../components/PageIntro"
import { buildSearchParams } from "../lib/searchParams"
import { AppButton } from "../components/ui/product-button"
import { AppCard } from "../components/ui/product-card"
import { useThemePreference } from "../theme/useThemePreference"

type ForecastMonth = {
  month: string
  end_balance_cents: number
}

type ForecastProjection = {
  mode: "recurring" | "full"
  start_balance_cents: number
  months: ForecastMonth[]
  summary: {
    projected_balance_cents: number
    average_monthly_net_cents: number
    months_until_negative: number | null
  }
}

type ScenarioResponse = ForecastProjection & {
  horizon: number
  baseline: ForecastProjection
  impact: {
    final_delta_cents: number
    average_monthly_delta_cents: number
    monthly_delta: Array<{ month: string; delta_end_balance_cents: number }>
    by_modification: Array<{
      index: number
      label: string
      final_delta_cents: number
      average_monthly_delta_cents: number
      monthly_delta: Array<{ month: string; delta_end_balance_cents: number }>
    }>
  }
}

type ForecastBaselineResponse = {
  summary: {
    projected_balance_cents: number
  }
}

type RuleRow = {
  id: number
  name: string | null
  type: "income" | "expense"
  amount_cents: number
}

type CategoryRow = {
  id: number
  name: string
  type: "income" | "expense"
}

type RecurringResponse = {
  rules: RuleRow[]
  categories: CategoryRow[]
}

type ScenarioModification =
  | { id: string; type: "remove_rule"; rule_id: number }
  | {
      id: string
      type: "add_rule"
      name: string
      tx_type: "income" | "expense"
      amount_cents: number
      interval: "monthly" | "yearly" | "weekly"
    }
  | {
      id: string
      type: "modify_rule"
      rule_id: number
      new_amount_cents: number
      effective_month: string
    }
  | {
      id: string
      type: "one_time"
      name: string
      tx_type: "income" | "expense"
      amount_cents: number
      month: string
    }
  | {
      id: string
      type: "adjust_category"
      category_id: number
      new_monthly_cents: number
    }

function monthLabel(month: string): string {
  const value = new Date(`${month}-01T00:00:00`)
  return value.toLocaleDateString("en-GB", { month: "short", year: "numeric" })
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function parseAmount(raw: string): number | null {
  const normalized = raw.trim().replace(/\s/g, "").replace(",", ".")
  if (!normalized) {
    return null
  }
  const value = Number(normalized)
  if (!Number.isFinite(value) || value < 0) {
    return null
  }
  return Math.round(value * 100)
}

function nextMonthValue(): string {
  const now = new Date()
  const value = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, "0")
  return `${year}-${month}`
}

function ScenariosPage() {
  useThemePreference()
  const [searchParams, setSearchParams] = useSearchParams()
  const [modifications, setModifications] = useState<ScenarioModification[]>([])
  const [selectedType, setSelectedType] = useState<
    "remove_rule" | "add_rule" | "modify_rule" | "one_time" | "adjust_category"
  >("remove_rule")
  const [removeRuleId, setRemoveRuleId] = useState("")
  const [addName, setAddName] = useState("")
  const [addType, setAddType] = useState<"income" | "expense">("expense")
  const [addAmount, setAddAmount] = useState("")
  const [addInterval, setAddInterval] = useState<"monthly" | "yearly" | "weekly">(
    "monthly"
  )
  const [modifyRuleId, setModifyRuleId] = useState("")
  const [modifyAmount, setModifyAmount] = useState("")
  const [modifyMonth, setModifyMonth] = useState(nextMonthValue)
  const [oneTimeName, setOneTimeName] = useState("")
  const [oneTimeType, setOneTimeType] = useState<"income" | "expense">("expense")
  const [oneTimeAmount, setOneTimeAmount] = useState("")
  const [oneTimeMonth, setOneTimeMonth] = useState(nextMonthValue)
  const [adjustCategoryId, setAdjustCategoryId] = useState("")
  const [adjustAmount, setAdjustAmount] = useState("")
  const [formError, setFormError] = useState("")

  const horizonRaw = Number(searchParams.get("horizon") || "6")
  const horizon = [3, 6, 12].includes(horizonRaw) ? horizonRaw : 6
  const modeRaw = (searchParams.get("mode") || "full").toLowerCase()
  const mode: "recurring" | "full" =
    modeRaw === "recurring" ? "recurring" : "full"

  const { data: recurringData } = useQuery({
    queryKey: ["recurring"],
    queryFn: () => apiFetch<RecurringResponse>("/api/recurring"),
  })

  const ruleOptions = recurringData?.rules ?? []
  const expenseCategories =
    recurringData?.categories.filter((row) => row.type === "expense") ?? []

  const requestModifications = useMemo(
    () =>
      modifications.map((mod) => {
        switch (mod.type) {
          case "remove_rule":
            return { type: mod.type, rule_id: mod.rule_id }
          case "add_rule":
            return {
              type: mod.type,
              name: mod.name,
              tx_type: mod.tx_type,
              amount_cents: mod.amount_cents,
              interval: mod.interval,
            }
          case "modify_rule":
            return {
              type: mod.type,
              rule_id: mod.rule_id,
              new_amount_cents: mod.new_amount_cents,
              effective_month: mod.effective_month,
            }
          case "one_time":
            return {
              type: mod.type,
              name: mod.name,
              tx_type: mod.tx_type,
              amount_cents: mod.amount_cents,
              month: mod.month,
            }
          case "adjust_category":
            return {
              type: mod.type,
              category_id: mod.category_id,
              new_monthly_cents: mod.new_monthly_cents,
            }
        }
      }),
    [modifications]
  )
  const serializedModifications = useMemo(
    () => JSON.stringify(requestModifications),
    [requestModifications]
  )

  const {
    data: baselineData,
    isLoading: baselineLoading,
    error: baselineError,
  } = useQuery({
    queryKey: ["forecast", "baseline", horizon, mode],
    queryFn: () =>
      apiFetch<ForecastProjection>(
        `/api/forecast?horizon=${horizon}&mode=${mode}`
      ),
  })
  const { data: scenarioData, isFetching: scenarioFetching } = useQuery({
    queryKey: ["forecast", "scenario", horizon, mode, serializedModifications],
    queryFn: () =>
      apiFetch<ScenarioResponse>(`/api/forecast/scenario?mode=${mode}`, {
        method: "POST",
        body: JSON.stringify({
          horizon,
          modifications: requestModifications,
        }),
      }),
    enabled: modifications.length > 0,
  })
  const { data: baseline12 } = useQuery({
    queryKey: ["forecast", "baseline-12"],
    queryFn: () =>
      apiFetch<ForecastBaselineResponse>("/api/forecast?horizon=12&mode=full"),
  })

  const setHorizon = (value: 3 | 6 | 12) =>
    setSearchParams(buildSearchParams(searchParams, { horizon: String(value) }))

  const setMode = (value: "recurring" | "full") =>
    setSearchParams(buildSearchParams(searchParams, { mode: value }))

  const addModification = () => {
    setFormError("")

    if (selectedType === "remove_rule") {
      if (!removeRuleId) {
        setFormError("Select a rule to remove.")
        return
      }
      setModifications((previous) => [
        ...previous,
        {
          id: newId(),
          type: "remove_rule",
          rule_id: Number(removeRuleId),
        },
      ])
      return
    }

    if (selectedType === "add_rule") {
      const amountCents = parseAmount(addAmount)
      if (!addName.trim() || amountCents === null) {
        setFormError("Enter a valid name and amount.")
        return
      }
      setModifications((previous) => [
        ...previous,
        {
          id: newId(),
          type: "add_rule",
          name: addName.trim(),
          tx_type: addType,
          amount_cents: amountCents,
          interval: addInterval,
        },
      ])
      setAddName("")
      setAddAmount("")
      return
    }

    if (selectedType === "modify_rule") {
      const amountCents = parseAmount(modifyAmount)
      if (!modifyRuleId || !modifyMonth || amountCents === null) {
        setFormError("Select a rule, month, and valid amount.")
        return
      }
      setModifications((previous) => [
        ...previous,
        {
          id: newId(),
          type: "modify_rule",
          rule_id: Number(modifyRuleId),
          new_amount_cents: amountCents,
          effective_month: modifyMonth,
        },
      ])
      setModifyAmount("")
      return
    }

    if (selectedType === "one_time") {
      const amountCents = parseAmount(oneTimeAmount)
      if (!oneTimeName.trim() || !oneTimeMonth || amountCents === null) {
        setFormError("Enter a valid name, month, and amount.")
        return
      }
      setModifications((previous) => [
        ...previous,
        {
          id: newId(),
          type: "one_time",
          name: oneTimeName.trim(),
          tx_type: oneTimeType,
          amount_cents: amountCents,
          month: oneTimeMonth,
        },
      ])
      setOneTimeName("")
      setOneTimeAmount("")
      return
    }

    const amountCents = parseAmount(adjustAmount)
    if (!adjustCategoryId || amountCents === null) {
      setFormError("Select a category and valid monthly estimate.")
      return
    }
    setModifications((previous) => [
      ...previous,
      {
        id: newId(),
        type: "adjust_category",
        category_id: Number(adjustCategoryId),
        new_monthly_cents: amountCents,
      },
    ])
    setAdjustAmount("")
  }

  const modificationDescription = (row: ScenarioModification): string => {
    if (row.type === "remove_rule") {
      const rule = ruleOptions.find((item) => item.id === row.rule_id)
      return `Cancel ${rule?.name || "rule"}`
    }
    if (row.type === "add_rule") {
      return `Add ${row.name} (${row.interval})`
    }
    if (row.type === "modify_rule") {
      const rule = ruleOptions.find((item) => item.id === row.rule_id)
      return `Change ${rule?.name || "rule"} starting ${row.effective_month}`
    }
    if (row.type === "one_time") {
      return `${row.name} in ${row.month}`
    }
    const category = expenseCategories.find((item) => item.id === row.category_id)
    return `Adjust ${category?.name || "category"} to ${formatCurrency(row.new_monthly_cents)} €/mo`
  }

  if (baselineLoading) {
    return <div className="text-muted">Loading scenarios…</div>
  }
  if (baselineError || !baselineData) {
    return <div className="text-semantic-red">Unable to load scenario simulator.</div>
  }

  const hasAdjustments = modifications.length > 0
  const activeScenarioData = hasAdjustments ? scenarioData : undefined
  const baseline = activeScenarioData?.baseline ?? baselineData
  const scenario = activeScenarioData ?? baselineData
  const impact = activeScenarioData?.impact
  const impactMonthColumns = impact?.monthly_delta.map((row) => row.month) ?? []

  const labels = ["Now", ...baseline.months.map((row) => monthLabel(row.month))]
  const baselineSeries = [
    baseline.start_balance_cents,
    ...baseline.months.map((row) => row.end_balance_cents),
  ]
  const scenarioSeries = [
    scenario.start_balance_cents,
    ...scenario.months.map((row) => row.end_balance_cents),
  ]
  const baselineProjectedBalance =
    baseline12?.summary.projected_balance_cents ??
    baseline.summary.projected_balance_cents
  const delta = impact?.final_delta_cents ?? 0
  const baselineColor = readThemeColor("--semantic-purple", "145 157 224")
  const scenarioColor = readThemeColor("--accent", "245 185 85")
  const positiveDeltaFill = readThemeAlpha("--semantic-green", 0.18, "98 196 146")
  const negativeDeltaFill = readThemeAlpha("--semantic-red", 0.18, "224 114 102")

  return (
    <section className="space-y-6">
      <PageIntro
        title="What If"
        actions={scenarioFetching ? <span className="loading-hint">Updating…</span> : null}
      />

      <AppCard className="p-5">
        <p className="text-sm text-muted">
          Baseline: projected balance of{" "}
          <span className="font-mono text-text">
            {formatCurrency(baselineProjectedBalance)} €
          </span>{" "}
          in 12 months based on current recurring rules and spending.
        </p>
      </AppCard>

      <div className="flex flex-wrap items-center gap-3">
        <div className="pill-group">
          {[3, 6, 12].map((value) => (
            <button
              key={value}
              type="button"
              className={`pill-button ${horizon === value ? "pill-button-active" : ""}`}
              onClick={() => setHorizon(value as 3 | 6 | 12)}
            >
              {value} months
            </button>
          ))}
        </div>
        <div className="pill-group">
          <button
            type="button"
            className={`pill-button ${mode === "recurring" ? "pill-button-active" : ""}`}
            onClick={() => setMode("recurring")}
          >
            Recurring only
          </button>
          <button
            type="button"
            className={`pill-button ${mode === "full" ? "pill-button-active" : ""}`}
            onClick={() => setMode("full")}
          >
            Recurring + estimates
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <AppCard>
          <div className="border-b border-border px-4 py-3">
            <h2 className="font-head text-lg font-bold">Scenario adjustments</h2>
          </div>
          <div className="space-y-4 px-4 py-4">
            <label className="form-label">
              Adjustment type
              <select
                className="mt-1 w-full field"
                value={selectedType}
                onChange={(event) =>
                  setSelectedType(
                    event.target.value as
                      | "remove_rule"
                      | "add_rule"
                      | "modify_rule"
                      | "one_time"
                      | "adjust_category"
                  )
                }
              >
                <option value="remove_rule">Remove recurring rule</option>
                <option value="add_rule">Add recurring rule</option>
                <option value="modify_rule">Modify existing rule</option>
                <option value="one_time">One-time event</option>
                <option value="adjust_category">Adjust category estimate</option>
              </select>
            </label>

            {selectedType === "remove_rule" ? (
              <label className="form-label">
                Rule
                <select
                  className="mt-1 w-full field"
                  value={removeRuleId}
                  onChange={(event) => setRemoveRuleId(event.target.value)}
                >
                  <option value="">Select rule…</option>
                  {ruleOptions.map((rule) => (
                    <option key={rule.id} value={rule.id}>
                      {rule.name || "Recurring rule"} ({formatCurrency(rule.amount_cents)} €)
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {selectedType === "add_rule" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="form-label sm:col-span-2">
                  Name
                  <input
                    className="mt-1 w-full field"
                    value={addName}
                    onChange={(event) => setAddName(event.target.value)}
                  />
                </label>
                <label className="form-label">
                  Type
                  <select
                    className="mt-1 w-full field"
                    value={addType}
                    onChange={(event) =>
                      setAddType(event.target.value as "income" | "expense")
                    }
                  >
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                  </select>
                </label>
                <label className="form-label">
                  Interval
                  <select
                    className="mt-1 w-full field"
                    value={addInterval}
                    onChange={(event) =>
                      setAddInterval(
                        event.target.value as "monthly" | "yearly" | "weekly"
                      )
                    }
                  >
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                    <option value="weekly">Weekly</option>
                  </select>
                </label>
                <label className="form-label sm:col-span-2">
                  Amount
                  <input
                    className="mt-1 w-full field"
                    value={addAmount}
                    onChange={(event) => setAddAmount(event.target.value)}
                    placeholder="0.00"
                  />
                </label>
              </div>
            ) : null}

            {selectedType === "modify_rule" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="form-label sm:col-span-2">
                  Rule
                  <select
                    className="mt-1 w-full field"
                    value={modifyRuleId}
                    onChange={(event) => setModifyRuleId(event.target.value)}
                  >
                    <option value="">Select rule…</option>
                    {ruleOptions.map((rule) => (
                      <option key={rule.id} value={rule.id}>
                        {rule.name || "Recurring rule"} ({formatCurrency(rule.amount_cents)} €)
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-label">
                  New amount
                  <input
                    className="mt-1 w-full field"
                    value={modifyAmount}
                    onChange={(event) => setModifyAmount(event.target.value)}
                    placeholder="0.00"
                  />
                </label>
                <label className="form-label">
                  Effective month
                  <input
                    className="mt-1 w-full field"
                    type="month"
                    value={modifyMonth}
                    onChange={(event) => setModifyMonth(event.target.value)}
                  />
                </label>
              </div>
            ) : null}

            {selectedType === "one_time" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="form-label sm:col-span-2">
                  Name
                  <input
                    className="mt-1 w-full field"
                    value={oneTimeName}
                    onChange={(event) => setOneTimeName(event.target.value)}
                  />
                </label>
                <label className="form-label">
                  Type
                  <select
                    className="mt-1 w-full field"
                    value={oneTimeType}
                    onChange={(event) =>
                      setOneTimeType(event.target.value as "income" | "expense")
                    }
                  >
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                  </select>
                </label>
                <label className="form-label">
                  Month
                  <input
                    className="mt-1 w-full field"
                    type="month"
                    value={oneTimeMonth}
                    onChange={(event) => setOneTimeMonth(event.target.value)}
                  />
                </label>
                <label className="form-label sm:col-span-2">
                  Amount
                  <input
                    className="mt-1 w-full field"
                    value={oneTimeAmount}
                    onChange={(event) => setOneTimeAmount(event.target.value)}
                    placeholder="0.00"
                  />
                </label>
              </div>
            ) : null}

            {selectedType === "adjust_category" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="form-label sm:col-span-2">
                  Category
                  <select
                    className="mt-1 w-full field"
                    value={adjustCategoryId}
                    onChange={(event) => setAdjustCategoryId(event.target.value)}
                  >
                    <option value="">Select category…</option>
                    {expenseCategories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-label sm:col-span-2">
                  New monthly estimate
                  <input
                    className="mt-1 w-full field"
                    value={adjustAmount}
                    onChange={(event) => setAdjustAmount(event.target.value)}
                    placeholder="0.00"
                  />
                </label>
              </div>
            ) : null}

            {formError ? <p className="text-xs text-semantic-red">{formError}</p> : null}
            <AppButton
              type="button"
              tone="ghost"
              className="px-3 py-1.5 text-xs text-muted"
              onClick={addModification}
            >
              Add adjustment
            </AppButton>

            <div className="space-y-2 pt-2">
              {modifications.length ? (
                modifications.map((modification) => (
                  <div
                    key={modification.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg px-3 py-2"
                  >
                    <span className="flex min-w-0 items-center gap-2 text-xs text-text">
                      {modification.type === "remove_rule" ? (
                        <ListDashesIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
                      ) : null}
                      {modification.type === "add_rule" ? (
                        <CurrencyCircleDollarIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
                      ) : null}
                      {modification.type === "modify_rule" ? (
                        <PencilLineIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
                      ) : null}
                      {modification.type === "one_time" ? (
                        <SparkleIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
                      ) : null}
                      {modification.type === "adjust_category" ? (
                        <SlidersHorizontalIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
                      ) : null}
                      <span className="truncate">{modificationDescription(modification)}</span>
                    </span>
                    <AppButton
                      type="button"
                      onClick={() =>
                        setModifications((previous) =>
                          previous.filter((row) => row.id !== modification.id)
                        )
                      }
                      tone="ghost"
                      className="h-10 w-10 p-1 text-muted"
                      aria-label="Delete adjustment"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </AppButton>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted">
                  No adjustments yet. Add one to simulate impact.
                </p>
              )}
            </div>
          </div>
        </AppCard>

        {hasAdjustments ? (
          <AppCard className="p-5">
            <h2 className="font-head text-lg font-bold">Comparison</h2>
            <div className="mt-4">
              <LineChart
                labels={labels}
                series={[
                  {
                    label: "Baseline",
                    data: baselineSeries,
                    color: baselineColor,
                    dashed: true,
                  },
                  {
                    label: "Scenario",
                    data: scenarioSeries,
                    color: scenarioColor,
                    fill: 0,
                    fillColor:
                      delta >= 0 ? positiveDeltaFill : negativeDeltaFill,
                  },
                ]}
                height={320}
              />
            </div>
          </AppCard>
        ) : (
          <AppCard className="p-5">
            <h2 className="font-head text-lg font-bold">Comparison</h2>
            <p className="mt-3 text-sm text-muted">
              Add an adjustment to render scenario comparison and impact.
            </p>
          </AppCard>
        )}
      </div>

      {hasAdjustments ? (
        <AppCard className="p-5">
          <p
            className={`font-semibold ${
              delta >= 0 ? "text-semantic-green" : "text-semantic-red"
            }`}
          >
            {delta >= 0
              ? `This scenario saves ${formatCurrency(delta)} € over ${horizon} months.`
              : `This scenario costs an additional ${formatCurrency(Math.abs(delta))} € over ${horizon} months.`}
          </p>
          <p className="mt-1 text-xs text-muted">
            Average monthly delta:{" "}
            <span className="font-mono">
              {(impact?.average_monthly_delta_cents ?? 0) >= 0 ? "+" : ""}
              {formatCurrency(impact?.average_monthly_delta_cents ?? 0)} €
            </span>
          </p>

          <div className="mt-4">
            {impact?.by_modification.length ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-border text-xs">
                  <thead>
                    <tr className="text-muted">
                      <th className="py-2 pr-3 text-left font-semibold uppercase tracking-wide">
                        Modification
                      </th>
                      {impactMonthColumns.map((month) => (
                        <th
                          key={month}
                          className="px-2 py-2 text-right font-semibold uppercase tracking-wide"
                        >
                          {monthLabel(month)}
                        </th>
                      ))}
                      <th className="pl-2 py-2 text-right font-semibold uppercase tracking-wide">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {impact.by_modification.map((row) => (
                      <tr key={row.index}>
                        <td className="max-w-[18rem] py-2 pr-3 text-text">
                          <span className="break-words">{row.label}</span>
                        </td>
                        {impactMonthColumns.map((month) => {
                          const delta = row.monthly_delta.find(
                            (item) => item.month === month
                          )?.delta_end_balance_cents
                          const value = delta ?? 0
                          return (
                            <td
                              key={`${row.index}-${month}`}
                              className={`px-2 py-2 text-right font-mono ${
                                value >= 0
                                  ? "text-semantic-green"
                                  : "text-semantic-red"
                              }`}
                            >
                              {value >= 0 ? "+" : ""}
                              {formatCurrency(value)}
                            </td>
                          )
                        })}
                        <td
                          className={`pl-2 py-2 text-right font-mono font-semibold ${
                            row.final_delta_cents >= 0
                              ? "text-semantic-green"
                              : "text-semantic-red"
                          }`}
                        >
                          {row.final_delta_cents >= 0 ? "+" : ""}
                          {formatCurrency(row.final_delta_cents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="py-2 text-sm text-muted">
                Add adjustments to see impact breakdown.
              </p>
            )}
          </div>
        </AppCard>
      ) : null}
    </section>
  )
}

export default ScenariosPage
