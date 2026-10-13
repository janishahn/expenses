import { useState, type ReactNode } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import type { Icon } from "@phosphor-icons/react"
import { CalendarDotIcon } from "@phosphor-icons/react/CalendarDot"
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree"
import { EraserIcon } from "@phosphor-icons/react/Eraser"
import { MinusCircleIcon } from "@phosphor-icons/react/MinusCircle"
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple"
import { PlusIcon } from "@phosphor-icons/react/Plus"
import { PlusCircleIcon } from "@phosphor-icons/react/PlusCircle"
import { SlidersHorizontalIcon } from "@phosphor-icons/react/SlidersHorizontal"
import { WarningIcon } from "@phosphor-icons/react/Warning"
import { XIcon } from "@phosphor-icons/react/X"
import { useSearchParams } from "react-router-dom"
import { apiFetch } from "../app/api"
import { formatAmount, formatAmountPrivate } from "../app/format"
import { usePrivacy } from "../app/privacy"
import { Amount } from "../components/ui/Amount"
import { Button, IconButton } from "../components/ui/Button"
import { IconGlyph } from "../components/ui/CategoryGlyph"
import { ChartCard, ChartTable, ChartTooltip, type LegendEntry } from "../components/ui/ChartCard"
import { LineChart } from "../components/ui/Charts"
import { EmptyState, Status } from "../components/ui/EmptyState"
import { useIsDesktop } from "../components/ui/layout-state"
import { Cell, List, ListHead, Row, RowActions, type Columns } from "../components/ui/LedgerRow"
import { Menu, MenuItem } from "../components/ui/Menu"
import { Panel, PanelError, PanelLoading, ViewRow } from "../components/ui/Panel"
import { AsideLayout } from "../components/ui/Peek"
import { MonthPicker } from "../components/ui/PeriodControl"
import { PopoverActions } from "../components/ui/Popover"
import { SegmentedControl } from "../components/ui/SegmentedControl"
import { CardForm, MetricStrip, Sheet, type Metric } from "../components/ui/Sheet"
import { Field, FieldError, FieldGrid, Select, TextField } from "../components/ui/TextField"
import { buildSearchParams } from "../lib/searchParams"

type ForecastProjection = {
  mode: "recurring" | "full"
  start_balance_cents: number
  months: Array<{ month: string; end_balance_cents: number }>
  summary: { projected_balance_cents: number }
}

type MonthlyDelta = Array<{ month: string; delta_end_balance_cents: number }>

type ScenarioResponse = ForecastProjection & {
  baseline: ForecastProjection
  impact: {
    final_delta_cents: number
    monthly_delta: MonthlyDelta
    by_modification: Array<{ index: number; final_delta_cents: number; monthly_delta: MonthlyDelta }>
  }
}

type RuleRow = { id: number; name: string | null; type: "income" | "expense"; amount_cents: number }
type CategoryRow = { id: number; name: string; type: "income" | "expense" }
type RecurringResponse = { rules: RuleRow[]; categories: CategoryRow[] }

type Direction = "income" | "expense"
type Interval = "monthly" | "yearly" | "weekly"

type ScenarioModification =
  | { id: string; type: "remove_rule"; rule_id: number }
  | { id: string; type: "add_rule"; name: string; tx_type: Direction; amount_cents: number; interval: Interval }
  | { id: string; type: "modify_rule"; rule_id: number; new_amount_cents: number; effective_month: string }
  | { id: string; type: "one_time"; name: string; tx_type: Direction; amount_cents: number; month: string }
  | { id: string; type: "adjust_category"; category_id: number; new_monthly_cents: number }

type ModificationType = ScenarioModification["type"]

type Horizon = "3" | "6" | "12"
type Mode = "recurring" | "full"

