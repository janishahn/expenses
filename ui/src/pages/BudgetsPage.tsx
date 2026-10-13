import { useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query"
import type { Icon } from "@phosphor-icons/react"
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/ArrowCounterClockwise"
import { CalendarBlankIcon } from "@phosphor-icons/react/CalendarBlank"
import { CalendarSlashIcon } from "@phosphor-icons/react/CalendarSlash"
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/ClockCounterClockwise"
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree"
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple"
import { PlusIcon } from "@phosphor-icons/react/Plus"
import { ShapesIcon } from "@phosphor-icons/react/Shapes"
import { TargetIcon } from "@phosphor-icons/react/Target"
import { TrashIcon } from "@phosphor-icons/react/Trash"
import { useSearchParams } from "react-router-dom"
import { apiFetch, getApiErrorMessage } from "../app/api"
import { amountInput, parseAmountCents } from "../app/transactions"
import { confirmDialog } from "../components/confirm"
import { Amount } from "../components/ui/Amount"
import { Button, IconButton } from "../components/ui/Button"
import { CategoryGlyph } from "../components/ui/CategoryGlyph"
import { ChartCard, ChartTable, ChartTooltip, type ChartFocus, type LegendEntry } from "../components/ui/ChartCard"
import { BudgetBar, LineChart } from "../components/ui/Charts"
import { Combobox } from "../components/ui/Combobox"
import { DayBand } from "../components/ui/DayBand"
import { EmptyState } from "../components/ui/EmptyState"
import { EntryAmount, EntryChips, EntryDialog, EntryPreview } from "../components/ui/EntryDialog"
import { useIsDesktop } from "../components/ui/layout-state"
import { Cell, List, Row, RowActions, type Columns } from "../components/ui/LedgerRow"
import { Menu, MenuItem, MenuSeparator } from "../components/ui/Menu"
import { Panel, PanelError, PanelLoading, ViewRow } from "../components/ui/Panel"
import { Peek, PeekHeadline, PeekLayout, PeekSection } from "../components/ui/Peek"
import { MonthPicker } from "../components/ui/PeriodControl"
import { Pill } from "../components/ui/Pill"
import { Popover, PopoverActions } from "../components/ui/Popover"
import { Property, PropertyButton, PropertyList } from "../components/ui/PropertyList"
import { RadioField, RadioGroup } from "../components/ui/Radio"
import { SegmentedControl } from "../components/ui/SegmentedControl"
import { MetricStrip, Sheet, type Metric } from "../components/ui/Sheet"
import { Field, FieldGrid, TextField } from "../components/ui/TextField"
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

type BudgetCategory = { id: number; name: string; type: string; icon: string | null; archived_at: string | null }

type BudgetResponse = {
  month_value: string
  budgets: BudgetRow[]
  progress: BudgetProgressRow[]
  categories: BudgetCategory[]
  templates: BudgetTemplateRow[]
  year_value: number
  yearly_budgets: BudgetRow[]
  yearly_spent: Array<{ scope_category_id: number | null; spent_cents: number }>
}

type BurndownResponse = {
  budget_amount_cents: number
  days_in_month: number
  daily_series: Array<{ day: number; cumulative_cents: number }>
  compare_daily_series: Array<{ day: number; cumulative_cents: number }>
  top_spending_days: Array<{
    day: number
    date?: string
    total_cents: number
    transactions: Array<{ id: number; title: string; amount_cents: number }>
  }>
}

type Frequency = "monthly" | "yearly"
type Kind = "month" | "year"
type BudgetRequest = { path: string; body: Record<string, unknown> }

const MONTH_LONG = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })
const MONTH_SHORT = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
const DAY_SHORT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
const WEEKDAY_SHORT = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })

const BUDGET_COLUMNS: Columns = {
  columns: "18px minmax(0, 1fr) minmax(80px, 220px) 150px 120px",
  narrowColumns: "18px minmax(0, 1fr) 72px 104px",
}
const INACTIVE_COLUMNS: Columns = {
  columns: "18px minmax(0, 1fr) 260px 28px",
  narrowColumns: "18px minmax(0, 1fr) 28px",
}
const TOP_DAY_COLUMNS = "96px minmax(0, 1fr) auto"
const EMPTY_BAND_COLUMNS = "18px minmax(0, 1fr)"

function monthDate(month: string): Date {
  const [year, index] = month.split("-").map(Number)
  return new Date(Date.UTC(year, index - 1, 1))
}

function shiftMonth(month: string, delta: number): string {
  const date = monthDate(month)
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + delta, 1)).toISOString().slice(0, 7)
}

