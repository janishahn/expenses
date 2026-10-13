import { useState, type ReactElement } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { Icon } from "@phosphor-icons/react"
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/ArrowCounterClockwise"
import { ArrowsLeftRightIcon } from "@phosphor-icons/react/ArrowsLeftRight"
import { BankIcon } from "@phosphor-icons/react/Bank"
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown"
import { CaretLeftIcon } from "@phosphor-icons/react/CaretLeft"
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight"
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle"
import { ChecksIcon } from "@phosphor-icons/react/Checks"
import { CircleDashedIcon } from "@phosphor-icons/react/CircleDashed"
import { EyeSlashIcon } from "@phosphor-icons/react/EyeSlash"
import { FunnelIcon } from "@phosphor-icons/react/Funnel"
import { GitForkIcon } from "@phosphor-icons/react/GitFork"
import { LinkSimpleIcon } from "@phosphor-icons/react/LinkSimple"
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass"
import { MoneyIcon } from "@phosphor-icons/react/Money"
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple"
import { PlusCircleIcon } from "@phosphor-icons/react/PlusCircle"
import { SealCheckIcon } from "@phosphor-icons/react/SealCheck"
import { UploadSimpleIcon } from "@phosphor-icons/react/UploadSimple"
import { useSearchParams } from "react-router-dom"
import { apiFetch, apiFetchFormData, getApiErrorMessage } from "../app/api"
import type {
  BankAccount,
  BankReconciliationTransaction,
  BankRowResolution,
  BankRowsPage,
  BankStatementRow,
} from "../app/api-types"
import { formatShortDate } from "../app/format"
import { invalidateTransactionData, shortDateLabel } from "../app/transactions"
import { Amount } from "../components/ui/Amount"
import { Button, IconButton } from "../components/ui/Button"
import { CategoryGlyph, IconGlyph } from "../components/ui/CategoryGlyph"
import { DayBand } from "../components/ui/DayBand"
import { EmptyState } from "../components/ui/EmptyState"
import { useIsDesktop } from "../components/ui/layout-state"
import { AmountCell, Cell, List, ListFooter, Row, RowActions, type Columns } from "../components/ui/LedgerRow"
import { Menu, MenuItem, MenuSeparator } from "../components/ui/Menu"
import { Panel, PanelError, PanelLoading, ViewRow } from "../components/ui/Panel"
import { Peek, PeekHeadline, PeekLayout, PeekSection } from "../components/ui/Peek"
import { Pill } from "../components/ui/Pill"
import { Property, PropertyLink, PropertyList } from "../components/ui/PropertyList"
import { Radio, RadioGroup } from "../components/ui/Radio"
import { SegmentedControl } from "../components/ui/SegmentedControl"
import { Switch } from "../components/ui/Switch"
import { TextField } from "../components/ui/TextField"
import { showToast } from "../components/ui/toast-store"
import { bankRowTitle, candidateTitle, dayDistance } from "./bank-row"
import {
  CreateFromRowDialog,
  IgnoreReasonDialog,
  ImportStatementDialog,
  ReopenCreatedDialog,
  type CreateFromRowPayload,
} from "./ReconcileDialogs"

type View = "open" | "resolved"
type OpenStatus = "suggested" | "ambiguous" | "missing"

const PAGE_SIZE = 50
const IGNORE_REASONS: Array<{ label: string; icon: Icon }> = [
  { label: "Cash withdrawal", icon: MoneyIcon },
  { label: "Transfer between my accounts", icon: ArrowsLeftRightIcon },
  { label: "Not something I track", icon: EyeSlashIcon },
]
const BANDS: Array<{ status: OpenStatus; label: string; icon: Icon }> = [
  { status: "suggested", label: "Suggested match", icon: SealCheckIcon },
  { status: "ambiguous", label: "Several matches", icon: GitForkIcon },
  { status: "missing", label: "No match", icon: CircleDashedIcon },
]
const OUTCOMES: Record<BankRowResolution, { label: string; icon: Icon }> = {
  matched: { label: "Matched", icon: LinkSimpleIcon },
  created: { label: "Created", icon: PlusCircleIcon },
  ignored: { label: "Ignored", icon: EyeSlashIcon },
}

