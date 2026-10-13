import { useState, type FormEvent, type ReactElement } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/ArrowsClockwise"
import { CalendarBlankIcon } from "@phosphor-icons/react/CalendarBlank"
import { CalendarSlashIcon } from "@phosphor-icons/react/CalendarSlash"
import { CalendarXIcon } from "@phosphor-icons/react/CalendarX"
import { CurrencyDollarIcon } from "@phosphor-icons/react/CurrencyDollar"
import { LightningIcon } from "@phosphor-icons/react/Lightning"
import { PlusIcon } from "@phosphor-icons/react/Plus"
import { ShapesIcon } from "@phosphor-icons/react/Shapes"
import { TrashIcon } from "@phosphor-icons/react/Trash"
import { useNavigate, useSearchParams } from "react-router-dom"
import { apiFetch, getApiErrorMessage } from "../app/api"
import { useQueuedSave } from "../app/queued-save"
import { amountInput, parseAmountCents } from "../app/transactions"
import { CategoryPicker } from "../components/CategoryPicker"
import { confirmDialog } from "../components/confirm"
import { Amount } from "../components/ui/Amount"
import { Button } from "../components/ui/Button"
import { CategoryGlyph } from "../components/ui/CategoryGlyph"
import { ChartCard, ChartTable, ChartTooltip } from "../components/ui/ChartCard"
import { Donut } from "../components/ui/Charts"
import { Combobox } from "../components/ui/Combobox"
import { DayBand } from "../components/ui/DayBand"
import { EmptyState } from "../components/ui/EmptyState"
import { EntryAmount, EntryChips, EntryDialog, EntryName, EntryPreview } from "../components/ui/EntryDialog"
import { useIsDesktop } from "../components/ui/layout-state"
import { AmountCell, Cell, List, ListHead, Row, type Columns } from "../components/ui/LedgerRow"
import { Menu, MenuItem } from "../components/ui/Menu"
import { Panel, PanelError, PanelLoading, ViewRow } from "../components/ui/Panel"
import { Peek, PeekLayout, PeekSection } from "../components/ui/Peek"
import { Pill } from "../components/ui/Pill"
import { Popover, PopoverActions } from "../components/ui/Popover"
import { InlineText, Property, PropertyButton, PropertyList } from "../components/ui/PropertyList"
import { SegmentedControl } from "../components/ui/SegmentedControl"
import { MetricStrip, Sheet } from "../components/ui/Sheet"
import { Switch } from "../components/ui/Switch"
import { TagChips } from "../components/ui/TagChip"
import { Field, FieldError, FieldGrid, Select, TextField } from "../components/ui/TextField"
import { categoryColor } from "../components/ui/tokens"
import { buildSearchParams } from "../lib/searchParams"
import {
  MONTH_DAY_POLICIES,
  fullDate,
  needsMonthDayPolicy,
  repeatsText,
  ruleLabel,
  rulePayload,
  scheduleText,
  shortDate,
  type Currency,
  type IntervalUnit,
  type MonthDayPolicy,
  type OccurrencesResponse,
  type RecurringResponse,
  type RecurringRule,
  type RulePayload,
} from "./recurring-rule"

type View = "commitments" | "audit"
type RuleField = "name" | "amount" | "type" | "category" | "currency" | "repeats" | "starts" | "ends" | "post" | "weekends"
type Schedule = { unit: IntervalUnit; count: number; policy: MonthDayPolicy }

const COMMITMENT_COLUMNS: Columns = {
  columns: "18px minmax(0, 1fr) 120px 120px 90px 20px 110px",
  narrowColumns: "18px minmax(0, 1fr) 90px 20px 110px",
  mobileColumns: "18px minmax(0, 1fr) auto auto",
}
const AUDIT_COLUMNS: Columns = {
  columns: "18px minmax(0, 1fr) 110px 80px 100px 100px 100px",
  narrowColumns: "18px minmax(0, 1fr) 100px 100px",
  mobileColumns: "18px minmax(0, 1fr) 100px",
}
const POSTED_COLUMNS = "minmax(0, 1fr) auto"
const UNITS: Array<{ value: IntervalUnit; label: string }> = [
  { value: "day", label: "Days" },
  { value: "week", label: "Weeks" },
  { value: "month", label: "Months" },
  { value: "year", label: "Years" },
]

