import { useEffect, useState, type FormEvent, type ReactNode } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowBendUpLeftIcon } from "@phosphor-icons/react/ArrowBendUpLeft"
import { BankIcon } from "@phosphor-icons/react/Bank"
import { LinkSimpleIcon } from "@phosphor-icons/react/LinkSimple"
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass"
import { MapPinIcon } from "@phosphor-icons/react/MapPin"
import { PackageIcon } from "@phosphor-icons/react/Package"
import { PlusIcon } from "@phosphor-icons/react/Plus"
import { ReceiptIcon } from "@phosphor-icons/react/Receipt"
import { TrashIcon } from "@phosphor-icons/react/Trash"
import { XIcon } from "@phosphor-icons/react/X"
import { useNavigate } from "react-router-dom"
import { apiFetch, getApiErrorMessage, isApiErrorStatus } from "../app/api"
import type {
  OpenReimbursementsResponse,
  ReimbursementExpenseSearchResponse,
  ReimbursementExpenseSearchResult,
  TransactionReimbursementsIncome,
} from "../app/api-types"
import { formatAmountPrivate, formatCoordinate } from "../app/format"
import {
  amountInput,
  invalidateTransactionData,
  occurredAtInput,
  occurredLabel,
  parseAmountCents,
  receiptFiles,
  shortDateLabel,
} from "../app/transactions"
import { CategoryPicker } from "../components/CategoryPicker"
import { TagPicker } from "../components/TagPicker"
import { Amount } from "../components/ui/Amount"
import { Button, IconButton } from "../components/ui/Button"
import { CategoryGlyph } from "../components/ui/CategoryGlyph"
import { Cell, List, Row, RowActions } from "../components/ui/LedgerRow"
import { LocationMap } from "../components/ui/LocationMap"
import { Menu, MenuItem, MenuSeparator } from "../components/ui/Menu"
import { Notes } from "../components/ui/Notes"
import { Peek, PeekSection } from "../components/ui/Peek"
import { Popover, PopoverActions } from "../components/ui/Popover"
import { InlineText, Property, PropertyButton, PropertyLink, PropertyList } from "../components/ui/PropertyList"
import { ReceiptSection } from "../components/ui/ReceiptSection"
import { Status } from "../components/ui/EmptyState"
import { Switch } from "../components/ui/Switch"
import { TagChip } from "../components/ui/TagChip"
import { Field, FieldError, FieldGrid, Select, TextField } from "../components/ui/TextField"
import { useTransactionRecord, type DurableInput, type TransactionRecordState } from "./transaction-record"

type LinkTo = (transactionId: number) => string

const LIFESPANS = [
  { days: 182, label: "6 months" },
  { days: 365, label: "1 year" },
  { days: 730, label: "2 years" },
  { days: 1095, label: "3 years" },
  { days: 1825, label: "5 years" },
]

function lifespanLabel(days: number): string {
  return LIFESPANS.find((entry) => entry.days === days)?.label ?? `${days} days`
}

// The planned cost per day, or the actual one over the days owned once the item has ended.
function costPerDay(netCents: number, lifespanDays: number, acquiredOn: string, endedOn: string | null): number {
  const days = endedOn ? Math.max(1, Math.round((Date.parse(endedOn) - Date.parse(acquiredOn)) / 86_400_000)) : lifespanDays
  return Math.round(netCents / days)
}

// Title and amount, both edited in place.
export function TransactionHead({ record }: { record: TransactionRecordState }) {
  const view = record.view
  if (!view) return null
  return (
    <>
      <InlineText
        variant="title"
        label="Title"
        value={view.title}
        error={record.errors.title}
        onCancel={() => record.setError("title", null)}
        onSave={(next) => {
          const title = next.trim()
          if (!title) {
            record.setError("title", "Enter a title.")
            return false
          }
          return record.save("title", { title })
        }}
      />
      <InlineText
        variant="amount"
        label="Amount"
        inputMode="decimal"
        value={amountInput(view.amount_cents)}
        display={<Amount cents={view.amount_cents} kind={view.type === "income" ? "income" : "expense"} />}
        error={record.errors.amount}
        onCancel={() => record.setError("amount", null)}
        onSave={(next) => {
          const cents = parseAmountCents(next)
          if (cents === null) {
            record.setError("amount", "Enter a valid amount.")
            return false
          }
          return record.save("amount", { amount_cents: cents })
        }}
      />
      {record.actionError ? <FieldError>{record.actionError}</FieldError> : null}
    </>
  )
}