// The match cell and the row actions drop beside the peek; mobile rows show the icon, name, and amount.
const OPEN_COLUMNS: Columns = {
  columns: "18px minmax(0, 220px) 56px minmax(0, 1fr) auto 110px",
  narrowColumns: "18px minmax(0, 1fr) 56px auto 110px",
  mobileColumns: "18px minmax(0, 1fr) auto",
}
const RESOLVED_COLUMNS: Columns = {
  columns: "18px minmax(0, 220px) 56px minmax(0, 1fr) 110px",
  narrowColumns: "18px minmax(0, 1fr) 56px 110px",
  mobileColumns: "18px minmax(0, 1fr) auto",
}
const CANDIDATE_COLUMNS: Columns = { columns: "16px 18px minmax(0, 1fr) auto auto" }

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`
const rowKind = (row: BankStatementRow) => (row.amount_cents > 0 ? "income" : "expense")

function BankAmount({ row }: { row: BankStatementRow }) {
  return <Amount cents={Math.abs(row.amount_cents)} kind={rowKind(row)} currency={row.currency} />
}

function IgnoreMenu({
  trigger,
  onIgnore,
  onOtherReason,
}: {
  trigger: ReactElement
  onIgnore: (reason: string) => void
  onOtherReason: () => void
}) {
  return (
    <Menu label="Ignore" trigger={trigger}>
      {IGNORE_REASONS.map((reason) => (
        <MenuItem key={reason.label} icon={reason.icon} onSelect={() => onIgnore(reason.label)}>
          {reason.label}
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem icon={PencilSimpleIcon} onSelect={onOtherReason}>
        Other reason…
      </MenuItem>
    </Menu>
  )
}

function ignoreTrigger(label = "Ignore") {
  return (
    <Button variant="ghost">
      {label}
      <CaretDownIcon aria-hidden="true" />
    </Button>
  )
}

// An open row: the candidates as radio rows, a search over every transaction, and the actions.
// Picking a transaction with another amount offers to set it to the bank amount.
function OpenRowPeek({
  row,
  pending,
  onClose,
  onMatch,
  onCreate,
  onIgnore,
  onOtherReason,
}: {
  row: BankStatementRow
  pending: boolean
  onClose: () => void
  onMatch: (transaction: BankReconciliationTransaction, setAmount: boolean) => void
  onCreate: () => void
  onIgnore: (reason: string) => void
  onOtherReason: () => void
}) {
  const [selected, setSelected] = useState<BankReconciliationTransaction | null>(
    row.status === "suggested" ? (row.candidates[0] ?? null) : null
  )
  const [query, setQuery] = useState("")
  const [setAmount, setSetAmount] = useState(true)
  const search = query.trim()
  const results = useQuery({
    queryKey: ["reconciliation", "candidates", row.id, search],
    queryFn: () =>
      apiFetch<{ items: BankReconciliationTransaction[] }>(
        `/api/reconciliation/bank-rows/${row.id}/candidates?query=${encodeURIComponent(search)}&limit=8`
      ),
    enabled: search.length > 0,
  })
  const found = search ? (results.data?.items ?? []).filter((item) => !row.candidates.some((candidate) => candidate.id === item.id)) : []
  const listed = [...row.candidates, ...found]
  if (selected && !listed.some((item) => item.id === selected.id)) listed.unshift(selected)
  const hasCandidates = row.candidates.length > 0
  const bankCents = Math.abs(row.amount_cents)
  // Transactions are kept in euros, so only a euro statement amount can replace theirs.
  const canSetAmount =
    selected !== null && selected.amount_cents !== bankCents && selected.type === rowKind(row) && row.currency === "EUR"
  const title = bankRowTitle(row)

  return (
    <Peek
      parent="Reconcile"
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button
            variant={hasCandidates ? "primary" : "quiet"}
            disabled={!selected || pending}
            onClick={() => selected && onMatch(selected, canSetAmount && setAmount)}
          >
            Match
          </Button>
          <Button variant={hasCandidates ? "quiet" : "primary"} disabled={pending} onClick={onCreate}>
            Create…
          </Button>
        </>
      }
      footerEnd={<IgnoreMenu trigger={ignoreTrigger()} onIgnore={onIgnore} onOtherReason={onOtherReason} />}
    >
      <PeekHeadline title={title} figure={<BankAmount row={row} />} />
      <PropertyList>
        <Property label="Booked">{formatShortDate(row.booking_date)}</Property>
        <Property label="Account">{row.account_label}</Property>
        <Property label="Purpose">{row.purpose ?? row.raw_description}</Property>
      </PropertyList>
      <PeekSection title="Match">
        {hasCandidates ? null : (
          <EmptyState inline>
            No transaction with <BankAmount row={row} /> within 5 days.
          </EmptyState>
        )}
        <TextField
          type="search"
          icon={MagnifyingGlassIcon}
          aria-label="Find a transaction"
          placeholder={hasCandidates ? "Find another transaction" : "Find a transaction"}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {listed.length ? (
          <RadioGroup
            label="Transactions"
            value={selected ? String(selected.id) : null}
            onValueChange={(value) => setSelected(listed.find((item) => String(item.id) === value) ?? null)}
          >
            <List flat label="Transactions">
              {listed.map((item) => (
                <Row
                  key={item.id}
                  {...CANDIDATE_COLUMNS}
                  label={candidateTitle(item)}
                  selected={item.id === selected?.id}
                  onOpen={() => setSelected(item)}
                >
                  <Radio value={String(item.id)} label={candidateTitle(item)} />
                  <CategoryGlyph categoryId={item.category_id} icon={item.category_icon} name={item.category} />
                  <Cell>{candidateTitle(item)}</Cell>
                  <Cell tone="faint">{dayDistance(item.date_delta_days)}</Cell>
                  <AmountCell>
                    <Amount cents={item.amount_cents} kind={item.type} />
                  </AmountCell>
                </Row>
              ))}
            </List>
          </RadioGroup>
        ) : search && results.isSuccess ? (
          <EmptyState inline>No matching transactions</EmptyState>
        ) : null}
        {selected && canSetAmount ? (
          <PropertyList>
            <Property label="Amount">
              <Switch label="Set the amount to the bank amount" checked={setAmount} onCheckedChange={setSetAmount} />
              Set to <BankAmount row={row} /> · was{" "}
              <Amount cents={selected.amount_cents} kind={selected.type} tone="muted" />
            </Property>
          </PropertyList>
        ) : null}
      </PeekSection>
    </Peek>
  )
}

function ResolvedRowPeek({
  row,
  pending,
  onClose,
  onReopen,
}: {
  row: BankStatementRow
  pending: boolean
  onClose: () => void
  onReopen: () => void
}) {
  const outcome = OUTCOMES[row.resolution ?? "matched"]
  const transaction = row.suggested_transaction
  const title = bankRowTitle(row)
  return (
    <Peek
      parent="Reconcile"
      title={title}
      onClose={onClose}
      footer={
        <Button variant="quiet" icon={ArrowCounterClockwiseIcon} disabled={pending} onClick={onReopen}>
          Reopen
        </Button>
      }
    >
      <PeekHeadline title={title} figure={<BankAmount row={row} />} />
      <PropertyList>
        <Property label="Booked">{formatShortDate(row.booking_date)}</Property>
        <Property label="Account">{row.account_label}</Property>
        <Property label="Outcome" icon={outcome.icon}>
          {outcome.label}
        </Property>
        {row.resolution === "ignored" ? (
          <Property label="Reason" empty={!row.ignore_reason}>
            {row.ignore_reason ?? "None"}
          </Property>
        ) : transaction ? (
          <Property label="Transaction">
            <PropertyLink to={`/transactions/${transaction.id}`} end={<Amount cents={transaction.amount_cents} kind={transaction.type} />}>
              {candidateTitle(transaction)}
            </PropertyLink>
          </Property>
        ) : null}
        {row.resolved_at ? <Property label="Resolved">{formatShortDate(row.resolved_at)}</Property> : null}
        <Property label="Purpose">{row.purpose ?? row.raw_description}</Property>
      </PropertyList>
    </Peek>
  )
}

// Bank statement rows checked one by one against tracked transactions. It never compares totals:
// a statement covers one account, while the app may track several.
function ReconciliationPage() {
  const queryClient = useQueryClient()
  const isDesktop = useIsDesktop()
  const [searchParams, setSearchParams] = useSearchParams()
  const view: View = searchParams.get("view") === "resolved" ? "resolved" : "open"
  const account = searchParams.get("account")
  const outcomeParam = searchParams.get("outcome")
  const outcome = outcomeParam === "matched" || outcomeParam === "created" || outcomeParam === "ignored" ? outcomeParam : null
  const page = Math.max(1, Number(searchParams.get("page")) || 1)
  const peekId = Number(searchParams.get("peek")) || null
  const [importing, setImporting] = useState(false)
  const [creating, setCreating] = useState<BankStatementRow | null>(null)
  const [ignoring, setIgnoring] = useState<BankStatementRow | null>(null)
  const [reopening, setReopening] = useState<BankStatementRow | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const listParams = (forView: View, forPage: number, limit: number) => {
    const params = new URLSearchParams({ view: forView, page: String(forPage), limit: String(limit) })
    if (account) params.set("account", account)
    if (forView === "resolved" && outcome) params.set("outcome", outcome)
    return params.toString()
  }
  const rowsParams = listParams(view, page, PAGE_SIZE)
  const rows = useQuery({
    queryKey: ["reconciliation", "rows", view, rowsParams],
    queryFn: () => apiFetch<BankRowsPage>(`/api/reconciliation/bank-rows?${rowsParams}`),
    // Filter and page changes keep the shown rows until the new ones arrive; a view change shows the loading state.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[2] === view ? previous : undefined),
  })
  // The To review count while Resolved is shown.
  const openParams = listParams("open", 1, 1)
  const openCount = useQuery({
    queryKey: ["reconciliation", "rows", "open", openParams],
    queryFn: () => apiFetch<BankRowsPage>(`/api/reconciliation/bank-rows?${openParams}`),
    enabled: view === "resolved",
  })
  const accountsQuery = useQuery({
    queryKey: ["reconciliation", "accounts"],
    queryFn: () => apiFetch<{ accounts: BankAccount[] }>("/api/reconciliation/accounts"),
  })

  if (rows.isLoading || accountsQuery.isLoading) {
    return <PanelLoading title="Reconcile" label="Loading bank rows…" />
  }
  if (rows.error || accountsQuery.error || !rows.data || !accountsQuery.data) {
    return <PanelError title="Reconcile" message="Unable to load bank rows." />
  }

  const { items, total } = rows.data
  const accounts = accountsQuery.data.accounts
  const openTotal = view === "open" ? total : openCount.data?.total
  const latestImport = [...accounts]
    .filter((entry) => entry.last_import_at && (!account || entry.label === account))
    .sort((a, b) => (b.last_import_at ?? "").localeCompare(a.last_import_at ?? ""))[0]

  const update = (changes: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    setSearchParams(next, { replace })
  }
  const openPeek = (id: number) => update({ peek: String(id) }, peekId !== null)
  const closePeek = () => update({ peek: null }, true)

  const refresh = (transactions: boolean) => {
    void queryClient.invalidateQueries({ queryKey: ["reconciliation"] })
    if (transactions) invalidateTransactionData(queryClient)
  }
  const post = (path: string, body?: unknown) =>
    apiFetch<{ status: string; transaction_id?: number | null; previous_amount_cents?: number | null }>(
      `/api/reconciliation/bank-rows/${path}`,
      { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }
    )
  // An Undo passes the outcome it reverses, so the server leaves a row changed since then as it is.
  // It also passes the amount a match replaced, which the server restores unless it was edited since.
  const reopen = (
    rowId: number,
    reversing?: { resolution: BankRowResolution; transactionId?: number; restoreAmountCents?: number },
    trashCreatedTransaction = false
  ) =>
    post(`${rowId}/reopen`, {
      trash_created_transaction: trashCreatedTransaction,
      expected_resolution: reversing?.resolution,
      expected_transaction_id: reversing?.transactionId,
      restore_amount_cents: reversing?.restoreAmountCents,
    })

  // Runs one row action, then confirms it in a toast whose Undo runs `undo`.
  // Returns the error message when the action fails.
  const act = async ({
    row,
    run,
    message,
    undo,
    transactions = false,
  }: {
    row: BankStatementRow | null
    run: () => Promise<string | void>
    message: string
    undo: (() => Promise<unknown>) | null
    transactions?: boolean
  }): Promise<string | null> => {
    setPending(true)
    let finalMessage = message
    try {
      finalMessage = (await run()) || message
    } catch (failure) {
      return getApiErrorMessage(failure, "Unable to update this bank row.")
    } finally {
      setPending(false)
    }
    if (row && peekId === row.id) closePeek()
    refresh(transactions)
    showToast({
      message: finalMessage,
      action: undo
        ? {
            label: "Undo",
            onClick: async () => {
              try {
                await undo()
              } catch (failure) {
                showToast({ message: getApiErrorMessage(failure, "Unable to undo the change.") })
              }
              refresh(transactions)
            },
          }
        : undefined,
    })
    return null
  }
  const reportFailure = (error: string | null) => {
    if (error) showToast({ message: error })
  }

  const matchSuggestion = async (row: BankStatementRow) => {
    const candidate = row.suggested_transaction ?? row.candidates[0]
    let matchedId: number | undefined
    reportFailure(
      await act({
        row,
        run: async () => {
          matchedId = (await post(`${row.id}/accept-suggestion`)).transaction_id ?? undefined
        },
        message: `Matched with ${candidate ? candidateTitle(candidate) : bankRowTitle(row)}`,
        undo: () => reopen(row.id, { resolution: "matched", transactionId: matchedId }),
      })
    )
  }
  const matchAll = async (band: BankStatementRow[]) => {
    // The server skips rows that no longer have exactly one candidate; Undo leaves them as they are.
    let matches: Array<{ row_id: number; transaction_id: number }> = []
    reportFailure(
      await act({
        row: band.find((row) => row.id === peekId) ?? null,
        run: async () => {
          const result = await apiFetch<{ matches: typeof matches }>("/api/reconciliation/bank-rows/accept-suggestions", {
            method: "POST",
            body: JSON.stringify({ row_ids: band.map((row) => row.id) }),
          })
          matches = result.matches
          return `Matched ${plural(matches.length, "row")}`
        },
        message: "Matched",
        undo: () =>
          Promise.all(
            matches.map((match) => reopen(match.row_id, { resolution: "matched", transactionId: match.transaction_id }))
          ),
      })
    )
  }
  const matchTransaction = async (row: BankStatementRow, transaction: BankReconciliationTransaction, setAmount: boolean) => {
    let replacedAmount: number | undefined
    reportFailure(
      await act({
        row,
        run: async () => {
          const result = await post(`${row.id}/match-transaction`, {
            transaction_id: transaction.id,
            update_amount_to_bank: setAmount,
          })
          replacedAmount = result.previous_amount_cents ?? undefined
        },
        message: `Matched with ${candidateTitle(transaction)}`,
        undo: () =>
          reopen(row.id, { resolution: "matched", transactionId: transaction.id, restoreAmountCents: replacedAmount }),
        transactions: setAmount,
      })
    )
  }
  const ignore = async (row: BankStatementRow, reason: string | null) =>
    act({
      row,
      run: () => post(`${row.id}/ignore`, { reason }).then(() => undefined),
      message: reason ? `Ignored · ${reason}` : "Ignored",
      undo: () => reopen(row.id, { resolution: "ignored" }),
    })
  // Undoing a create moves the new transaction to Trash.
  const createFromRow = async (row: BankStatementRow, payload: CreateFromRowPayload, receipt: File | null) => {
    setDialogError(null)
    let createdId: number | undefined
    const error = await act({
      row,
      run: async () => {
        const created = await post(`${row.id}/create-transaction`, payload)
        createdId = created.transaction_id ?? undefined
        if (!receipt || !created.transaction_id) return
        try {
          const form = new FormData()
          form.append("file", receipt)
          await apiFetchFormData(`/api/transactions/${created.transaction_id}/attachments`, { method: "POST", body: form })
        } catch {
          return `Created ${payload.title}, but the receipt could not be uploaded`
        }
      },
      message: `Created ${payload.title}`,
      undo: () => reopen(row.id, { resolution: "created", transactionId: createdId }, true),
      transactions: true,
    })
    if (error) setDialogError(error)
    else setCreating(null)
  }
  const reopenRow = async (row: BankStatementRow, trashCreatedTransaction: boolean) => {
    const transaction = row.suggested_transaction
    const { resolution, ignore_reason: reason } = row
    const error = await act({
      row,
      run: () => reopen(row.id, undefined, trashCreatedTransaction).then(() => undefined),
      message: trashCreatedTransaction ? "Moved back to review · transaction moved to Trash" : "Moved back to review",
      undo:
        resolution === "ignored"
          ? () => post(`${row.id}/ignore`, { reason })
          : resolution && transaction
            ? async () => {
                if (trashCreatedTransaction) {
                  await apiFetch("/api/transactions/deleted/restore", {
                    method: "POST",
                    body: JSON.stringify({ ids: [transaction.id] }),
                  })
                }
                await post(`${row.id}/match-transaction`, { transaction_id: transaction.id, resolution })
              }
            : null,
      transactions: trashCreatedTransaction,
    })
    reportFailure(error)
    setReopening(null)
  }
  const startCreate = (row: BankStatementRow) => {
    setDialogError(null)
    setCreating(row)
  }
  const startIgnore = (row: BankStatementRow) => {
    setDialogError(null)
    setIgnoring(row)
  }

  const peekRow = items.find((row) => row.id === peekId) ?? null
  const first = (page - 1) * PAGE_SIZE + 1
  const footer = items.length ? (
    total > items.length || page > 1 ? (
      <ListFooter>
        {first}–{first + items.length - 1} of {total}
        <IconButton icon={CaretLeftIcon} label="Previous page" disabled={page <= 1} onClick={() => update({ page: String(page - 1), peek: null })} />
        <IconButton
          icon={CaretRightIcon}
          label="Next page"
          disabled={first + items.length - 1 >= total}
          onClick={() => update({ page: String(page + 1), peek: null })}
        />
      </ListFooter>
    ) : null
  ) : accounts.length === 0 ? (
    <EmptyState
      icon={BankIcon}
      action={
        <Button variant="quiet" icon={UploadSimpleIcon} onClick={() => setImporting(true)}>
          Import statement
        </Button>
      }
    >
      Import a bank statement to check it against your transactions
    </EmptyState>
  ) : view === "open" ? (
    <EmptyState
      icon={CheckCircleIcon}
      action={
        <Button variant="quiet" onClick={() => update({ view: "resolved", page: null, peek: null })}>
          Show resolved
        </Button>
      }
    >
      Nothing to review
    </EmptyState>
  ) : (
    <EmptyState>{outcome ? `No ${OUTCOMES[outcome].label.toLowerCase()} rows` : "No resolved rows"}</EmptyState>
  )

  const openRow = (row: BankStatementRow, status: OpenStatus) => (
    <Row key={row.id} {...OPEN_COLUMNS} label={bankRowTitle(row)} selected={row.id === peekId} onOpen={() => openPeek(row.id)}>
      <IconGlyph icon={BANDS.find((band) => band.status === status)?.icon ?? CircleDashedIcon} />
      <Cell strong>{bankRowTitle(row)}</Cell>
      <Cell tone="muted" hide="mobile">
        {shortDateLabel(row.booking_date)}
      </Cell>
      {status === "suggested" && row.suggested_transaction ? (
        <Cell hide="narrow">
          <CategoryGlyph
            inline
            categoryId={row.suggested_transaction.category_id}
            icon={row.suggested_transaction.category_icon}
            name={row.suggested_transaction.category}
          />
          {candidateTitle(row.suggested_transaction)} · {dayDistance(row.suggested_transaction.date_delta_days)}
        </Cell>
      ) : status === "ambiguous" ? (
        <Cell tone="muted" hide="narrow">
          {row.candidate_count} possible matches
        </Cell>
      ) : (
        <Cell tone="faint" hide="narrow">
          No transaction with this amount
        </Cell>
      )}
      <Cell hide="mobile">
        <RowActions>
          <IgnoreMenu trigger={ignoreTrigger()} onIgnore={(reason) => void ignore(row, reason).then(reportFailure)} onOtherReason={() => startIgnore(row)} />
          {status === "suggested" ? (
            <Button variant="quiet" disabled={pending} onClick={() => void matchSuggestion(row)}>
              Match
            </Button>
          ) : status === "ambiguous" ? (
            <Button variant="quiet" onClick={() => openPeek(row.id)}>
              Choose
            </Button>
          ) : (
            <Button variant="quiet" onClick={() => startCreate(row)}>
              Create…
            </Button>
          )}
        </RowActions>
      </Cell>
      <AmountCell>
        <BankAmount row={row} />
      </AmountCell>
    </Row>
  )

  const resolvedRow = (row: BankStatementRow) => {
    const resolution = row.resolution ?? "matched"
    const transaction = row.suggested_transaction
    return (
      <Row key={row.id} {...RESOLVED_COLUMNS} label={bankRowTitle(row)} selected={row.id === peekId} onOpen={() => openPeek(row.id)}>
        <IconGlyph icon={OUTCOMES[resolution].icon} />
        <Cell strong>{bankRowTitle(row)}</Cell>
        <Cell tone="muted" hide="mobile">
          {shortDateLabel(row.booking_date)}
        </Cell>
        {resolution === "ignored" || !transaction ? (
          <Cell tone="muted" hide="narrow">
            {row.ignore_reason ? `Ignored · ${row.ignore_reason}` : OUTCOMES[resolution].label}
          </Cell>
        ) : (
          <Cell hide="narrow">
            <CategoryGlyph inline categoryId={transaction.category_id} icon={transaction.category_icon} name={transaction.category} />
            {candidateTitle(transaction)}
          </Cell>
        )}
        <AmountCell>
          <BankAmount row={row} />
        </AmountCell>
      </Row>
    )
  }

  return (
    <Panel
      title="Reconcile"
      peekOpen={peekRow !== null}
      layout="fill"
      actions={
        <Button variant="primary" icon={UploadSimpleIcon} aria-label="Import statement" onClick={() => setImporting(true)}>
          {isDesktop ? "Import statement" : "Import"}
        </Button>
      }
      viewRow={
        <ViewRow end={isDesktop && latestImport?.last_import_at ? `Last import ${shortDateLabel(latestImport.last_import_at.slice(0, 10))} · ${latestImport.label}` : null}>
          <SegmentedControl
            label="Reconcile view"
            value={view}
            options={[
              { value: "open", label: "To review", count: openTotal || undefined },
              { value: "resolved", label: "Resolved" },
            ]}
            onChange={(next) => update({ view: next === "open" ? null : next, outcome: null, page: null, peek: null })}
          />
          {accounts.length ? (
            <Menu
              label="Account"
              align="start"
              trigger={
                <Pill icon={BankIcon} set={account !== null}>
                  {account ?? "All accounts"}
                </Pill>
              }
            >
              <MenuItem checked={account === null} onSelect={() => update({ account: null, page: null, peek: null })}>
                All accounts
              </MenuItem>
              {accounts.map((entry) => (
                <MenuItem
                  key={entry.label}
                  checked={account === entry.label}
                  onSelect={() => update({ account: entry.label, page: null, peek: null })}
                >
                  {entry.label}
                </MenuItem>
              ))}
            </Menu>
          ) : null}
          {view === "resolved" ? (
            <Menu
              label="Outcome"
              align="start"
              trigger={
                <Pill icon={FunnelIcon} set={outcome !== null} aria-label={`Outcome: ${outcome ? OUTCOMES[outcome].label : "All outcomes"}`}>
                  {isDesktop || outcome ? (outcome ? OUTCOMES[outcome].label : "All outcomes") : null}
                </Pill>
              }
            >
              <MenuItem checked={outcome === null} onSelect={() => update({ outcome: null, page: null, peek: null })}>
                All outcomes
              </MenuItem>
              {(Object.keys(OUTCOMES) as BankRowResolution[]).map((key) => (
                <MenuItem
                  key={key}
                  icon={OUTCOMES[key].icon}
                  checked={outcome === key}
                  onSelect={() => update({ outcome: key, page: null, peek: null })}
                >
                  {OUTCOMES[key].label}
                </MenuItem>
              ))}
            </Menu>
          ) : null}
        </ViewRow>
      }
    >
      <PeekLayout
        main={
          <List label={view === "open" ? "Bank rows to review" : "Resolved bank rows"} footer={footer}>
            {view === "open"
              ? BANDS.map((band) => {
                  const bandRows = items.filter((row) => row.status === band.status)
                  if (!bandRows.length) return null
                  return [
                    <DayBand
                      key={band.status}
                      label={band.label}
                      count={bandRows.length}
                      end={
                        band.status === "suggested" ? (
                          <Button variant="ghost" icon={ChecksIcon} disabled={pending} onClick={() => void matchAll(bandRows)}>
                            Match all
                          </Button>
                        ) : undefined
                      }
                    />,
                    ...bandRows.map((row) => openRow(row, band.status)),
                  ]
                })
              : items.map(resolvedRow)}
          </List>
        }
        peek={
          peekRow ? (
            view === "open" ? (
              <OpenRowPeek
                key={peekRow.id}
                row={peekRow}
                pending={pending}
                onClose={closePeek}
                onMatch={(transaction, setAmount) => void matchTransaction(peekRow, transaction, setAmount)}
                onCreate={() => startCreate(peekRow)}
                onIgnore={(reason) => void ignore(peekRow, reason).then(reportFailure)}
                onOtherReason={() => startIgnore(peekRow)}
              />
            ) : (
              <ResolvedRowPeek
                key={peekRow.id}
                row={peekRow}
                pending={pending}
                onClose={closePeek}
                onReopen={() => (peekRow.resolution === "created" ? setReopening(peekRow) : void reopenRow(peekRow, false))}
              />
            )
          ) : null
        }
      />
      {importing ? (
        <ImportStatementDialog
          accounts={accounts}
          onClose={() => setImporting(false)}
          onImported={(imported, duplicates) => {
            setImporting(false)
            void queryClient.invalidateQueries({ queryKey: ["reconciliation"] })
            update({ view: null, outcome: null, page: null, peek: null })
            showToast({
              message: duplicates
                ? `Imported ${plural(imported, "row")} · ${duplicates} already imported`
                : `Imported ${plural(imported, "row")}`,
            })
          }}
        />
      ) : null}
      {creating ? (
        <CreateFromRowDialog
          key={creating.id}
          row={creating}
          pending={pending}
          error={dialogError}
          onClose={() => setCreating(null)}
          onSubmit={(payload, receipt) => void createFromRow(creating, payload, receipt)}
        />
      ) : null}
      {ignoring ? (
        <IgnoreReasonDialog
          key={ignoring.id}
          row={ignoring}
          pending={pending}
          error={dialogError}
          onClose={() => setIgnoring(null)}
          onSubmit={(reason) =>
            void ignore(ignoring, reason).then((error) => {
              if (error) setDialogError(error)
              else setIgnoring(null)
            })
          }
        />
      ) : null}
      {reopening ? (
        <ReopenCreatedDialog
          transactionTitle={reopening.suggested_transaction ? candidateTitle(reopening.suggested_transaction) : bankRowTitle(reopening)}
          pending={pending}
          onClose={() => setReopening(null)}
          onReopen={(trash) => void reopenRow(reopening, trash)}
        />
      ) : null}
    </Panel>
  )
}

export default ReconciliationPage