function todayIso(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

// The next four dates of a schedule; a saved rule previews from its next occurrence.
function useUpcoming(start: string, schedule: Schedule & { skipWeekends: boolean }, anchor?: string) {
  return useQuery({
    queryKey: ["recurring", "preview", start, anchor ?? null, schedule.unit, schedule.count, schedule.policy, schedule.skipWeekends],
    queryFn: () =>
      apiFetch<{ occurrences: string[]; error?: string }>("/api/recurring/preview", {
        method: "POST",
        body: JSON.stringify({
          start_date: start,
          rule_anchor_date: anchor ?? null,
          interval_unit: schedule.unit,
          interval_count: schedule.count,
          month_day_policy: schedule.policy,
          skip_weekends: schedule.skipWeekends,
        }),
      }),
    enabled: Boolean(start),
    retry: 0,
  })
}

function DatePopover({
  label,
  value,
  trigger,
  submitLabel,
  onSave,
  clearLabel,
  onClear,
}: {
  label: string
  value: string
  trigger: ReactElement
  submitLabel: string
  onSave: (value: string) => void
  clearLabel?: string
  onClear?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setOpen(false)
    if (draft && draft !== value) onSave(draft)
  }
  return (
    <Popover
      form
      label={label}
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(value)
        setOpen(next)
      }}
      trigger={trigger}
    >
      <form onSubmit={submit}>
        <FieldGrid narrow>
          <Field label={label}>
            <TextField type="date" required autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} />
          </Field>
        </FieldGrid>
        <PopoverActions
          start={
            onClear ? (
              <Button
                variant="ghost"
                size="small"
                onClick={() => {
                  setOpen(false)
                  onClear()
                }}
              >
                {clearLabel}
              </Button>
            ) : undefined
          }
        >
          <Button type="submit" variant="primary" size="small" disabled={!draft}>
            {submitLabel}
          </Button>
        </PopoverActions>
      </form>
    </Popover>
  )
}