function currentMonth(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

function monthDays(month: string): number {
  const date = monthDate(month)
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
}

// Days of the month that have passed: all of a past month, none of a future one.
function daysElapsed(month: string, now: Date): number {
  const today = currentMonth(now)
  return month < today ? monthDays(month) : month > today ? 0 : now.getDate()
}

function scopeKey(categoryId: number | null): string {
  return categoryId === null ? "overall" : String(categoryId)
}

function ratioText(ratio: number): string {
  return `${ratio.toFixed(2).replace(".", ",")}×`
}

// A projection more than 10% above the budget is over pace; only then is it shown as over.
const OVER_PACE = 1.1

function paceStatus(ratio: number): string {
  return ratio > OVER_PACE ? "Over pace" : ratio < 0.9 ? "On track" : "On pace"
}

// The active template per scope: the latest one that covers `day`.
function activeTemplates(templates: BudgetTemplateRow[], frequency: Frequency, day: string): Map<string, BudgetTemplateRow> {
  const active = new Map<string, BudgetTemplateRow>()
  for (const template of templates
    .filter((row) => row.frequency === frequency && row.starts_on <= day && (!row.ends_on || row.ends_on >= day))
    .sort((left, right) => right.starts_on.localeCompare(left.starts_on))) {
    const key = scopeKey(template.category?.id ?? null)
    if (!active.has(key)) active.set(key, template)
  }
  return active
}

function useBurndown(month: string, scope: string | null, compare: boolean) {
  return useQuery({
    queryKey: ["budgets", "burndown", month, scope, compare],
    enabled: scope !== null,
    queryFn: () =>
      apiFetch<BurndownResponse>(
        `/api/budgets/burndown?month=${month}&scope=${scope}${compare ? `&compare_month=${shiftMonth(month, -1)}` : ""}`
      ),
  })
}

// Budgets also show on the Dashboard and in the Insights budget history.
function invalidateBudgetViews(queryClient: QueryClient) {
  for (const key of ["budgets", "dashboard", "insights"]) {
    void queryClient.invalidateQueries({ queryKey: [key] })
  }
}

function useSaveBudget(onSaved: () => void, onFailed: (message: string) => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: BudgetRequest) => apiFetch(request.path, { method: "POST", body: JSON.stringify(request.body) }),
    onSuccess: () => {
      onSaved()
      invalidateBudgetViews(queryClient)
    },
    onError: (error) => onFailed(getApiErrorMessage(error, "Could not save the budget.")),
  })
}

// Cumulative spending by day against an even pace to the budget, with the previous month when compared.
function paceLines(data: BurndownResponse, elapsed: number) {
  const days = Array.from({ length: data.days_in_month }, (_, index) => index + 1)
  const actual = new Map(data.daily_series.map((row) => [row.day, row.cumulative_cents]))
  const previous = new Map(data.compare_daily_series.map((row) => [row.day, row.cumulative_cents]))
  return {
    days,
    even: days.map((day) => Math.round((data.budget_amount_cents * day) / data.days_in_month)),
    actual: days.map((day) => (day <= elapsed ? (actual.get(day) ?? null) : null)),
    previous: data.compare_daily_series.length ? days.map((day) => previous.get(day) ?? null) : [],
  }
}

function PaceChart({
  data,
  month,
  elapsed,
  height,
  xEvery,
  focus,
}: {
  data: BurndownResponse
  month: string
  elapsed: number
  height: number
  xEvery: number
  focus?: ChartFocus
}) {
  const lines = paceLines(data, elapsed)
  const start = monthDate(month)
  const dayDate = (day: number) => new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), day))
  return (
    <LineChart
      labels={lines.days.map(String)}
      height={height}
      xEvery={xEvery}
      mark={elapsed > 0 && elapsed < data.days_in_month ? elapsed - 1 : undefined}
      idle={elapsed > 0 ? elapsed - 1 : undefined}
      focus={focus}
      series={[
        { key: "even", values: lines.even, color: "var(--ink-3)", dash: true, width: 1.25 },
        ...(lines.previous.length ? [{ key: "previous", values: lines.previous, color: "var(--ink-3)", width: 1.25 }] : []),
        { key: "actual", values: lines.actual },
      ]}
      tooltip={(index) => (
        <ChartTooltip
          title={DAY_SHORT.format(dayDate(index + 1))}
          rows={[
            { key: "even", label: "Even pace", value: <Amount cents={lines.even[index]} decimals={false} />, color: "var(--ink-3)", mark: "dash" },
            ...(lines.actual[index] !== null
              ? [{ key: "actual", label: "Actual", value: <Amount cents={lines.actual[index] as number} decimals={false} />, color: "var(--ink)", mark: "line" as const }]
              : []),
            ...(lines.previous[index] != null
              ? [{ key: "previous", label: "Previous month", value: <Amount cents={lines.previous[index] as number} decimals={false} />, color: "var(--ink-3)", mark: "line" as const }]
              : []),
          ]}
        />
      )}
    />
  )
}