function DateProperty({ record }: { record: TransactionRecordState }) {
  const view = record.view
  const [draft, setDraft] = useState("")
  const [open, setOpen] = useState(false)
  if (!view) return null
  const current = occurredAtInput(view)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setOpen(false)
    // A failed value stays shown with its error, so choosing it again retries.
    if (draft && (draft !== current || record.errors.date)) void record.save("date", { occurred_at: draft })
  }
  return (
    <Property label="Date" editable error={record.errors.date}>
      <Popover
        form
        label="Date"
        open={open}
        onOpenChange={(next) => {
          if (next) setDraft(current)
          setOpen(next)
        }}
        trigger={<PropertyButton>{occurredLabel(current)}</PropertyButton>}
      >
        <form onSubmit={submit}>
          <FieldGrid narrow>
            <Field label="Date">
              <TextField
                type="datetime-local"
                required
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
            </Field>
          </FieldGrid>
          <PopoverActions>
            <Button type="submit" variant="primary" size="small" disabled={!draft}>
              Save
            </Button>
          </PopoverActions>
        </form>
      </Popover>
    </Property>
  )
}

function DurableForm({
  record,
  onDone,
}: {
  record: TransactionRecordState
  onDone: () => void
}) {
  const view = record.view
  const durable = view?.durable_purchase ?? null
  const initialDays = durable?.expected_lifespan_days ?? 365
  const presetMatch = LIFESPANS.some((entry) => entry.days === initialDays)
  const [preset, setPreset] = useState(presetMatch ? String(initialDays) : "custom")
  const [customDays, setCustomDays] = useState(presetMatch ? "" : String(initialDays))
  const [acquiredOn, setAcquiredOn] = useState(durable?.acquired_on ?? view?.date ?? "")
  const [endedOn, setEndedOn] = useState(durable?.ended_on ?? "")
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  if (!view) return null

  const days = preset === "custom" ? Number(customDays) : Number(preset)
  const validDays = Number.isInteger(days) && days > 0
  const finish = async (input: DurableInput | null) => {
    setSaving(true)
    const saved = await record.saveDurable(input)
    setSaving(false)
    if (saved) onDone()
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!validDays) {
      setFormError("Expected lifespan must be greater than 0 days.")
      return
    }
    if (!acquiredOn) {
      setFormError("Acquired date is required.")
      return
    }
    if (endedOn && endedOn < acquiredOn) {
      setFormError("End date must be on or after the acquired date.")
      return
    }
    setFormError(null)
    void finish({ expected_lifespan_days: days, acquired_on: acquiredOn, ended_on: endedOn || null })
  }

  return (
    <form onSubmit={submit}>
      <FieldGrid narrow>
        <Field label="Lifespan">
          <Select value={preset} onChange={(event) => setPreset(event.target.value)}>
            {LIFESPANS.map((entry) => (
              <option key={entry.days} value={entry.days}>
                {entry.label}
              </option>
            ))}
            <option value="custom">Custom</option>
          </Select>
        </Field>
        {preset === "custom" ? (
          <Field label="Days">
            <TextField
              type="number"
              min={1}
              inputMode="numeric"
              value={customDays}
              onChange={(event) => setCustomDays(event.target.value)}
            />
          </Field>
        ) : null}
        <Field label="Acquired">
          <TextField type="date" value={acquiredOn} onChange={(event) => setAcquiredOn(event.target.value)} />
        </Field>
        <Field label="Ended">
          <TextField type="date" value={endedOn} onChange={(event) => setEndedOn(event.target.value)} />
        </Field>
      </FieldGrid>
      {validDays ? (
        <Status>
          <Amount cents={costPerDay(view.net_amount_cents, days, acquiredOn, endedOn || null)} kind="expense" /> per day
        </Status>
      ) : null}
      {formError ? <FieldError>{formError}</FieldError> : null}
      <PopoverActions
        start={
          durable ? (
            <Button variant="danger" size="small" disabled={saving} onClick={() => void finish(null)}>
              Stop tracking
            </Button>
          ) : null
        }
      >
        <Button type="submit" variant="primary" size="small" disabled={saving}>
          {durable ? "Save" : "Track"}
        </Button>
      </PopoverActions>
    </form>
  )
}