const KINDS: Array<{ type: ModificationType; label: string; icon: Icon }> = [
  { type: "remove_rule", label: "Remove a recurring rule", icon: MinusCircleIcon },
  { type: "add_rule", label: "Add a recurring rule", icon: PlusCircleIcon },
  { type: "modify_rule", label: "Change a recurring rule", icon: PencilSimpleIcon },
  { type: "one_time", label: "One-time event", icon: CalendarDotIcon },
  { type: "adjust_category", label: "Category estimate", icon: SlidersHorizontalIcon },
]
const KIND_ICON = Object.fromEntries(KINDS.map((kind) => [kind.type, kind.icon])) as Record<ModificationType, Icon>
const INTERVAL_TEXT: Record<Interval, string> = { monthly: "per month", yearly: "per year", weekly: "per week" }

const SHORT_MONTH = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" })
const MONTH_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" })

const ADJUSTMENT_COLUMNS = "18px minmax(0, 1fr) 28px"

function monthDate(month: string): Date {
  return new Date(`${month}-01T00:00:00Z`)
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function parseAmount(raw: string): number | null {
  const normalized = raw.trim().replace(/\s/g, "").replace(",", ".")
  if (!normalized) return null
  const value = Number(normalized)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 100)
}

function nextMonthValue(): string {
  const now = new Date()
  const value = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`
}

function requestModification(mod: ScenarioModification) {
  switch (mod.type) {
    case "remove_rule":
      return { type: mod.type, rule_id: mod.rule_id }
    case "add_rule":
      return { type: mod.type, name: mod.name, tx_type: mod.tx_type, amount_cents: mod.amount_cents, interval: mod.interval }
    case "modify_rule":
      return { type: mod.type, rule_id: mod.rule_id, new_amount_cents: mod.new_amount_cents, effective_month: mod.effective_month }
    case "one_time":
      return { type: mod.type, name: mod.name, tx_type: mod.tx_type, amount_cents: mod.amount_cents, month: mod.month }
    case "adjust_category":
      return { type: mod.type, category_id: mod.category_id, new_monthly_cents: mod.new_monthly_cents }
  }
}

// Per-month change from the cumulative end-balance difference, so the months add up to the total.
function monthlyChange(deltas: MonthlyDelta): number[] {
  return deltas.map((row, index) => row.delta_end_balance_cents - (index ? deltas[index - 1].delta_end_balance_cents : 0))
}

function ChangeCell({ cents }: { cents: number }) {
  return (
    <Cell align="right" hide="narrow" tone={cents ? undefined : "faint"}>
      {cents ? <Amount cents={cents} kind="signed" decimals={false} tone={cents > 0 ? "income" : undefined} /> : "–"}
    </Cell>
  )
}

function AdjustmentForm({
  type,
  rules,
  categories,
  onTypeChange,
  onAdd,
  onCancel,
}: {
  type: ModificationType
  rules: RuleRow[]
  categories: CategoryRow[]
  onTypeChange: (type: ModificationType) => void
  onAdd: (modification: ScenarioModification) => void
  onCancel: () => void
}) {
  usePrivacy()
  const [ruleId, setRuleId] = useState("")
  const [categoryId, setCategoryId] = useState("")
  const [name, setName] = useState("")
  const [direction, setDirection] = useState<Direction>("expense")
  const [repeat, setRepeat] = useState<Interval>("monthly")
  const [amount, setAmount] = useState("")
  const [month, setMonth] = useState(nextMonthValue)
  const [error, setError] = useState("")

  const submit = () => {
    const cents = parseAmount(amount)
    if (type === "remove_rule") {
      if (!ruleId) return setError("Select a rule to remove.")
      return onAdd({ id: newId(), type, rule_id: Number(ruleId) })
    }
    if (type === "add_rule") {
      if (!name.trim() || cents === null) return setError("Enter a valid name and amount.")
      return onAdd({ id: newId(), type, name: name.trim(), tx_type: direction, amount_cents: cents, interval: repeat })
    }
    if (type === "modify_rule") {
      if (!ruleId || cents === null) return setError("Select a rule, month, and valid amount.")
      return onAdd({ id: newId(), type, rule_id: Number(ruleId), new_amount_cents: cents, effective_month: month })
    }
    if (type === "one_time") {
      if (!name.trim() || cents === null) return setError("Enter a valid name, month, and amount.")
      return onAdd({ id: newId(), type, name: name.trim(), tx_type: direction, amount_cents: cents, month })
    }
    if (!categoryId || cents === null) return setError("Select a category and valid monthly estimate.")
    onAdd({ id: newId(), type, category_id: Number(categoryId), new_monthly_cents: cents })
  }

  const ruleSelect = (
    <Select value={ruleId} onChange={(event) => setRuleId(event.target.value)}>
      <option value="">Select rule…</option>
      {rules.map((rule) => (
        <option key={rule.id} value={rule.id}>
          {rule.name || "Recurring rule"} ({formatAmountPrivate(rule.amount_cents, rule.type === "income" ? "income" : "expense")})
        </option>
      ))}
    </Select>
  )
  const amountField = (label: string) => (
    <Field label={label}>
      <TextField value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0,00" suffix="€" />
    </Field>
  )
  const directionField = (
    <Field label="Type">
      <SegmentedControl
        label="Type"
        value={direction}
        options={[
          { value: "expense", label: "Expense" },
          { value: "income", label: "Income" },
        ]}
        onChange={setDirection}
      />
    </Field>
  )

  return (
    <CardForm onSubmit={submit}>
      <FieldGrid narrow>
        <Field label="Adjustment">
          <Select value={type} onChange={(event) => onTypeChange(event.target.value as ModificationType)}>
            {KINDS.map((kind) => (
              <option key={kind.type} value={kind.type}>
                {kind.label}
              </option>
            ))}
          </Select>
        </Field>
        {type === "remove_rule" ? <Field label="Rule">{ruleSelect}</Field> : null}
        {type === "add_rule" || type === "one_time" ? (
          <>
            <Field label="Name">
              <TextField value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            {directionField}
          </>
        ) : null}
        {type === "add_rule" ? (
          <>
            <Field label="Repeats">
              <Select value={repeat} onChange={(event) => setRepeat(event.target.value as Interval)}>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
                <option value="weekly">Weekly</option>
              </Select>
            </Field>
            {amountField("Amount")}
          </>
        ) : null}
        {type === "modify_rule" ? (
          <>
            <Field label="Rule">{ruleSelect}</Field>
            {amountField("New amount")}
            <Field label="From">
              <MonthPicker value={month} onChange={setMonth} />
            </Field>
          </>
        ) : null}
        {type === "one_time" ? (
          <>
            {amountField("Amount")}
            <Field label="Month">
              <MonthPicker value={month} onChange={setMonth} />
            </Field>
          </>
        ) : null}
        {type === "adjust_category" ? (
          <>
            <Field label="Category">
              <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                <option value="">Select category…</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </Field>
            {amountField("Per month")}
          </>
        ) : null}
      </FieldGrid>
      {error ? <FieldError>{error}</FieldError> : null}
      <PopoverActions>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" type="submit">
          Add
        </Button>
      </PopoverActions>
    </CardForm>
  )
}

function ScenariosPage() {
  const isDesktop = useIsDesktop()
  const [searchParams, setSearchParams] = useSearchParams()
  const [modifications, setModifications] = useState<ScenarioModification[]>([])
  const [draft, setDraft] = useState<ModificationType | null>(null)

  const horizonParam = searchParams.get("horizon")
  const horizon: Horizon = horizonParam === "3" || horizonParam === "12" ? horizonParam : "6"
  const mode: Mode = searchParams.get("mode")?.toLowerCase() === "recurring" ? "recurring" : "full"

  const recurring = useQuery({
    queryKey: ["recurring"],
    queryFn: () => apiFetch<RecurringResponse>("/api/recurring"),
  })
  const baseline = useQuery({
    queryKey: ["forecast", "baseline", Number(horizon), mode],
    queryFn: () => apiFetch<ForecastProjection>(`/api/forecast?horizon=${horizon}&mode=${mode}`),
  })
  const requested = modifications.map(requestModification)
  // The adjustments travel with their result, so rows keep their labels while a newer result loads.
  const scenario = useQuery({
    queryKey: ["forecast", "scenario", Number(horizon), mode, JSON.stringify(requested)],
    queryFn: async () => ({
      result: await apiFetch<ScenarioResponse>(`/api/forecast/scenario?mode=${mode}`, {
        method: "POST",
        body: JSON.stringify({ horizon: Number(horizon), modifications: requested }),
      }),
      adjustments: modifications,
    }),
    enabled: modifications.length > 0,
    placeholderData: keepPreviousData,
  })

  if (baseline.isLoading) return <PanelLoading title="What If" label="Loading scenarios…" />
  if (baseline.error || !baseline.data) return <PanelError title="What If" message="Unable to load scenario simulator." />

  const rules = recurring.data?.rules ?? []
  const expenseCategories = recurring.data?.categories.filter((row) => row.type === "expense") ?? []
  const update = (values: Record<string, string | null>) => setSearchParams(buildSearchParams(searchParams, values))

  const describe = (row: ScenarioModification): ReactNode => {
    const ruleName = (id: number) => rules.find((rule) => rule.id === id)?.name || "rule"
    switch (row.type) {
      case "remove_rule":
        return `Cancel ${ruleName(row.rule_id)}`
      case "add_rule":
        return (
          <>
            {row.name} at <Amount cents={row.amount_cents} kind={row.tx_type} decimals={false} /> {INTERVAL_TEXT[row.interval]}
          </>
        )
      case "modify_rule":
        return (
          <>
            {ruleName(row.rule_id)} <Amount cents={row.new_amount_cents} decimals={false} /> from{" "}
            {MONTH_YEAR.format(monthDate(row.effective_month))}
          </>
        )
      case "one_time":
        return `${row.name} in ${MONTH_YEAR.format(monthDate(row.month))}`
      case "adjust_category":
        return (
          <>
            {expenseCategories.find((category) => category.id === row.category_id)?.name ?? "Category"} at{" "}
            <Amount cents={row.new_monthly_cents} decimals={false} /> per month
          </>
        )
    }
  }

  const result = modifications.length ? scenario.data : undefined
  const base = result?.result.baseline ?? baseline.data
  const months = base.months
  const lastMonth = months[months.length - 1]
  const baselineValues = [base.start_balance_cents, ...months.map((row) => row.end_balance_cents)]
  const scenarioValues = result
    ? [result.result.start_balance_cents, ...result.result.months.map((row) => row.end_balance_cents)]
    : null
  const difference = result?.result.impact.final_delta_cents ?? null

  const labels = [
    "Now",
    ...months.map((row, index) =>
      (isDesktop && (index === 0 || row.month.endsWith("-01")) ? MONTH_YEAR : SHORT_MONTH).format(monthDate(row.month))
    ),
  ]
  const monthName = (index: number) => (index === 0 ? "Now" : MONTH_YEAR.format(monthDate(months[index - 1].month)))
  const lastName = lastMonth ? MONTH_YEAR.format(monthDate(lastMonth.month)) : null

  const metrics: Metric[] = [
    {
      label: lastName ? `Baseline in ${lastName}` : "Baseline",
      value: <Amount cents={base.summary.projected_balance_cents} />,
      detail: "current rules and spending",
    },
    {
      label: lastName ? `Scenario in ${lastName}` : "Scenario",
      value: <Amount cents={result?.result.summary.projected_balance_cents ?? base.summary.projected_balance_cents} />,
      detail: result
        ? `after ${result.adjustments.length} ${result.adjustments.length === 1 ? "adjustment" : "adjustments"}`
        : "no adjustments",
    },
    {
      label: "Difference",
      value:
        difference === null ? (
          "No changes"
        ) : (
          <Amount cents={difference} kind="signed" tone={difference > 0 ? "income" : undefined} />
        ),
      detail: `over ${horizon} months`,
    },
  ]

  const legend: LegendEntry[] = scenarioValues
    ? [
        { key: "scenario", label: "Scenario", color: "var(--ink)", mark: "line" },
        { key: "baseline", label: "Baseline", color: "var(--ink-3)", mark: "dash" },
        { key: "difference", label: "Difference", color: "var(--band)", mark: "area" },
      ]
    : [{ key: "baseline", label: "Baseline", color: "var(--ink)", mark: "line" }]

  const impact = result?.result.impact
  const impactColumns: Columns = {
    columns: `minmax(0, 1fr) repeat(${months.length}, minmax(44px, 64px)) 88px`,
    narrowColumns: "minmax(0, 1fr) 96px",
  }

  const addModification = (modification: ScenarioModification) => {
    setModifications((previous) => [...previous, modification])
    setDraft(null)
  }

  const adjustments = (
    <Sheet
      title="Adjustments"
      meta={modifications.length || undefined}
      actions={
        <Menu label="Add adjustment" trigger={<Button variant="quiet" icon={PlusIcon}>Add</Button>}>
          {KINDS.map((kind) => (
            <MenuItem key={kind.type} icon={kind.icon} onSelect={() => setDraft(kind.type)}>
              {kind.label}
            </MenuItem>
          ))}
        </Menu>
      }
    >
      {draft ? (
        <AdjustmentForm
          key={draft}
          type={draft}
          rules={rules}
          categories={expenseCategories}
          onTypeChange={setDraft}
          onAdd={addModification}
          onCancel={() => setDraft(null)}
        />
      ) : null}
      {scenario.isError ? (
        <Status icon={WarningIcon} tone="bad">
          Unable to calculate this scenario.
        </Status>
      ) : null}
      {modifications.length ? (
        <List flat label="Adjustments">
          {modifications.map((row) => (
            <Row key={row.id} columns={ADJUSTMENT_COLUMNS}>
              <IconGlyph icon={KIND_ICON[row.type]} />
              <Cell>{describe(row)}</Cell>
              <RowActions reveal={isDesktop}>
                <IconButton
                  icon={XIcon}
                  label="Remove adjustment"
                  size="small"
                  onClick={() => setModifications((previous) => previous.filter((entry) => entry.id !== row.id))}
                />
              </RowActions>
            </Row>
          ))}
        </List>
      ) : draft ? null : (
        <EmptyState inline>No adjustments</EmptyState>
      )}
    </Sheet>
  )

  return (
    <Panel
      title="What If"
      layout="fill"
      actions={
        <Menu label="More actions" trigger={<IconButton icon={DotsThreeIcon} label="More actions" />}>
          <MenuItem
            icon={EraserIcon}
            danger
            disabled={!modifications.length}
            onSelect={() => {
              setModifications([])
              setDraft(null)
            }}
          >
            Clear all adjustments
          </MenuItem>
        </Menu>
      }
      viewRow={
        <ViewRow>
          <SegmentedControl
            label="Scenario horizon"
            value={horizon}
            options={[
              { value: "3", label: isDesktop ? "3 months" : "3M" },
              { value: "6", label: isDesktop ? "6 months" : "6M" },
              { value: "12", label: isDesktop ? "12 months" : "12M" },
            ]}
            onChange={(next) => update({ horizon: next })}
          />
          <SegmentedControl
            label="Scenario model"
            value={mode}
            options={[
              { value: "recurring", label: "Recurring only" },
              { value: "full", label: "With estimates" },
            ]}
            onChange={(next) => update({ mode: next })}
          />
        </ViewRow>
      }
    >
      <AsideLayout
        aside={adjustments}
        main={
          <>
            <MetricStrip metrics={metrics} />
            <ChartCard
              title="Balance"
              meta={scenario.isFetching ? "Updating…" : undefined}
              legend={legend}
              table={
                <ChartTable
                  label="Scenario and baseline balance by month"
                  columns={scenarioValues ? ["Month", "Scenario", "Baseline", "Difference"] : ["Month", "Baseline"]}
                  rows={labels.map((_, index) => ({
                    key: String(index),
                    cells: scenarioValues
                      ? [
                          monthName(index),
                          <Amount cents={scenarioValues[index]} />,
                          <Amount cents={baselineValues[index]} />,
                          <Amount cents={scenarioValues[index] - baselineValues[index]} kind="signed" />,
                        ]
                      : [monthName(index), <Amount cents={baselineValues[index]} />],
                  }))}
                />
              }
            >
              {(focus) => (
                <LineChart
                  labels={labels}
                  height={220}
                  yAxis
                  formatY={(cents) => formatAmount(cents, "balance", false)}
                  xEvery={isDesktop || labels.length <= 7 ? 1 : 2}
                  mark={0}
                  idle={0}
                  focus={focus}
                  series={
                    scenarioValues
                      ? [
                          { key: "baseline", values: baselineValues, color: "var(--ink-3)", dash: true, width: 1.25 },
                          { key: "scenario", values: scenarioValues },
                        ]
                      : [{ key: "baseline", values: baselineValues }]
                  }
                  bands={
                    scenarioValues
                      ? [
                          {
                            key: "difference",
                            lo: baselineValues.map((value, index) => Math.min(value, scenarioValues[index])),
                            hi: baselineValues.map((value, index) => Math.max(value, scenarioValues[index])),
                          },
                        ]
                      : []
                  }
                  tooltip={(index) => (
                    <ChartTooltip
                      title={monthName(index)}
                      rows={
                        scenarioValues
                          ? [
                              {
                                key: "scenario",
                                label: "Scenario",
                                value: <Amount cents={scenarioValues[index]} />,
                                color: "var(--ink)",
                                mark: "line",
                              },
                              {
                                key: "baseline",
                                label: "Baseline",
                                value: <Amount cents={baselineValues[index]} />,
                                color: "var(--ink-3)",
                                mark: "dash",
                              },
                              {
                                key: "difference",
                                label: "Difference",
                                value: <Amount cents={scenarioValues[index] - baselineValues[index]} kind="signed" />,
                                color: "var(--band)",
                                mark: "area",
                              },
                            ]
                          : [{ key: "baseline", label: "Baseline", value: <Amount cents={baselineValues[index]} /> }]
                      }
                    />
                  )}
                />
              )}
            </ChartCard>
            {impact && result ? (
              <List scroll={false} label="Impact by adjustment">
                <ListHead {...impactColumns}>
                  <span>Adjustment</span>
                  {months.map((row) => (
                    <Cell key={row.month} align="right" hide="narrow">
                      {SHORT_MONTH.format(monthDate(row.month))}
                    </Cell>
                  ))}
                  <Cell align="right">Total</Cell>
                </ListHead>
                {impact.by_modification.map((row) => (
                  <Row key={row.index} {...impactColumns}>
                    <Cell>{result.adjustments[row.index] ? describe(result.adjustments[row.index]) : null}</Cell>
                    {monthlyChange(row.monthly_delta).map((cents, index) => (
                      <ChangeCell key={index} cents={cents} />
                    ))}
                    <Cell align="right" strong>
                      <Amount cents={row.final_delta_cents} kind="signed" decimals={false} />
                    </Cell>
                  </Row>
                ))}
                {impact.by_modification.length > 1 ? (
                  <Row {...impactColumns}>
                    <Cell strong>Total</Cell>
                    {monthlyChange(impact.monthly_delta).map((cents, index) => (
                      <ChangeCell key={index} cents={cents} />
                    ))}
                    <Cell align="right" strong>
                      <Amount
                        cents={impact.final_delta_cents}
                        kind="signed"
                        decimals={false}
                        tone={impact.final_delta_cents > 0 ? "income" : undefined}
                      />
                    </Cell>
                  </Row>
                ) : null}
              </List>
            ) : null}
          </>
        }
      />
    </Panel>
  )
}

export default ScenariosPage