function OverallPace({
  month,
  elapsed,
  onEdit,
}: {
  month: string
  elapsed: number
  onEdit: () => void
}) {
  const isDesktop = useIsDesktop()
  const [compare, setCompare] = useState(false)
  const burndown = useBurndown(month, "overall", compare)
  const lines = burndown.data ? paceLines(burndown.data, elapsed) : null
  const legend: LegendEntry[] = [
    { key: "actual", label: "Actual", color: "var(--ink)", mark: "line" },
    { key: "even", label: "Even pace", color: "var(--ink-3)", mark: "dash" },
    ...(lines?.previous.length ? [{ key: "previous", label: "Previous month", color: "var(--ink-3)", mark: "line" as const }] : []),
  ]
  return (
    <ChartCard
      title="Overall pace"
      menu={
        <>
          <MenuItem icon={ClockCounterClockwiseIcon} checked={compare} onSelect={() => setCompare(!compare)}>
            Compare previous month
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={PencilSimpleIcon} onSelect={onEdit}>
            Edit overall budget
          </MenuItem>
        </>
      }
      legend={legend}
      empty={burndown.isError ? "The pace chart is unavailable." : burndown.data ? undefined : "Loading…"}
      table={
        lines ? (
          <ChartTable
            label="Overall pace by day"
            columns={["Day", "Even pace", "Actual", ...(lines.previous.length ? ["Previous month"] : [])]}
            rows={lines.days.map((day, index) => ({
              key: String(day),
              cells: [
                String(day),
                <Amount cents={lines.even[index]} />,
                lines.actual[index] === null ? "–" : <Amount cents={lines.actual[index] as number} />,
                ...(lines.previous.length
                  ? [lines.previous[index] === null ? "–" : <Amount cents={lines.previous[index] as number} />]
                  : []),
              ],
            }))}
          />
        ) : null
      }
    >
      {(focus) =>
        burndown.data ? (
          <PaceChart data={burndown.data} month={month} elapsed={elapsed} height={150} xEvery={isDesktop ? 5 : 10} focus={focus} />
        ) : null
      }
    </ChartCard>
  )
}

// The budget's amount, edited in a popover. A month's amount applies to that month only or
// becomes the usual amount from that month on; a year's amount applies from that year on.
function AmountEditor({
  kind,
  row,
  usual,
  periodLabel,
  request,
}: {
  kind: Kind
  row: BudgetRow
  usual: number | null
  periodLabel: string
  request: (cents: number, range: "period" | "later") => BudgetRequest
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState("")
  const [range, setRange] = useState<"period" | "later">("period")
  const [error, setError] = useState<string | null>(null)
  const save = useSaveBudget(() => setOpen(false), setError)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const cents = parseAmountCents(draft)
    if (cents === null) {
      setError("Enter a valid amount.")
      return
    }
    save.mutate(request(cents, kind === "year" ? "later" : range))
  }
  return (
    <Popover
      form
      label="Edit amount"
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setDraft(amountInput(row.amount_cents))
          setRange("period")
          setError(null)
        }
        setOpen(next)
      }}
      trigger={
        <PropertyButton>
          <Amount cents={row.amount_cents} />
          {usual !== null && row.source === "override" ? (
            <span>
              · usually <Amount cents={usual} />
            </span>
          ) : null}
        </PropertyButton>
      }
    >
      <form onSubmit={submit}>
        <FieldGrid narrow>
          <Field label="Amount" error={error}>
            <TextField autoFocus inputMode="decimal" suffix="€" value={draft} onChange={(event) => setDraft(event.target.value)} />
          </Field>
        </FieldGrid>
        {kind === "month" ? (
          <RadioGroup label="Apply to" value={range} onValueChange={(value) => setRange(value === "later" ? "later" : "period")}>
            <RadioField value="period">Only {periodLabel}</RadioField>
            <RadioField value="later">{periodLabel} and later</RadioField>
          </RadioGroup>
        ) : null}
        <PopoverActions>
          <Button size="small" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" size="small" variant="primary" disabled={save.isPending}>
            Save
          </Button>
        </PopoverActions>
      </form>
    </Popover>
  )
}