// Shown while tracked, or while the ⋯ menu's Track as durable… has its editor open.
function DurableProperty({ record }: { record: TransactionRecordState }) {
  const view = record.view
  if (!view) return null
  const durable = view.durable_purchase
  if (!durable && !record.durableOpen && !record.errors.durable) return null
  return (
    <Property label="Durable" editable error={record.errors.durable}>
      <Popover
        form
        label="Durable purchase"
        open={record.durableOpen}
        onOpenChange={record.setDurableOpen}
        trigger={
          <PropertyButton empty={!durable}>
            {durable ? (
              <>
                {lifespanLabel(durable.expected_lifespan_days)} from {shortDateLabel(durable.acquired_on)}
                {durable.ended_on ? `, ended ${shortDateLabel(durable.ended_on)}` : null} ·{" "}
                <Amount
                  cents={costPerDay(view.net_amount_cents, durable.expected_lifespan_days, durable.acquired_on, durable.ended_on)}
                  kind="expense"
                />{" "}
                per day
              </>
            ) : (
              "Not tracked"
            )}
          </PropertyButton>
        }
      >
        <DurableForm record={record} onDone={() => record.setDurableOpen(false)} />
      </Popover>
    </Property>
  )
}

// The expense's reimbursements, with an editor that allocates from one that has money left.
function ReimbursedProperty({
  record,
  linkTo,
  variant,
}: {
  record: TransactionRecordState
  linkTo: LinkTo
  variant: "peek" | "full"
}) {
  const [open, setOpen] = useState(false)
  const view = record.view
  if (!view) return null
  const reimbursements = record.reimbursements
  return (
    <>
      <Property label="Reimbursed">
        {view.reimbursed_total_cents > 0 ? (
          variant === "peek" && reimbursements?.mode === "expense" ? (
            reimbursements.allocations_in.map((allocation) => (
              <PropertyLink
                key={allocation.allocation_id}
                to={linkTo(allocation.reimbursement_transaction.id)}
                icon={ArrowBendUpLeftIcon}
                iconTone="income"
                end={<Amount cents={allocation.amount_cents} kind="income" />}
              >
                {allocation.reimbursement_transaction.title || "Reimbursement"}
              </PropertyLink>
            ))
          ) : (
            <Amount cents={view.reimbursed_total_cents} kind="income" />
          )
        ) : null}
        <Popover
          form
          label="Add reimbursement"
          open={open}
          onOpenChange={setOpen}
          trigger={<IconButton icon={PlusIcon} label="Add reimbursement" size="small" />}
        >
          <OpenReimbursementForm record={record} onDone={() => setOpen(false)} />
        </Popover>
      </Property>
      {view.reimbursed_total_cents > 0 ? (
        <Property label="Net" strong>
          <Amount cents={view.net_amount_cents} kind="expense" />
        </Property>
      ) : null}
    </>
  )
}