function RepeatsPopover({
  value,
  anchor,
  trigger,
  submitLabel,
  onSave,
}: {
  value: Schedule
  anchor: string
  trigger: ReactElement
  submitLabel: string
  onSave: (value: Schedule) => void
}) {
  const [open, setOpen] = useState(false)
  const [unit, setUnit] = useState(value.unit)
  const [count, setCount] = useState(String(value.count))
  const [policy, setPolicy] = useState(value.policy)
  const parsedCount = Number(count)
  const valid = Number.isInteger(parsedCount) && parsedCount >= 1
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (!valid) return
    setOpen(false)
    onSave({ unit, count: parsedCount, policy })
  }
  return (
    <Popover
      form
      label="Repeats"
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setUnit(value.unit)
          setCount(String(value.count))
          setPolicy(value.policy)
        }
        setOpen(next)
      }}
      trigger={trigger}
    >
      <form onSubmit={submit}>
        <FieldGrid narrow>
          <Field label="Every">
            <TextField type="number" min={1} step={1} autoFocus value={count} onChange={(event) => setCount(event.target.value)} />
          </Field>
          <Field label="Unit">
            <Select value={unit} onChange={(event) => setUnit(event.target.value as IntervalUnit)}>
              {UNITS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </Select>
          </Field>
          {anchor && needsMonthDayPolicy(unit, anchor) ? (
            <Field label="Short months">
              <Select value={policy} onChange={(event) => setPolicy(event.target.value as MonthDayPolicy)}>
                {MONTH_DAY_POLICIES.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </FieldGrid>
        <PopoverActions>
          <Button type="submit" variant="primary" size="small" disabled={!valid}>
            {submitLabel}
          </Button>
        </PopoverActions>
      </form>
    </Popover>
  )
}

function CurrencyMenu({ value, trigger, onSelect }: { value: Currency; trigger: ReactElement; onSelect: (value: Currency) => void }) {
  return (
    <Menu label="Currency" align="start" trigger={trigger}>
      <MenuItem checked={value === "EUR"} onSelect={() => onSelect("EUR")}>
        Euro (€)
      </MenuItem>
      <MenuItem checked={value === "USD"} onSelect={() => onSelect("USD")}>
        US dollar ($)
      </MenuItem>
    </Menu>
  )
}

function AddRuleDialog({ data, onClose }: { data: RecurringResponse; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [now] = useState(() => new Date())
  const [type, setType] = useState<"expense" | "income">("expense")
  const [amount, setAmount] = useState("")
  const [name, setName] = useState("")
  const [currency, setCurrency] = useState<Currency>("EUR")
  const [categoryId, setCategoryId] = useState<number | null>(
    () => data.categories.find((category) => category.type === "expense")?.id ?? null
  )
  const [schedule, setSchedule] = useState<Schedule>({ unit: "month", count: 1, policy: "snap_to_end" })
  const [start, setStart] = useState(() => todayIso(now))
  const [end, setEnd] = useState("")
  const [autoPost, setAutoPost] = useState(true)
  const [skipWeekends, setSkipWeekends] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const upcoming = useUpcoming(start, { ...schedule, skipWeekends })
  const categories = data.categories.filter((category) => category.type === type)
  const category = categories.find((entry) => entry.id === categoryId)

  const create = useMutation({
    mutationFn: (payload: RulePayload) => apiFetch("/api/recurring", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["recurring"] })
      onClose()
    },
    onError: (failure) => setError(getApiErrorMessage(failure, "Unable to add the rule.")),
  })

  const submit = () => {
    setError(null)
    const cents = parseAmountCents(amount)
    if (cents === null) return setError("Enter a valid amount.")
    if (!start) return setError("Select a start date.")
    if (categoryId === null) return setError("Select a category.")
    create.mutate({
      name: name.trim() || null,
      type,
      currency_code: currency,
      amount_cents: cents,
      category_id: categoryId,
      anchor_date: start,
      interval_unit: schedule.unit,
      interval_count: schedule.count,
      next_occurrence: start,
      end_date: end || null,
      auto_post: autoPost,
      skip_weekends: skipWeekends,
      month_day_policy: schedule.policy,
    })
  }

  const dates = (upcoming.data?.error ? [] : (upcoming.data?.occurrences ?? [])).filter((date) => !end || date <= end)

  return (
    <EntryDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Add rule"
      direction={
        <SegmentedControl
          label="Type"
          value={type}
          options={[
            { value: "expense", label: "Expense" },
            { value: "income", label: "Income" },
          ]}
          onChange={(next) => {
            setType(next)
            setCategoryId(data.categories.find((entry) => entry.type === next)?.id ?? null)
          }}
        />
      }
      submitLabel="Add rule"
      onSubmit={submit}
      pending={create.isPending}
      error={error}
    >
      <EntryAmount
        autoFocus
        placeholder={currency === "USD" ? "0,00 $" : "0,00 €"}
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
      />
      <EntryName placeholder="Name" value={name} onChange={(event) => setName(event.target.value)} />
      <EntryChips>
        <Combobox
          label="Category"
          options={categories.map((entry) => ({
            value: entry.id,
            label: entry.name,
            leading: <CategoryGlyph categoryId={entry.id} icon={entry.icon} name={entry.name} />,
          }))}
          selected={categoryId === null ? [] : [categoryId]}
          onSelect={setCategoryId}
          trigger={
            <Pill
              icon={category ? undefined : ShapesIcon}
              leading={category ? <CategoryGlyph categoryId={category.id} icon={category.icon} name={category.name} /> : undefined}
              set={Boolean(category)}
              aria-label={`Category ${category?.name ?? "none"}`}
            >
              {category?.name ?? "Category"}
            </Pill>
          }
        />
        <RepeatsPopover
          value={schedule}
          anchor={start}
          submitLabel="Done"
          onSave={setSchedule}
          trigger={
            <Pill icon={ArrowsClockwiseIcon} aria-label={`Repeats ${repeatsText(schedule.unit, schedule.count)}`}>
              {repeatsText(schedule.unit, schedule.count)}
            </Pill>
          }
        />
        <DatePopover
          label="Starts"
          value={start}
          submitLabel="Done"
          onSave={setStart}
          trigger={
            <Pill icon={CalendarBlankIcon} aria-label={`Starts ${start ? fullDate(start) : "not set"}`}>
              {start ? `From ${fullDate(start)}` : "Start date"}
            </Pill>
          }
        />
        <DatePopover
          label="Ends"
          value={end || start}
          submitLabel="Done"
          onSave={setEnd}
          trigger={
            <Pill
              icon={CalendarSlashIcon}
              set={Boolean(end)}
              onClear={end ? () => setEnd("") : undefined}
              clearLabel="Clear end date"
              aria-label={`Ends ${end ? fullDate(end) : "never"}`}
            >
              {end ? `Until ${fullDate(end)}` : "No end"}
            </Pill>
          }
        />
        <Pill icon={LightningIcon} set={autoPost} aria-pressed={autoPost} onClick={() => setAutoPost(!autoPost)}>
          Post automatically
        </Pill>
        <Pill icon={CalendarXIcon} set={skipWeekends} aria-pressed={skipWeekends} onClick={() => setSkipWeekends(!skipWeekends)}>
          Skip weekends
        </Pill>
        <CurrencyMenu
          value={currency}
          onSelect={setCurrency}
          trigger={
            <Pill icon={CurrencyDollarIcon} set={currency === "USD"} aria-label={`Currency ${currency}`}>
              {currency}
            </Pill>
          }
        />
      </EntryChips>
      <EntryPreview>
        {upcoming.data?.error
          ? upcoming.data.error
          : upcoming.isError
            ? "Preview unavailable"
            : dates.length
              ? `Next ${dates.map((date) => shortDate(date, now)).join(" · ")}`
              : null}
      </EntryPreview>
    </EntryDialog>
  )
}

function RulePeek({ rule, data, onClose }: { rule: RecurringRule; data: RecurringResponse; onClose: () => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [now] = useState(() => new Date())
  const { errors, setError, save } = useQueuedSave<RecurringRule, RulePayload, RuleField>({
    url: `/api/recurring/${rule.id}`,
    source: rule,
    toPayload: rulePayload,
    onSaved: () => void queryClient.invalidateQueries({ queryKey: ["recurring"] }),
  })
  const label = ruleLabel(rule)
  const schedule: Schedule = { unit: rule.interval_unit, count: rule.interval_count, policy: rule.month_day_policy }
  const upcoming = useUpcoming(rule.next_occurrence, { ...schedule, skipWeekends: rule.skip_weekends }, rule.anchor_date)
  const posted = useQuery({
    queryKey: ["recurring", rule.id, "occurrences"],
    queryFn: () => apiFetch<OccurrencesResponse>(`/api/recurring/${rule.id}/occurrences`),
  })
  const remove = useMutation({
    mutationFn: () => apiFetch(`/api/recurring/${rule.id}`, { method: "DELETE" }),
    onSuccess: () => {
      onClose()
      queryClient.removeQueries({ queryKey: ["recurring", rule.id] })
      void queryClient.invalidateQueries({ queryKey: ["recurring"], exact: true })
    },
  })

  const dates = (upcoming.data?.error ? [] : (upcoming.data?.occurrences ?? [])).filter(
    (date) => !rule.end_date || date <= rule.end_date
  )
  const occurrences = posted.data?.occurrences ?? []
  const category = data.categories.find((entry) => entry.id === rule.category_id) ?? rule.category
  const perYear = rule.monthly_equivalent_cents * 12

  return (
    <Peek
      parent="Recurring"
      title={label}
      onClose={onClose}
      fullViewTo={`/recurring/${rule.id}/occurrences`}
      menu={
        <MenuItem
          icon={TrashIcon}
          danger
          onSelect={async () => {
            if (await confirmDialog({ title: `Delete recurring rule "${label}"?`, confirmLabel: "Delete", tone: "danger" })) {
              remove.mutate()
            }
          }}
        >
          Delete rule
        </MenuItem>
      }
    >
      <InlineText
        variant="title"
        label="Name"
        value={rule.name ?? ""}
        placeholder={rule.category?.name ?? "Untitled"}
        error={errors.name}
        onCancel={() => setError("name", null)}
        onSave={(next) => save("name", { name: next.trim() || null })}
      />
      <InlineText
        variant="amount"
        label="Amount"
        inputMode="decimal"
        value={amountInput(rule.amount_cents)}
        display={<Amount cents={rule.amount_cents} kind={rule.type} currency={rule.currency_code} />}
        detail={repeatsText(rule.interval_unit, rule.interval_count).toLowerCase()}
        error={errors.amount}
        onCancel={() => setError("amount", null)}
        onSave={(next) => {
          const cents = parseAmountCents(next)
          if (cents === null) {
            setError("amount", "Enter a valid amount.")
            return false
          }
          return save("amount", { amount_cents: cents })
        }}
      />
      {remove.isError ? <FieldError>{getApiErrorMessage(remove.error, "Unable to delete the rule.")}</FieldError> : null}
      <PropertyList>
        <Property label="Type" editable error={errors.type}>
          <Menu label="Type" align="start" trigger={<PropertyButton>{rule.type === "expense" ? "Expense" : "Income"}</PropertyButton>}>
            {(["expense", "income"] as const).map((next) => (
              <MenuItem
                key={next}
                checked={rule.type === next}
                onSelect={() => {
                  if (rule.type === next) return
                  const fallback = data.categories.find((entry) => entry.type === next)
                  if (!fallback) {
                    setError("type", `Add an ${next} category first.`)
                    return
                  }
                  void save("type", { type: next, category_id: fallback.id })
                }}
              >
                {next === "expense" ? "Expense" : "Income"}
              </MenuItem>
            ))}
          </Menu>
        </Property>
        <Property label="Category" editable error={errors.category}>
          <CategoryPicker
            categories={data.categories.filter((entry) => entry.type === rule.type)}
            selectedId={rule.category_id}
            onSelect={(categoryId) => {
              if (categoryId !== null && categoryId !== rule.category_id) void save("category", { category_id: categoryId })
            }}
            trigger={
              <PropertyButton empty={!category}>
                {category ? (
                  <>
                    <CategoryGlyph categoryId={category.id} icon={category.icon} name={category.name} />
                    {category.name}
                  </>
                ) : (
                  "Uncategorized"
                )}
              </PropertyButton>
            }
          />
        </Property>
        <Property label="Repeats" editable error={errors.repeats}>
          <RepeatsPopover
            value={schedule}
            anchor={rule.anchor_date}
            submitLabel="Save"
            onSave={(next) =>
              void save("repeats", { interval_unit: next.unit, interval_count: next.count, month_day_policy: next.policy })
            }
            trigger={<PropertyButton>{scheduleText(rule.interval_unit, rule.interval_count, rule.anchor_date)}</PropertyButton>}
          />
        </Property>
        <Property label="Starts" editable error={errors.starts}>
          <DatePopover
            label="Starts"
            value={rule.anchor_date}
            submitLabel="Save"
            onSave={(next) => void save("starts", { anchor_date: next })}
            trigger={<PropertyButton>{fullDate(rule.anchor_date)}</PropertyButton>}
          />
        </Property>
        <Property label="Ends" editable error={errors.ends}>
          <DatePopover
            label="Ends"
            value={rule.end_date ?? rule.next_occurrence}
            submitLabel="Save"
            onSave={(next) => void save("ends", { end_date: next })}
            clearLabel="No end"
            onClear={rule.end_date ? () => void save("ends", { end_date: null }) : undefined}
            trigger={<PropertyButton empty={!rule.end_date}>{rule.end_date ? fullDate(rule.end_date) : "Never"}</PropertyButton>}
          />
        </Property>
        <Property label="Currency" editable error={errors.currency}>
          <CurrencyMenu
            value={rule.currency_code}
            onSelect={(next) => {
              if (next !== rule.currency_code) void save("currency", { currency_code: next })
            }}
            trigger={<PropertyButton>{rule.currency_code === "USD" ? "US dollar ($)" : "Euro (€)"}</PropertyButton>}
          />
        </Property>
        <Property label="Post" error={errors.post}>
          <Switch
            label="Post automatically"
            checked={rule.auto_post}
            onCheckedChange={(checked) => void save("post", { auto_post: checked })}
          />
          {rule.auto_post ? "Automatically" : "Manually"}
        </Property>
        <Property label="Weekends" error={errors.weekends}>
          <Switch
            label="Skip weekends"
            checked={rule.skip_weekends}
            onCheckedChange={(checked) => void save("weekends", { skip_weekends: checked })}
          />
          {rule.skip_weekends ? "Moved to Monday" : "Allowed"}
        </Property>
      </PropertyList>
      {rule.type === "expense" ? (
        <PeekSection title="Cost">
          <PropertyList>
            <Property label="Per day">
              <Amount cents={Math.round(perYear / 365)} />
            </Property>
            <Property label="Per year">
              <Amount cents={perYear} />
            </Property>
            <Property label="5 years">
              <Amount cents={rule.monthly_equivalent_cents * 60} />
            </Property>
          </PropertyList>
        </PeekSection>
      ) : null}
      <PeekSection title="Upcoming">
        {dates.length ? (
          <TagChips names={dates.map((date) => shortDate(date, now))} max={dates.length} />
        ) : (
          <EmptyState inline>{upcoming.isLoading ? "Loading…" : "None"}</EmptyState>
        )}
      </PeekSection>
      <PeekSection
        title="Posted"
        action={
          occurrences.length > 3 ? (
            <Button variant="ghost" size="small" onClick={() => navigate(`/recurring/${rule.id}/occurrences`)}>
              All {occurrences.length}
            </Button>
          ) : undefined
        }
      >
        {occurrences.length ? (
          <List flat label="Posted">
            {occurrences.slice(0, 3).map((occurrence) => (
              <Row
                key={occurrence.id}
                columns={POSTED_COLUMNS}
                label={occurrence.occurrence_date ? fullDate(occurrence.occurrence_date) : "Posted"}
                onOpen={() => navigate(`/transactions/${occurrence.id}`)}
              >
                <Cell tone="muted">{occurrence.occurrence_date ? fullDate(occurrence.occurrence_date) : "–"}</Cell>
                <AmountCell>
                  <Amount cents={occurrence.amount_cents} kind={rule.type} />
                </AmountCell>
              </Row>
            ))}
          </List>
        ) : (
          <EmptyState inline>{posted.isLoading ? "Loading…" : "None yet"}</EmptyState>
        )}
      </PeekSection>
    </Peek>
  )
}

function RecurringRulesPage() {
  const isDesktop = useIsDesktop()
  const [searchParams, setSearchParams] = useSearchParams()
  const [now] = useState(() => new Date())
  const [adding, setAdding] = useState(false)
  const view: View = searchParams.get("view") === "audit" ? "audit" : "commitments"
  const peekId = Number(searchParams.get("peek")) || null

  const { data, isLoading, error } = useQuery({
    queryKey: ["recurring"],
    queryFn: () => apiFetch<RecurringResponse>("/api/recurring"),
  })

  if (isLoading) return <PanelLoading title="Recurring" label="Loading recurring rules…" />
  if (error || !data) return <PanelError title="Recurring" message="Unable to load recurring rules." />

  const update = (values: Record<string, string | null>) => setSearchParams(buildSearchParams(searchParams, values))
  const closePeek = () => setSearchParams(buildSearchParams(searchParams, { peek: null }), { replace: true })
  const stats = data.stats
  const expenses = data.rules.filter((rule) => rule.type === "expense")
  const income = data.rules.filter((rule) => rule.type === "income")
  const peekRule = data.rules.find((rule) => rule.id === peekId)

  const ruleRow = (rule: RecurringRule) => (
    <Row
      key={rule.id}
      {...COMMITMENT_COLUMNS}
      label={ruleLabel(rule)}
      selected={rule.id === peekId}
      onOpen={() => update({ peek: String(rule.id) })}
    >
      <CategoryGlyph categoryId={rule.category_id} icon={rule.category?.icon} name={rule.category?.name} />
      <Cell strong>{ruleLabel(rule)}</Cell>
      <Cell tone="muted" hide="narrow">
        {rule.category?.name ?? "Uncategorized"}
      </Cell>
      <Cell tone="muted" hide="narrow">
        {repeatsText(rule.interval_unit, rule.interval_count)}
      </Cell>
      <Cell tone="muted">Next {shortDate(rule.next_occurrence, now)}</Cell>
      <Cell tone="faint" hide="mobile">
        {rule.auto_post ? <LightningIcon size={14} role="img" aria-label="Posts automatically" /> : null}
      </Cell>
      <AmountCell>
        <Amount cents={rule.amount_cents} kind={rule.type} currency={rule.currency_code} />
      </AmountCell>
    </Row>
  )

  const byCost = expenses.slice().sort((a, b) => b.monthly_equivalent_cents - a.monthly_equivalent_cents)
  const mix = Array.from(
    byCost
      .reduce((groups, rule) => {
        const entry = groups.get(rule.category_id) ?? { rule, perYear: 0 }
        entry.perYear += rule.monthly_equivalent_cents * 12
        return groups.set(rule.category_id, entry)
      }, new Map<number, { rule: RecurringRule; perYear: number }>())
      .values()
  ).sort((a, b) => b.perYear - a.perYear)
  const annualTotal = stats.total_monthly_expenses * 12
  const share = (cents: number) => `${annualTotal ? Math.round((cents / annualTotal) * 100) : 0} %`

  const commitments = data.rules.length ? (
    <>
      <MetricStrip
        metrics={[
          {
            label: "Income per month",
            value: <Amount cents={stats.total_monthly_income} kind="income" />,
            detail: `${stats.rule_counts.income} ${stats.rule_counts.income === 1 ? "rule" : "rules"}`,
          },
          {
            label: "Expenses per month",
            value: <Amount cents={stats.total_monthly_expenses} />,
            detail: `${stats.rule_counts.expense} ${stats.rule_counts.expense === 1 ? "rule" : "rules"}`,
          },
          {
            label: "Covered",
            value: `${Math.round(stats.coverage_ratio)} %`,
            detail: (
              <>
                <Amount cents={Math.abs(stats.net_monthly)} kind={stats.net_monthly >= 0 ? "income" : "expense"} decimals={false} />{" "}
                {stats.net_monthly >= 0 ? "left per month" : "short per month"}
              </>
            ),
          },
        ]}
      />
      <List scroll={false} label="Recurring rules">
        {expenses.length ? (
          <>
            <DayBand
              label="Expenses"
              end={
                <>
                  <Amount cents={stats.total_monthly_expenses} /> per month
                </>
              }
            />
            {expenses.map(ruleRow)}
          </>
        ) : null}
        {income.length ? (
          <>
            <DayBand
              label="Income"
              end={
                <>
                  <Amount cents={stats.total_monthly_income} kind="income" /> per month
                </>
              }
            />
            {income.map(ruleRow)}
          </>
        ) : null}
      </List>
    </>
  ) : null

  const audit = expenses.length ? (
    <>
      <MetricStrip
        metrics={[
          {
            label: "Per month",
            value: <Amount cents={stats.total_monthly_expenses} />,
            detail: `${expenses.length} expense ${expenses.length === 1 ? "rule" : "rules"}`,
          },
          { label: "Per year", value: <Amount cents={annualTotal} /> },
          { label: "Over 5 years", value: <Amount cents={stats.total_monthly_expenses * 60} decimals={false} /> },
        ]}
      />
      <ChartCard
        title="Annual mix"
        table={
          <ChartTable
            label="Annual cost by category"
            columns={["Category", "Per year", "Share"]}
            rows={mix.map((entry) => ({
              key: String(entry.rule.category_id),
              cells: [entry.rule.category?.name ?? "Uncategorized", <Amount cents={entry.perYear} />, share(entry.perYear)],
            }))}
          />
        }
      >
        {(focus) => (
          <Donut
            focus={focus}
            center={<Amount cents={annualTotal} decimals={false} />}
            centerLabel="per year"
            items={mix.map((entry) => ({
              key: String(entry.rule.category_id),
              label: entry.rule.category?.name ?? "Uncategorized",
              value: entry.perYear,
              color: categoryColor(entry.rule.category_id),
              amount: <Amount cents={entry.perYear} />,
              share: share(entry.perYear),
            }))}
            tooltip={(item) => <ChartTooltip rows={[{ key: item.key, label: item.label, value: item.amount, color: item.color }]} />}
          />
        )}
      </ChartCard>
      <List scroll={false} label="True cost">
        <ListHead {...AUDIT_COLUMNS}>
          <span />
          <span>Rule</span>
          <Cell hide="narrow">Repeats</Cell>
          <Cell hide="narrow">Next</Cell>
          <Cell align="right">Per month</Cell>
          <Cell align="right" hide="mobile">
            Per year
          </Cell>
          <Cell align="right" hide="narrow">
            5 years
          </Cell>
        </ListHead>
        {byCost.map((rule) => (
          <Row
            key={rule.id}
            {...AUDIT_COLUMNS}
            label={ruleLabel(rule)}
            selected={rule.id === peekId}
            onOpen={() => update({ peek: String(rule.id) })}
          >
            <CategoryGlyph categoryId={rule.category_id} icon={rule.category?.icon} name={rule.category?.name} />
            <Cell strong>{ruleLabel(rule)}</Cell>
            <Cell tone="muted" hide="narrow">
              {repeatsText(rule.interval_unit, rule.interval_count)}
            </Cell>
            <Cell tone="muted" hide="narrow">
              {shortDate(rule.next_occurrence, now)}
            </Cell>
            <Cell align="right">
              <Amount cents={rule.monthly_equivalent_cents} />
            </Cell>
            <Cell align="right" tone="muted" hide="mobile">
              <Amount cents={rule.monthly_equivalent_cents * 12} decimals={false} />
            </Cell>
            <Cell align="right" tone="muted" hide="narrow">
              <Amount cents={rule.monthly_equivalent_cents * 60} decimals={false} />
            </Cell>
          </Row>
        ))}
      </List>
    </>
  ) : null

  const empty = (
    <Sheet>
      <EmptyState
        icon={ArrowsClockwiseIcon}
        action={
          <Button variant="primary" icon={PlusIcon} onClick={() => setAdding(true)}>
            Add rule
          </Button>
        }
      >
        {view === "audit" && data.rules.length ? "No recurring expenses." : "No recurring rules yet."}
      </EmptyState>
    </Sheet>
  )

  const peek = peekRule ? <RulePeek key={peekRule.id} rule={peekRule} data={data} onClose={closePeek} /> : null

  return (
    <Panel
      title="Recurring"
      layout="fill"
      peekOpen={peek !== null}
      actions={
        <Button variant="primary" icon={PlusIcon} aria-label="Add rule" onClick={() => setAdding(true)}>
          {isDesktop ? "Add rule" : "Add"}
        </Button>
      }
      viewRow={
        <ViewRow>
          <SegmentedControl
            label="Recurring view"
            value={view}
            options={[
              { value: "commitments", label: "Commitments" },
              { value: "audit", label: "Audit" },
            ]}
            onChange={(next) => update({ view: next === "audit" ? "audit" : null })}
          />
        </ViewRow>
      }
    >
      <PeekLayout scroll peek={peek} main={(view === "audit" ? audit : commitments) ?? empty} />
      {adding ? <AddRuleDialog data={data} onClose={() => setAdding(false)} /> : null}
    </Panel>
  )
}

export default RecurringRulesPage