// A start or end in the add dialog: a month, or a year for annual budgets.
function TimingChip({
  icon,
  label,
  field,
  value,
  yearly,
  onChange,
  onClear,
}: {
  icon: Icon
  label: string
  field: string
  value: string
  yearly: boolean
  onChange: (value: string) => void
  onClear?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (draft) onChange(draft)
    setOpen(false)
  }
  return (
    <Popover
      form
      label={field}
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(value)
        setOpen(next)
      }}
      trigger={
        <Pill icon={icon} set={Boolean(onClear)} onClear={onClear} clearLabel={`Clear ${field.toLowerCase()}`}>
          {label}
        </Pill>
      }
    >
      <form onSubmit={submit}>
        <FieldGrid narrow>
          <Field label={field}>
            <TextField
              autoFocus
              type={yearly ? "number" : "month"}
              min={yearly ? 1970 : undefined}
              max={yearly ? 3000 : undefined}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </Field>
        </FieldGrid>
        <PopoverActions>
          <Button type="submit" variant="primary" size="small" disabled={!draft}>
            Done
          </Button>
        </PopoverActions>
      </form>
    </Popover>
  )
}

function AddBudgetDialog({ data, onClose }: { data: BudgetResponse; onClose: () => void }) {
  const [frequency, setFrequency] = useState<Frequency>("monthly")
  const [amount, setAmount] = useState("")
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [start, setStart] = useState(data.month_value)
  const [end, setEnd] = useState("")
  const [error, setError] = useState<string | null>(null)
  const save = useSaveBudget(onClose, setError)
  const yearly = frequency === "yearly"
  const categories = data.categories.filter((category) => category.type === "expense" && !category.archived_at)
  const category = categories.find((entry) => entry.id === categoryId)
  const timingLabel = (value: string) => (yearly ? value : MONTH_SHORT.format(monthDate(value)))

  const submit = () => {
    setError(null)
    const amountCents = parseAmountCents(amount)
    if (amountCents === null) {
      setError("Enter a valid amount.")
      return
    }
    const startsOn = yearly ? `${start}-01-01` : `${start}-01`
    const existing = data.templates.find(
      (template) =>
        template.frequency === frequency &&
        (template.category?.id ?? null) === categoryId &&
        template.starts_on <= startsOn &&
        (!template.ends_on || template.ends_on >= startsOn)
    )
    if (existing) {
      setError(
        `${existing.category?.name ?? "All expense categories"} already has a ${yearly ? "yearly" : "monthly"} budget for this period. Edit that budget instead.`
      )
      return
    }
    const body = { frequency, category_id: categoryId, amount_cents: amountCents, starts_on: startsOn }
    if (!end) {
      save.mutate({ path: "/api/budgets/templates/apply-from", body })
      return
    }
    const endsOn = yearly
      ? `${end}-12-31`
      : `${end}-${String(new Date(Date.UTC(Number(end.slice(0, 4)), Number(end.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`
    if (endsOn < startsOn) {
      setError("The end must not be before the start.")
      return
    }
    save.mutate({ path: "/api/budgets/templates", body: { ...body, ends_on: endsOn } })
  }

  return (
    <EntryDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Add budget"
      direction={
        <SegmentedControl
          label="Budget period"
          value={frequency}
          options={[
            { value: "monthly", label: "Monthly" },
            { value: "yearly", label: "Annual" },
          ]}
          onChange={(next) => {
            setFrequency(next)
            setStart(next === "monthly" ? data.month_value : String(data.year_value))
            setEnd("")
          }}
        />
      }
      submitLabel="Add budget"
      onSubmit={submit}
      pending={save.isPending}
      error={error}
    >
      <EntryAmount autoFocus placeholder="0,00 €" value={amount} onChange={(event) => setAmount(event.target.value)} />
      <EntryPreview>
        {yearly ? "Per year" : "Per month"}, from {yearly ? start : MONTH_LONG.format(monthDate(start))}
        {end ? ` until ${yearly ? end : MONTH_LONG.format(monthDate(end))}` : ""}
      </EntryPreview>
      <EntryChips>
        <Combobox
          label="Category"
          options={[
            { value: 0, label: "All expense categories" },
            ...categories.map((entry) => ({
              value: entry.id,
              label: entry.name,
              leading: <CategoryGlyph categoryId={entry.id} icon={entry.icon} name={entry.name} />,
            })),
          ]}
          selected={[categoryId ?? 0]}
          onSelect={(value) => setCategoryId(value === 0 ? null : value)}
          trigger={
            <Pill
              icon={category ? undefined : ShapesIcon}
              leading={category ? <CategoryGlyph categoryId={category.id} icon={category.icon} name={category.name} /> : undefined}
              set={Boolean(category)}
              aria-label={`Category ${category?.name ?? "All expense categories"}`}
            >
              {category?.name ?? "All expense categories"}
            </Pill>
          }
        />
        <TimingChip
          icon={CalendarBlankIcon}
          field="Starts"
          label={`From ${timingLabel(start)}`}
          value={start}
          yearly={yearly}
          onChange={setStart}
        />
        <TimingChip
          icon={CalendarSlashIcon}
          field="Ends"
          label={end ? `Until ${timingLabel(end)}` : "No end"}
          value={end || start}
          yearly={yearly}
          onChange={setEnd}
          onClear={end ? () => setEnd("") : undefined}
        />
      </EntryChips>
    </EntryDialog>
  )
}