function OpenReimbursementForm({ record, onDone }: { record: TransactionRecordState; onDone: () => void }) {
  const open = useQuery({
    queryKey: ["transaction", record.id, "open-reimbursements"],
    queryFn: () => apiFetch<OpenReimbursementsResponse>(`/api/transactions/${record.id}/open-reimbursements`),
  })
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const view = record.view
  if (!view) return null
  if (open.isError) return <FieldError>Unable to load reimbursements.</FieldError>
  if (!open.data) return <Status>Loading…</Status>
  const results = open.data.results
  if (!results.length) return <Status>No reimbursements left to allocate.</Status>
  const selected = results.find((entry) => entry.reimbursement.id === selectedId) ?? results[0]
  return (
    <AllocateForm
      key={selected.reimbursement.id}
      reimbursementId={selected.reimbursement.id}
      expenseId={record.id}
      expenseCents={view.amount_cents}
      maxCents={selected.allocated_to_this_cents + selected.suggested_amount_cents}
      onDone={onDone}
    >
      <Field label="From">
        <Select value={selected.reimbursement.id} onChange={(event) => setSelectedId(Number(event.target.value))}>
          {results.map((entry) => (
            <option key={entry.reimbursement.id} value={entry.reimbursement.id}>
              {entry.reimbursement.title || "Reimbursement"} · {shortDateLabel(entry.reimbursement.date)} ·{" "}
              {formatAmountPrivate(entry.remaining_to_allocate_cents)} left
            </option>
          ))}
        </Select>
      </Field>
    </AllocateForm>
  )
}