function SpentAgainst({ spent, amount }: { spent: number; amount: number }) {
  return (
    <>
      <Amount cents={spent} decimals={false} /> of <Amount cents={amount} decimals={false} />
    </>
  )
}

function LeftOrOver({ remaining }: { remaining: number }) {
  return remaining < 0 ? (
    <>
      <Amount cents={-remaining} decimals={false} tone="over" /> over
    </>
  ) : (
    <>
      <Amount cents={remaining} decimals={false} /> left
    </>
  )
}

function BudgetsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const isDesktop = useIsDesktop()
  const [now] = useState(() => new Date())
  const [adding, setAdding] = useState(false)
  const [showInactive, setShowInactive] = useState(false)
  const [compareInPeek, setCompareInPeek] = useState(false)

  const month = searchParams.get("month") ?? currentMonth(now)
  const peekKey = searchParams.get("peek")
  const queryString = `view=workspace&month=${month}&year=${month.slice(0, 4)}`
  const { data, isLoading, error } = useQuery({
    queryKey: ["budgets", queryString],
    queryFn: () => apiFetch<BudgetResponse>(`/api/budgets?${queryString}`),
  })

  const peekTarget = (() => {
    if (!data || !peekKey) return null
    const [kind, scope] = peekKey.split(":")
    const rows = kind === "year" ? data.yearly_budgets : kind === "month" ? data.budgets : []
    const row = rows.find((entry) => scopeKey(entry.scope_category_id) === scope)
    return row ? { kind: kind as Kind, row } : null
  })()
  const peekScope = peekTarget?.kind === "month" ? scopeKey(peekTarget.row.scope_category_id) : null
  const peekBurndown = useBurndown(month, peekScope, compareInPeek)

  const remove = useMutation({
    mutationFn: (path: string) => apiFetch(path, { method: "DELETE" }),
    onSuccess: () => invalidateBudgetViews(queryClient),
  })

  if (isLoading) return <PanelLoading title="Budgets" label="Loading budgets…" />
  if (error || !data) return <PanelError title="Budgets" message="Unable to load budgets." />

  const setMonth = (next: string) => setSearchParams(buildSearchParams(searchParams, { month: next, peek: null }))
  const openPeek = (kind: Kind, row: BudgetRow) =>
    setSearchParams(buildSearchParams(searchParams, { peek: `${kind}:${scopeKey(row.scope_category_id)}` }), { replace: true })
  const closePeek = () => setSearchParams(buildSearchParams(searchParams, { peek: null }), { replace: true })

  const monthLabel = MONTH_LONG.format(monthDate(data.month_value))
  const elapsed = daysElapsed(data.month_value, now)
  const daysInMonth = monthDays(data.month_value)
  const pace = data.month_value === currentMonth(now) ? elapsed / daysInMonth : null
  const categoriesById = new Map(data.categories.map((category) => [category.id, category]))
  const progressByScope = new Map(data.progress.map((row) => [scopeKey(row.scope_category_id), row]))
  const yearlySpent = new Map(data.yearly_spent.map((row) => [scopeKey(row.scope_category_id), row.spent_cents]))
  const monthlyTemplates = activeTemplates(data.templates, "monthly", `${data.month_value}-01`)
  const yearlyTemplates = activeTemplates(data.templates, "yearly", `${data.year_value}-01-01`)
  const activeIds = new Set([...monthlyTemplates.values(), ...yearlyTemplates.values()].map((template) => template.id))
  const inactiveTemplates = data.templates.filter((template) => !activeIds.has(template.id))

  const overall = data.budgets.find((row) => row.scope_category_id === null)
  const categoryBudgets = data.budgets.filter((row) => row.scope_category_id !== null)
  const overallProgress = progressByScope.get("overall")
  const spentFor = (row: BudgetRow) => progressByScope.get(scopeKey(row.scope_category_id))?.spent_cents ?? 0
  const sum = (rows: BudgetRow[], value: (row: BudgetRow) => number) => rows.reduce((total, row) => total + value(row), 0)
  const allocation = overall?.amount_cents ?? sum(categoryBudgets, (row) => row.amount_cents)
  const spent = overallProgress?.spent_cents ?? sum(categoryBudgets, spentFor)
  const remaining = overallProgress?.remaining_cents ?? allocation - spent
  const projected =
    overallProgress?.projected_total_cents ??
    sum(categoryBudgets, (row) => progressByScope.get(scopeKey(row.scope_category_id))?.projected_total_cents ?? 0)
  const daysRemaining = daysInMonth - elapsed
  const ratio = allocation ? projected / allocation : 0
  const hasBudgets = data.budgets.length > 0 || data.yearly_budgets.length > 0

  const metrics: Metric[] = [
    {
      label: overall ? "Overall budget" : "Category budgets",
      value: <Amount cents={allocation} />,
      detail: overall ? "All expense categories" : `${categoryBudgets.length} ${categoryBudgets.length === 1 ? "category" : "categories"}`,
    },
    {
      label: "Spent",
      value: <Amount cents={spent} />,
      detail: allocation ? `${Math.round((spent / allocation) * 100)} % used` : undefined,
    },
    {
      label: remaining < 0 ? "Over" : "Left",
      value: <Amount cents={Math.abs(remaining)} tone={remaining < 0 ? "over" : undefined} />,
      detail:
        remaining > 0 && daysRemaining > 0 ? (
          <>
            <Amount cents={Math.round(remaining / daysRemaining)} /> per day
          </>
        ) : undefined,
    },
    {
      label: "Projected",
      value: <Amount cents={projected} tone={projected > allocation * OVER_PACE ? "over" : undefined} />,
      detail: elapsed === 0 ? `Pacing starts in ${monthLabel}` : `${paceStatus(ratio)} · ${ratioText(ratio)}`,
    },
  ]

  const budgetRow = (kind: Kind, row: BudgetRow) => {
    const rowSpent = kind === "month" ? spentFor(row) : (yearlySpent.get(scopeKey(row.scope_category_id)) ?? 0)
    const rowRemaining = row.amount_cents - rowSpent
    const category = row.scope_category_id === null ? undefined : categoriesById.get(row.scope_category_id)
    const key = `${kind}:${scopeKey(row.scope_category_id)}`
    return (
      <Row
        key={key}
        {...BUDGET_COLUMNS}
        label={row.scope_label}
        selected={peekKey === key}
        onOpen={() => openPeek(kind, row)}
      >
        <CategoryGlyph categoryId={row.scope_category_id} icon={category?.icon} name={row.scope_label} />
        <Cell>
          {row.scope_label}
          {row.source === "override" ? " · adjusted" : null}
        </Cell>
        <BudgetBar
          ratio={row.amount_cents ? rowSpent / row.amount_cents : 0}
          over={rowRemaining < 0}
          pace={kind === "month" ? pace : null}
        />
        <Cell align="right" tone="muted" hide="narrow">
          <SpentAgainst spent={rowSpent} amount={row.amount_cents} />
        </Cell>
        <Cell align="right">
          <LeftOrOver remaining={rowRemaining} />
        </Cell>
      </Row>
    )
  }

  const peek = (() => {
    if (!peekTarget) return null
    const { kind, row } = peekTarget
    const scope = scopeKey(row.scope_category_id)
    const category = row.scope_category_id === null ? undefined : categoriesById.get(row.scope_category_id)
    const template = (kind === "month" ? monthlyTemplates : yearlyTemplates).get(scope) ?? null
    const progress = kind === "month" ? progressByScope.get(scope) : undefined
    const rowSpent = kind === "month" ? spentFor(row) : (yearlySpent.get(scope) ?? 0)
    const periodLabel = kind === "month" ? monthLabel : String(data.year_value)
    const request = (cents: number, range: "period" | "later"): BudgetRequest =>
      kind === "month" && range === "period"
        ? {
            path: "/api/budgets/overrides",
            body: {
              year: Number(data.month_value.slice(0, 4)),
              month: Number(data.month_value.slice(5, 7)),
              category_id: row.scope_category_id,
              amount_cents: cents,
            },
          }
        : {
            path: "/api/budgets/templates/apply-from",
            body: {
              frequency: kind === "month" ? "monthly" : "yearly",
              category_id: row.scope_category_id,
              amount_cents: cents,
              starts_on: kind === "month" ? `${data.month_value}-01` : `${data.year_value}-01-01`,
            },
          }
    const removeTemplate = async (id: number) => {
      if (
        await confirmDialog({
          title: `Remove the ${row.scope_label} budget?`,
          description: "It is removed from every period it applies to.",
          confirmLabel: "Remove",
          tone: "danger",
        })
      ) {
        remove.mutate(`/api/budgets/templates/${id}`, { onSuccess: closePeek })
      }
    }
    const burndown = peekBurndown.data
    return (
      <Peek
        parent="Budgets"
        title={row.scope_label}
        onClose={closePeek}
        menu={
          <>
            {kind === "month" ? (
              <>
                <MenuItem icon={ClockCounterClockwiseIcon} checked={compareInPeek} onSelect={() => setCompareInPeek(!compareInPeek)}>
                  Compare previous month
                </MenuItem>
                <MenuSeparator />
              </>
            ) : null}
            {row.source === "override" ? (
              template ? (
                <MenuItem icon={ArrowCounterClockwiseIcon} onSelect={() => remove.mutate(`/api/budgets/overrides/${row.source_id}`)}>
                  Reset to usual <Amount cents={template.amount_cents} />
                </MenuItem>
              ) : (
                <MenuItem
                  icon={TrashIcon}
                  danger
                  onSelect={() => remove.mutate(`/api/budgets/overrides/${row.source_id}`, { onSuccess: closePeek })}
                >
                  Remove {monthLabel} budget
                </MenuItem>
              )
            ) : (
              <MenuItem icon={TrashIcon} danger onSelect={() => void removeTemplate(row.source_id)}>
                Remove budget
              </MenuItem>
            )}
          </>
        }
      >
        <PeekHeadline
          glyph={
            row.scope_category_id === null ? undefined : (
              <CategoryGlyph categoryId={row.scope_category_id} icon={category?.icon} name={row.scope_label} />
            )
          }
          title={row.scope_label}
          figure={<Amount cents={rowSpent} />}
          detail={
            <>
              of <Amount cents={row.amount_cents} />
            </>
          }
        />
        <PropertyList>
          <Property label="Amount" editable>
            <AmountEditor
              key={`${peekKey}-${row.amount_cents}`}
              kind={kind}
              row={row}
              usual={template?.amount_cents ?? null}
              periodLabel={periodLabel}
              request={request}
            />
          </Property>
          <Property label="Repeats">
            {kind === "year" ? "Every year" : row.source === "override" && !template ? `Only ${monthLabel}` : "Every month"}
          </Property>
          {template ? (
            <Property label="Started">
              {kind === "year" ? template.starts_on.slice(0, 4) : MONTH_SHORT.format(monthDate(template.starts_on.slice(0, 7)))}
            </Property>
          ) : null}
          {template?.ends_on ? (
            <Property label="Ends">
              {kind === "year" ? template.ends_on.slice(0, 4) : MONTH_SHORT.format(monthDate(template.ends_on.slice(0, 7)))}
            </Property>
          ) : null}
          {progress && progress.days_elapsed > 0 ? (
            <Property label="Projected">
              <Amount cents={progress.projected_total_cents} tone={progress.projected_total_cents > row.amount_cents * OVER_PACE ? "over" : undefined} />
            </Property>
          ) : null}
          {progress && progress.days_remaining > 0 ? (
            <Property label="Allowance">
              <span>
                <Amount cents={progress.daily_remaining_cents} /> per day
              </span>
            </Property>
          ) : null}
          {kind === "year" ? (
            <Property label={row.amount_cents - rowSpent < 0 ? "Over" : "Left"}>
              <Amount cents={Math.abs(row.amount_cents - rowSpent)} tone={row.amount_cents - rowSpent < 0 ? "over" : undefined} />
            </Property>
          ) : null}
        </PropertyList>
        {kind === "month" ? (
          <>
            <PeekSection title="Pace">
              {burndown ? (
                <PaceChart data={burndown} month={data.month_value} elapsed={elapsed} height={110} xEvery={10} />
              ) : peekBurndown.isError ? (
                <EmptyState inline>The pace chart is unavailable.</EmptyState>
              ) : null}
            </PeekSection>
            <PeekSection title="Top spending days">
              {burndown?.top_spending_days.length ? (
                <List flat label="Top spending days">
                  {burndown.top_spending_days.map((day) => (
                    <Row key={day.day} columns={TOP_DAY_COLUMNS}>
                      <Cell tone="muted">
                        {WEEKDAY_SHORT.format(
                          new Date(Date.UTC(Number(data.month_value.slice(0, 4)), Number(data.month_value.slice(5, 7)) - 1, day.day))
                        )}
                      </Cell>
                      <Cell>{day.transactions.map((transaction) => transaction.title || "Untitled").join(", ")}</Cell>
                      <Cell align="right">
                        <Amount cents={day.total_cents} kind="expense" />
                      </Cell>
                    </Row>
                  ))}
                </List>
              ) : burndown ? (
                <EmptyState inline>No spending yet</EmptyState>
              ) : null}
            </PeekSection>
          </>
        ) : null}
      </Peek>
    )
  })()

  const showList = hasBudgets || (showInactive && inactiveTemplates.length > 0)

  return (
    <Panel
      title="Budgets"
      layout="fill"
      peekOpen={peek !== null}
      actions={
        <>
          <Button variant="primary" icon={PlusIcon} aria-label="Add budget" onClick={() => setAdding(true)}>
            {isDesktop ? "Add budget" : "Add"}
          </Button>
          <Menu label="More actions" trigger={<IconButton icon={DotsThreeIcon} label="More actions" />}>
            <MenuItem
              icon={ClockCounterClockwiseIcon}
              checked={showInactive}
              onSelect={() => setShowInactive(!showInactive)}
              end={inactiveTemplates.length || undefined}
            >
              Show ended and future budgets
            </MenuItem>
          </Menu>
        </>
      }
      viewRow={
        <ViewRow>
          <MonthPicker value={data.month_value} onChange={setMonth} />
          <Button variant="ghost" disabled={data.month_value === currentMonth(now)} onClick={() => setMonth(currentMonth(now))}>
            Today
          </Button>
        </ViewRow>
      }
    >
      <PeekLayout
        scroll
        main={
          <>
            {data.budgets.length ? <MetricStrip metrics={metrics} /> : null}
            {overall ? (
              <OverallPace month={data.month_value} elapsed={elapsed} onEdit={() => openPeek("month", overall)} />
            ) : null}
            {showList ? (
              <List scroll={false} label="Budgets">
                <DayBand
                  label="Monthly"
                  end={
                    categoryBudgets.length ? (
                      <SpentAgainst spent={sum(categoryBudgets, spentFor)} amount={sum(categoryBudgets, (row) => row.amount_cents)} />
                    ) : undefined
                  }
                />
                {categoryBudgets.length ? (
                  categoryBudgets.map((row) => budgetRow("month", row))
                ) : (
                  <Row columns={EMPTY_BAND_COLUMNS}>
                    <span />
                    <Cell tone="muted">No category budgets for {monthLabel}</Cell>
                  </Row>
                )}
                <DayBand
                  label={`Annual · ${data.year_value}`}
                  end={
                    data.yearly_budgets.length ? (
                      <SpentAgainst
                        spent={sum(data.yearly_budgets, (row) => yearlySpent.get(scopeKey(row.scope_category_id)) ?? 0)}
                        amount={sum(data.yearly_budgets, (row) => row.amount_cents)}
                      />
                    ) : undefined
                  }
                />
                {data.yearly_budgets.length ? (
                  data.yearly_budgets.map((row) => budgetRow("year", row))
                ) : (
                  <Row columns={EMPTY_BAND_COLUMNS}>
                    <span />
                    <Cell tone="muted">No annual budgets for {data.year_value}</Cell>
                  </Row>
                )}
                {showInactive && inactiveTemplates.length ? (
                  <>
                    <DayBand label="Ended and future" />
                    {inactiveTemplates.map((template) => {
                      const label = template.category?.name ?? "All expense categories"
                      const yearlyTemplate = template.frequency === "yearly"
                      const period = (date: string) =>
                        yearlyTemplate ? date.slice(0, 4) : MONTH_SHORT.format(monthDate(date.slice(0, 7)))
                      return (
                        <Row key={template.id} {...INACTIVE_COLUMNS} dim label={label}>
                          <CategoryGlyph categoryId={template.category?.id} icon={template.category?.icon} name={label} />
                          <Cell>
                            {label} · <Amount cents={template.amount_cents} decimals={false} /> per {yearlyTemplate ? "year" : "month"}
                          </Cell>
                          <Cell align="right" tone="muted" hide="narrow">
                            {period(template.starts_on)}
                            {template.ends_on ? ` – ${period(template.ends_on)}` : " onward"}
                          </Cell>
                          <RowActions>
                            <IconButton
                              icon={TrashIcon}
                              size="small"
                              label={`Remove the ${label} budget`}
                              onClick={async () => {
                                if (
                                  await confirmDialog({
                                    title: `Remove the ${label} budget?`,
                                    confirmLabel: "Remove",
                                    tone: "danger",
                                  })
                                ) {
                                  remove.mutate(`/api/budgets/templates/${template.id}`)
                                }
                              }}
                            />
                          </RowActions>
                        </Row>
                      )
                    })}
                  </>
                ) : null}
              </List>
            ) : (
              <Sheet>
                <EmptyState
                  icon={TargetIcon}
                  action={
                    <Button variant="quiet" icon={PlusIcon} onClick={() => setAdding(true)}>
                      Add budget
                    </Button>
                  }
                >
                  No budgets for {monthLabel}
                </EmptyState>
              </Sheet>
            )}
          </>
        }
        peek={peek}
      />
      {adding ? <AddBudgetDialog data={data} onClose={() => setAdding(false)} /> : null}
    </Panel>
  )
}

export default BudgetsPage