// The properties grid. The peek lists linked reimbursements here; the full view shows
// their total and lists them in its own section.
export function TransactionProperties({
  record,
  linkTo,
  variant,
}: {
  record: TransactionRecordState
  linkTo: LinkTo
  variant: "peek" | "full"
}) {
  const view = record.view
  if (!view) return null
  const isExpense = view.type === "expense"
  const reimbursements = record.reimbursements
  const category = record.category
  const pickable = record.categories.filter((entry) => entry.archived_at === null && entry.type === view.type)
  const hasLocation = view.latitude !== null && view.longitude !== null

  return (
    <PropertyList>
      <Property label="Type" editable error={record.errors.type}>
        <Menu label="Type" align="start" trigger={<PropertyButton>{isExpense ? "Expense" : "Income"}</PropertyButton>}>
          <MenuItem
            checked={isExpense}
            onSelect={() => {
              if (!isExpense || record.errors.type) void record.save("type", { type: "expense", category_id: null, is_reimbursement: false })
            }}
          >
            Expense
          </MenuItem>
          <MenuItem
            checked={!isExpense}
            onSelect={() => {
              if (isExpense || record.errors.type) void record.save("type", { type: "income", category_id: null })
            }}
          >
            Income
          </MenuItem>
        </Menu>
      </Property>
      <DateProperty record={record} />
      <Property label="Category" editable error={record.errors.category}>
        <CategoryPicker
          allowNone
          categories={pickable}
          selectedId={view.category_id}
          onSelect={(categoryId) => {
            if (categoryId !== view.category_id || record.errors.category) void record.save("category", { category_id: categoryId })
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
      <Property label="Tags" error={record.errors.tags}>
        {view.tags.map((name) => (
          <TagChip
            key={name}
            onRemove={() => void record.save("tags", { tags: view.tags.filter((entry) => entry !== name) })}
          >
            {name}
          </TagChip>
        ))}
        <TagPicker
          trigger={<IconButton icon={PlusIcon} label="Add tag" size="small" />}
          options={record.tagOptions}
          selected={view.tags}
          onChange={(tags) => void record.save("tags", { tags })}
        />
      </Property>
      {isExpense ? null : (
        <Property label="Reimbursement" editable error={record.errors.reimbursement}>
          <Switch
            label="Reimbursement"
            checked={view.is_reimbursement}
            onCheckedChange={(checked) => void record.save("reimbursement", { is_reimbursement: checked })}
          />
        </Property>
      )}
      <Property label="Location" empty={!hasLocation} icon={hasLocation ? MapPinIcon : undefined}>
        {hasLocation ? `${formatCoordinate(view.latitude ?? 0)}, ${formatCoordinate(view.longitude ?? 0)}` : "None"}
      </Property>
      {isExpense ? <ReimbursedProperty record={record} linkTo={linkTo} variant={variant} /> : null}
      {!isExpense && view.is_reimbursement && reimbursements?.mode === "income" ? (
        <>
          {variant === "peek" && reimbursements.allocations_out.length ? (
            <Property label="Allocated to">
              {reimbursements.allocations_out.map((allocation) => (
                <PropertyLink
                  key={allocation.allocation_id}
                  to={linkTo(allocation.expense_transaction.id)}
                  end={<Amount cents={allocation.amount_cents} kind="expense" />}
                >
                  {allocation.expense_transaction.title || "Expense"}
                </PropertyLink>
              ))}
            </Property>
          ) : null}
          <Property label="Remaining">
            <Amount cents={reimbursements.remaining_to_allocate_cents} kind="expense" />
          </Property>
        </>
      ) : null}
      {isExpense ? <DurableProperty record={record} /> : null}
      {view.bank_row ? (
        <Property label="Bank">
          <PropertyLink to="/reconciliation" icon={BankIcon}>
            {view.bank_row.account_label} · booked {shortDateLabel(view.bank_row.booking_date)}
          </PropertyLink>
        </Property>
      ) : null}
    </PropertyList>
  )
}

export function TransactionNotes({ record }: { record: TransactionRecordState }) {
  const view = record.view
  if (!view) return null
  return (
    <Notes
      value={view.description ?? ""}
      error={record.errors.notes}
      onSave={(next) => record.save("notes", { description: next || null })}
    />
  )
}

// The map, only for a transaction with a location.
export function TransactionLocation({ record }: { record: TransactionRecordState }) {
  const view = record.view
  if (!view || view.latitude === null || view.longitude === null) return null
  return (
    <PeekSection title="Location">
      <LocationMap latitude={view.latitude} longitude={view.longitude} />
    </PeekSection>
  )
}

export function TransactionReceipts({ record }: { record: TransactionRecordState }) {
  const view = record.view
  if (!view) return null
  return (
    <ReceiptSection
      files={receiptFiles(view.attachments)}
      uploading={record.receipts.uploading}
      error={record.receipts.error}
      onUpload={(file) => void record.receipts.upload(file)}
      onReplace={(target, file) => void record.receipts.replace(target, file)}
      onRemove={(target) => void record.receipts.remove(target)}
    />
  )
}

// Saving replaces the pair's allocation, so the most it can hold, maxCents, is what it has plus
// what is left. The amount starts there, and ½ and ⅓ above it are disabled.
function AllocateForm({
  reimbursementId,
  expenseId,
  expenseCents,
  maxCents,
  onDone,
  children,
}: {
  reimbursementId: number
  expenseId: number
  expenseCents: number
  maxCents: number
  onDone: () => void
  children?: ReactNode
}) {
  const queryClient = useQueryClient()
  const [amount, setAmount] = useState(amountInput(maxCents))
  const half = Math.round(expenseCents / 2)
  const third = Math.round(expenseCents / 3)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const cents = parseAmountCents(amount)
    if (!cents) {
      setError("Enter a valid amount.")
      return
    }
    setSaving(true)
    try {
      await apiFetch(`/api/reimbursements/${reimbursementId}/allocations`, {
        method: "POST",
        body: JSON.stringify({ expense_transaction_id: expenseId, amount_cents: cents }),
      })
    } catch (failure) {
      setError(getApiErrorMessage(failure, "Unable to save allocation."))
      setSaving(false)
      return
    }
    invalidateTransactionData(queryClient)
    void queryClient.invalidateQueries({ queryKey: ["reimbursement-search", reimbursementId] })
    onDone()
  }
  return (
    <form onSubmit={(event) => void submit(event)}>
      <FieldGrid narrow>
        {children}
        <Field label="Amount" error={error}>
          <TextField
            autoFocus
            inputMode="decimal"
            suffix="€"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>
      </FieldGrid>
      <PopoverActions
        start={
          <>
            <Button variant="ghost" size="small" disabled={half > maxCents} onClick={() => setAmount(amountInput(half))}>
              ½
            </Button>
            <Button variant="ghost" size="small" disabled={third > maxCents} onClick={() => setAmount(amountInput(third))}>
              ⅓
            </Button>
          </>
        }
      >
        <Button type="submit" variant="primary" size="small" disabled={saving}>
          Allocate
        </Button>
      </PopoverActions>
    </form>
  )
}

function AllocateButton({ record, result }: { record: TransactionRecordState; result: ReimbursementExpenseSearchResult }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover
      form
      label={`Allocate to ${result.expense.title || "expense"}`}
      align="end"
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="quiet" size="small" disabled={result.suggested_amount_cents <= 0}>
          Allocate
        </Button>
      }
    >
      <AllocateForm
        reimbursementId={record.id}
        expenseId={result.expense.id}
        expenseCents={result.expense.amount_cents}
        maxCents={result.allocated_to_this_cents + result.suggested_amount_cents}
        onDone={() => setOpen(false)}
      />
    </Popover>
  )
}

function AllocationSearch({ record }: { record: TransactionRecordState }) {
  const [query, setQuery] = useState("")
  const [debounced, setDebounced] = useState("")
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [query])
  const search = useQuery({
    queryKey: ["reimbursement-search", record.id, debounced],
    queryFn: () =>
      apiFetch<ReimbursementExpenseSearchResponse>(
        `/api/reimbursements/${record.id}/expense-search?q=${encodeURIComponent(debounced)}`
      ),
  })
  const results = search.data?.results ?? []
  return (
    <PeekSection title="Allocate to an expense">
      <TextField
        type="search"
        icon={MagnifyingGlassIcon}
        aria-label="Search expenses"
        placeholder="Search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {search.isError ? <FieldError>{getApiErrorMessage(search.error, "Unable to search expenses.")}</FieldError> : null}
      {results.length ? (
        <List flat label="Expenses">
          {results.map((result) => (
            <Row key={result.expense.id} columns="minmax(0, 1fr) auto auto" mobileColumns="minmax(0, 1fr) auto">
              <Cell>
                {result.expense.title || result.expense.category?.name || "Expense"}{" "}
                <Status>· {shortDateLabel(result.expense.date)}</Status>
              </Cell>
              <Cell tone="muted" align="right" hide="mobile">
                <Amount cents={result.remaining_unreimbursed_cents} kind="expense" /> left
              </Cell>
              <AllocateButton record={record} result={result} />
            </Row>
          ))}
        </List>
      ) : search.isSuccess ? (
        <Status>No matching expenses</Status>
      ) : null}
    </PeekSection>
  )
}

// Reimbursement links in the full view: an expense lists what paid it back; a reimbursement
// lists where it went and allocates the rest.
export function TransactionReimbursements({ record, linkTo }: { record: TransactionRecordState; linkTo: LinkTo }) {
  const navigate = useNavigate()
  const view = record.view
  const reimbursements = record.reimbursements
  if (!view) return null
  if (record.reimbursementsQuery.isError) {
    return (
      <PeekSection title="Reimbursements">
        <FieldError>Unable to load reimbursements.</FieldError>
      </PeekSection>
    )
  }
  if (!reimbursements) return null
  if (reimbursements.mode === "expense") {
    if (!reimbursements.allocations_in.length) return null
    return (
      <PeekSection title="Reimbursements">
        <List flat label="Reimbursements">
          {reimbursements.allocations_in.map((allocation) => {
            const source = allocation.reimbursement_transaction
            return (
              <Row
                key={allocation.allocation_id}
                columns="14px minmax(0, 1fr) auto 28px"
                onOpen={() => navigate(linkTo(source.id))}
                label={source.title || "Reimbursement"}
              >
                <ArrowBendUpLeftIcon aria-hidden="true" />
                <Cell>
                  {source.title || "Reimbursement"} <Status>· {shortDateLabel(source.date)}</Status>
                </Cell>
                <Amount cents={allocation.amount_cents} kind="income" />
                <RowActions reveal>
                  <IconButton
                    icon={XIcon}
                    label="Remove allocation"
                    size="small"
                    onClick={() => void record.removeAllocation(allocation.allocation_id)}
                  />
                </RowActions>
              </Row>
            )
          })}
        </List>
      </PeekSection>
    )
  }
  return <ReimbursementAllocations record={record} reimbursements={reimbursements} linkTo={linkTo} />
}

function ReimbursementAllocations({
  record,
  reimbursements,
  linkTo,
}: {
  record: TransactionRecordState
  reimbursements: TransactionReimbursementsIncome
  linkTo: LinkTo
}) {
  const navigate = useNavigate()
  const view = record.view
  if (!view) return null
  return (
    <>
      <PeekSection
        title="Allocated to"
        action={
          <Status>
            <Amount cents={reimbursements.allocated_total_cents} kind="expense" /> of{" "}
            <Amount cents={view.amount_cents} kind="expense" />
          </Status>
        }
      >
        {reimbursements.allocations_out.length ? (
          <List flat label="Allocations">
            {reimbursements.allocations_out.map((allocation) => {
              const target = allocation.expense_transaction
              return (
                <Row
                  key={allocation.allocation_id}
                  columns="minmax(0, 1fr) auto 28px"
                  onOpen={() => navigate(linkTo(target.id))}
                  label={target.title || "Expense"}
                >
                  <Cell>
                    {target.title || target.category?.name || "Expense"} <Status>· {shortDateLabel(target.date)}</Status>
                  </Cell>
                  <Amount cents={allocation.amount_cents} kind="expense" />
                  <RowActions reveal>
                    <IconButton
                      icon={XIcon}
                      label="Remove allocation"
                      size="small"
                      onClick={() => void record.removeAllocation(allocation.allocation_id)}
                    />
                  </RowActions>
                </Row>
              )
            })}
          </List>
        ) : (
          <Status>Not allocated yet</Status>
        )}
      </PeekSection>
      <AllocationSearch record={record} />
    </>
  )
}

// The ⋯ menu shared by the peek and the full view.
export function TransactionMenuItems({
  record,
  onDeleted,
}: {
  record: TransactionRecordState
  onDeleted: () => void
}) {
  const view = record.view
  return (
    <>
      {view?.type === "expense" && !view.durable_purchase ? (
        <MenuItem icon={PackageIcon} onSelect={() => record.setDurableOpen(true)}>
          Track as durable…
        </MenuItem>
      ) : null}
      <MenuItem icon={LinkSimpleIcon} onSelect={() => void record.copyLink()}>
        Copy link
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        icon={TrashIcon}
        danger
        onSelect={() => {
          void record.deleteRecord().then((deleted) => {
            if (deleted) onDeleted()
          })
        }}
      >
        Delete
      </MenuItem>
    </>
  )
}

// The transaction peek beside the ledger.
export function TransactionPeek({
  id,
  onClose,
  linkTo,
  fullViewTo,
  fullViewState,
  parent = "Transactions",
  lead,
}: {
  id: number
  onClose: () => void
  linkTo: LinkTo
  fullViewTo: string
  fullViewState?: unknown
  // The list the peek belongs to, for its breadcrumb and mobile back button.
  parent?: string
  // Shown between the amount and the properties, such as a category suggestion.
  lead?: ReactNode
}) {
  const record = useTransactionRecord(id)
  const view = record.view
  return (
    <Peek
      parent={parent}
      title={view?.title ?? "Transaction"}
      onClose={onClose}
      fullViewTo={view ? fullViewTo : undefined}
      fullViewState={fullViewState}
      menu={view ? <TransactionMenuItems record={record} onDeleted={onClose} /> : undefined}
    >
      {view ? (
        <>
          <TransactionHead record={record} />
          {lead}
          <TransactionProperties record={record} linkTo={linkTo} variant="peek" />
          <TransactionNotes record={record} />
          <TransactionLocation record={record} />
          <TransactionReceipts record={record} />
        </>
      ) : record.query.isError ? (
        <Status icon={ReceiptIcon}>
          {isApiErrorStatus(record.query.error, 404) ? "Transaction not found." : "Unable to load transaction."}
        </Status>
      ) : (
        <Status>Loading…</Status>
      )}
    </Peek>
  )
}
