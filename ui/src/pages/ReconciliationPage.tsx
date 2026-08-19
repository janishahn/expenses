import { useEffect, useRef, useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle"
import { LinkSimpleIcon } from "@phosphor-icons/react/LinkSimple"
import { PlusIcon } from "@phosphor-icons/react/Plus"
import { UploadSimpleIcon } from "@phosphor-icons/react/UploadSimple"
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle"
import { XIcon } from "@phosphor-icons/react/X"
import { Link } from "react-router-dom"
import { apiFetch, apiFetchFormData, getApiErrorMessage } from "../app/api"
import type {
  BankReconciliationResponse,
  BankReconciliationTransaction,
  BankStatementRow,
  CategoriesResponse,
} from "../app/api-types"
import { formatCurrency, formatEuroDate } from "../app/format"
import { CategoryIcon } from "../components/CategoryIcon"
import PageIntro from "../components/PageIntro"
import RouteError from "../components/RouteError"
import {
  FinancialPanel,
  SectionHeading,
} from "../components/product/ProductSurfaces"
import { AppButton } from "../components/ui/product-button"
import {
  AppFieldLabel,
  AppInput,
  AppNativeSelect,
  AppTextarea,
} from "../components/ui/product-fields"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog"

type CreateTransactionPayload = {
  date: string
  category_id: number | null
  title: string
  description: string | null
}

type RowMutation =
  | { kind: "accept"; rowId: number; notice: string }
  | { kind: "match"; rowId: number; transactionId: number; notice: string }
  | { kind: "create"; rowId: number; payload: CreateTransactionPayload; notice: string }
  | { kind: "reopen"; rowId: number }

type ActionNotice = {
  message: string
  undoRowId: number | null
}

function amountTone(amount: number) {
  return amount >= 0 ? "text-semantic-green" : "text-semantic-red"
}

function transactionDateLabel(transaction: BankReconciliationTransaction) {
  const dateDelta =
    transaction.date_delta_days === 0
      ? "same day"
      : transaction.date_delta_days > 0
        ? `${transaction.date_delta_days}d before booking`
        : `${Math.abs(transaction.date_delta_days)}d after booking`
  return `${formatEuroDate(transaction.date)} · ${dateDelta}`
}

function rowTitle(row: BankStatementRow) {
  return row.payee || row.booking_text || row.purpose || "Bank transaction"
}

function ReconciliationPage() {
  const queryClient = useQueryClient()
  const removalTimer = useRef<number | null>(null)
  const noticeTimer = useRef<number | null>(null)
  const [accountLabel, setAccountLabel] = useState("StartKonto")
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [importMessage, setImportMessage] = useState("")
  const [importError, setImportError] = useState("")
  const [actionError, setActionError] = useState("")
  const [leavingRowId, setLeavingRowId] = useState<number | null>(null)
  const [createRow, setCreateRow] = useState<BankStatementRow | null>(null)
  const [matchRow, setMatchRow] = useState<BankStatementRow | null>(null)
  const [notice, setNotice] = useState<ActionNotice | null>(null)

  useEffect(
    () => () => {
      if (removalTimer.current !== null) window.clearTimeout(removalTimer.current)
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
    },
    []
  )

  const { data, isLoading, error } = useQuery({
    queryKey: ["reconciliation"],
    queryFn: () => apiFetch<BankReconciliationResponse>("/api/reconciliation"),
  })

  const { data: categoriesData } = useQuery({
    queryKey: ["categories", "all"],
    queryFn: () => apiFetch<CategoriesResponse>("/api/categories?period=all"),
    enabled: createRow !== null,
  })

  const importMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append("account_label", accountLabel)
      form.append("file", file)
      return apiFetchFormData<{ imported_count: number; duplicate_count: number }>(
        "/api/reconciliation/commerzbank-csv/commit",
        { method: "POST", body: form }
      )
    },
    onSuccess: (result) => {
      setImportMessage(
        `${result.imported_count} imported · ${result.duplicate_count} duplicate${result.duplicate_count === 1 ? "" : "s"} skipped`
      )
      setImportError("")
      queryClient.invalidateQueries({ queryKey: ["reconciliation"] })
    },
    onError: (mutationError) => {
      setImportMessage("")
      setImportError(getApiErrorMessage(mutationError, "Unable to reconcile this file."))
    },
  })

  const invalidateReconciliation = () => {
    queryClient.invalidateQueries({ queryKey: ["reconciliation"] })
    queryClient.invalidateQueries({ queryKey: ["transactions"] })
    queryClient.invalidateQueries({ queryKey: ["dashboard"] })
  }

  const rowMutation = useMutation({
    mutationFn: (mutation: RowMutation) => {
      if (mutation.kind === "accept") {
        return apiFetch<{ status: string }>(
          `/api/reconciliation/bank-rows/${mutation.rowId}/accept-suggestion`,
          { method: "POST" }
        )
      }
      if (mutation.kind === "match") {
        return apiFetch<{ status: string; transaction_id: number }>(
          `/api/reconciliation/bank-rows/${mutation.rowId}/match-transaction`,
          {
            method: "POST",
            body: JSON.stringify({ transaction_id: mutation.transactionId }),
          }
        )
      }
      if (mutation.kind === "create") {
        return apiFetch<{ status: string; transaction_id: number }>(
          `/api/reconciliation/bank-rows/${mutation.rowId}/create-transaction`,
          { method: "POST", body: JSON.stringify(mutation.payload) }
        )
      }
      return apiFetch<{ status: string }>(
        `/api/reconciliation/bank-rows/${mutation.rowId}/reopen`,
        { method: "POST" }
      )
    },
    onSuccess: (_result, mutation) => {
      setActionError("")
      if (mutation.kind === "reopen") {
        setNotice(null)
        invalidateReconciliation()
        return
      }

      setCreateRow(null)
      setMatchRow(null)
      setLeavingRowId(mutation.rowId)
      setNotice({
        message: mutation.notice,
        undoRowId: mutation.kind === "create" ? null : mutation.rowId,
      })
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
      noticeTimer.current = window.setTimeout(() => setNotice(null), 5000)
      removalTimer.current = window.setTimeout(() => {
        queryClient.setQueryData<BankReconciliationResponse>(
          ["reconciliation"],
          (current) => {
            if (!current) return current
            const resolvedRow = current.rows.find((row) => row.id === mutation.rowId)
            if (!resolvedRow) return current
            return {
              ...current,
              summary: {
                ...current.summary,
                unresolved_count:
                  current.summary.unresolved_count -
                  (resolvedRow.status === "missing" || resolvedRow.status === "ambiguous"
                    ? 1
                    : 0),
                suggested_count:
                  current.summary.suggested_count -
                  (resolvedRow.status === "suggested" ? 1 : 0),
                matched_count: current.summary.matched_count + 1,
              },
              rows: current.rows.filter((row) => row.id !== mutation.rowId),
            }
          }
        )
        removalTimer.current = null
        setLeavingRowId(null)
        invalidateReconciliation()
      }, 180)
    },
    onError: (mutationError) => {
      setActionError(
        getApiErrorMessage(mutationError, "Unable to update this reconciliation item.")
      )
    },
  })

  const handleReconcile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!csvFile) {
      setImportError("Choose a Commerzbank CSV file first.")
      return
    }
    setImportError("")
    importMutation.mutate(csvFile)
  }

  const rows = data?.rows ?? []
  const inboxRows = rows.filter(
    (row) =>
      row.status === "suggested" ||
      row.status === "ambiguous" ||
      row.status === "missing"
  )
  const matchedCount = data?.summary.matched_count ?? 0
  const reviewedCount = data?.summary.reviewed_count ?? 0
  const queueBusy = rowMutation.isPending || leavingRowId !== null

  if (isLoading) {
    return (
      <section className="space-y-6" data-testid="reconciliation-page">
        <PageIntro title="Reconciliation" />
        <div className="h-24 animate-pulse rounded-2xl bg-surface-hi/40" />
        <div className="h-72 animate-pulse rounded-2xl bg-surface-hi/40" />
      </section>
    )
  }

  if (error) {
    return <RouteError title="Reconciliation" message="Unable to load reconciliation." />
  }

  return (
    <section data-testid="reconciliation-page" className="space-y-4">
      <PageIntro title="Reconciliation" />

      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 font-mono text-xs text-muted"
        aria-label="Reconciliation summary"
      >
        <span><strong className="text-text">{data?.summary.row_count ?? 0}</strong> imported</span>
        <span aria-hidden="true" className="h-1 w-1 rounded-full bg-border-hi" />
        <span><strong className="text-text">{matchedCount + reviewedCount}</strong> cleared</span>
        <span aria-hidden="true" className="h-1 w-1 rounded-full bg-border-hi" />
        <span><strong className="text-text">{inboxRows.length}</strong> remaining</span>
        <span aria-hidden="true" className="h-1 w-1 rounded-full bg-border-hi" />
        <span className={amountTone(data?.summary.bank_total_cents ?? 0)}>
          <strong>{formatCurrency(data?.summary.bank_total_cents ?? 0)} €</strong> net
        </span>
      </div>

      <FinancialPanel role="inspector" className="p-4">
        <form
          onSubmit={handleReconcile}
          className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)_auto] md:items-end"
        >
          <div className="space-y-1.5">
            <AppFieldLabel htmlFor="reconciliation-account">Account label</AppFieldLabel>
            <AppInput
              id="reconciliation-account"
              value={accountLabel}
              onChange={(event) => setAccountLabel(event.target.value)}
              placeholder="StartKonto"
            />
          </div>
          <div className="space-y-1.5">
            <AppFieldLabel htmlFor="reconciliation-file">CSV file</AppFieldLabel>
            <input
              id="reconciliation-file"
              type="file"
              accept=".csv,text/csv"
              className="peer sr-only"
              onChange={(event) => {
                setCsvFile(event.target.files?.[0] ?? null)
                setImportMessage("")
                setImportError("")
              }}
            />
            <label
              htmlFor="reconciliation-file"
              className="field flex min-h-11 w-full cursor-pointer items-center overflow-hidden rounded-lg border border-border bg-surface-hi text-sm text-text transition-[border-color,box-shadow] hover:border-border-hi peer-focus-visible:border-accent peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
            >
              <span className="flex min-h-11 shrink-0 items-center border-r border-border bg-faint px-3 font-semibold">
                Choose file
              </span>
              <span className="min-w-0 truncate px-3 text-muted">
                {csvFile?.name ?? "No file selected"}
              </span>
            </label>
          </div>
          <AppButton type="submit" disabled={importMutation.isPending}>
            <UploadSimpleIcon data-icon="inline-start" className="h-4 w-4" />
            {importMutation.isPending ? "Reconciling…" : "Reconcile"}
          </AppButton>
        </form>
        {importMessage ? (
          <p className="mt-3 text-sm font-semibold text-semantic-green" role="status">
            {importMessage}
          </p>
        ) : null}
        {importError ? (
          <p className="mt-3 text-sm text-semantic-red" role="alert">{importError}</p>
        ) : null}
      </FinancialPanel>

      <FinancialPanel role="ledger">
        <SectionHeading>
          <h2 className="font-head text-xl font-bold tracking-tight">
            {inboxRows.length === 0
              ? data?.summary.row_count
                ? "Inbox cleared"
                : "No bank rows imported"
              : `${inboxRows.length} item${inboxRows.length === 1 ? "" : "s"} to reconcile`}
          </h2>
        </SectionHeading>

        {actionError && !createRow && !matchRow ? (
          <p
            className="mx-4 mb-2 rounded-lg border border-semantic-red/25 bg-semantic-red/10 px-3 py-2 text-sm text-semantic-red"
            role="alert"
          >
            {actionError}
          </p>
        ) : null}

        {inboxRows.length > 0 ? (
          <div className="divide-y divide-border">
            {inboxRows.map((row) => (
              <InboxRow
                key={row.id}
                row={row}
                leaving={leavingRowId === row.id}
                pending={rowMutation.isPending && rowMutation.variables?.rowId === row.id}
                disabled={queueBusy}
                onAccept={() =>
                  rowMutation.mutate({
                    kind: "accept",
                    rowId: row.id,
                    notice: `${rowTitle(row)} matched`,
                  })
                }
                onChoose={() => {
                  setActionError("")
                  setMatchRow(row)
                }}
                onCreate={() => {
                  setActionError("")
                  setCreateRow(row)
                }}
              />
            ))}
          </div>
        ) : (
          <div className="p-10 text-center">
            <CheckCircleIcon
              className={`mx-auto h-10 w-10 ${data?.summary.row_count ? "text-semantic-green" : "text-muted"}`}
              weight={data?.summary.row_count ? "fill" : "regular"}
            />
          </div>
        )}
      </FinancialPanel>

      {notice ? (
        <div
          className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] left-1/2 z-[80] flex min-h-11 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center gap-3 rounded-xl border border-border bg-text px-4 py-2 text-sm text-surface shadow-2xl"
          role="status"
        >
          <CheckCircleIcon className="h-5 w-5 shrink-0 text-semantic-green" weight="fill" />
          <span className="min-w-0 flex-1 truncate font-semibold">{notice.message}</span>
          {notice.undoRowId !== null ? (
            <button
              type="button"
              className="min-h-11 shrink-0 px-1 font-semibold text-surface underline underline-offset-4 transition-[opacity,transform] hover:opacity-75 active:scale-[0.96] desk:min-h-0"
              onClick={() => {
                if (removalTimer.current !== null) {
                  window.clearTimeout(removalTimer.current)
                  removalTimer.current = null
                  setLeavingRowId(null)
                }
                rowMutation.mutate({ kind: "reopen", rowId: notice.undoRowId! })
              }}
              disabled={rowMutation.isPending}
            >
              Undo
            </button>
          ) : null}
        </div>
      ) : null}

      {createRow ? (
        <CreateTransactionDialog
          key={createRow.id}
          row={createRow}
          categories={categoriesData?.categories ?? []}
          pending={rowMutation.isPending}
          errorMessage={actionError}
          onClose={() => {
            if (!rowMutation.isPending) setCreateRow(null)
          }}
          onSubmit={(payload) =>
            rowMutation.mutate({
              kind: "create",
              rowId: createRow.id,
              payload,
              notice: "Transaction created and matched",
            })
          }
        />
      ) : null}

      {matchRow ? (
        <MatchTransactionDialog
          key={matchRow.id}
          row={matchRow}
          pending={rowMutation.isPending}
          errorMessage={actionError}
          onClose={() => {
            if (!rowMutation.isPending) setMatchRow(null)
          }}
          onCreate={() => {
            setMatchRow(null)
            setCreateRow(matchRow)
          }}
          onSubmit={(transaction) =>
            rowMutation.mutate({
              kind: "match",
              rowId: matchRow.id,
              transactionId: transaction.id,
              notice: `${rowTitle(matchRow)} matched`,
            })
          }
        />
      ) : null}
    </section>
  )
}

function InboxRow({
  row,
  leaving,
  pending,
  disabled,
  onAccept,
  onChoose,
  onCreate,
}: {
  row: BankStatementRow
  leaving: boolean
  pending: boolean
  disabled: boolean
  onAccept: () => void
  onChoose: () => void
  onCreate: () => void
}) {
  const suggestion = row.suggested_transaction
  return (
    <article
      data-testid={`reconciliation-row-${row.id}`}
      className={`px-4 py-5 transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none sm:px-5 ${
        leaving ? "translate-x-3 opacity-0 motion-reduce:translate-x-0" : "opacity-100"
      }`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-muted">
          <StatusLabel status={row.status} />
          <span className="whitespace-nowrap">
            {formatEuroDate(row.booking_date)} booked
            {row.value_date ? ` · ${formatEuroDate(row.value_date)} value` : ""}
          </span>
        </div>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold leading-6 text-text">
              {rowTitle(row)}
            </h3>
            <p className="mt-0.5 line-clamp-2 text-[13px] leading-5 text-muted">
              {row.raw_description}
            </p>
          </div>
          <strong className={`shrink-0 font-mono text-base font-semibold leading-6 ${amountTone(row.amount_cents)}`}>
            {formatCurrency(row.amount_cents)} {row.currency}
          </strong>
        </div>
      </div>

      {suggestion ? (
        <div className="mt-3 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg bg-semantic-green/10 px-3 py-2">
            <LinkSimpleIcon className="h-4 w-4 shrink-0 text-semantic-green" weight="bold" />
            <CandidateSummary transaction={suggestion} />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <AppButton type="button" tone="ghost" onClick={onCreate} disabled={disabled}>
              Create new
            </AppButton>
            <AppButton type="button" onClick={onAccept} disabled={disabled}>
              {pending ? "Matching…" : "Match"}
            </AppButton>
          </div>
        </div>
      ) : row.status === "ambiguous" ? (
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-text">
            <WarningCircleIcon className="h-4 w-4 text-text" weight="fill" />
            <span>{row.candidate_count} possible matches</span>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <AppButton type="button" tone="ghost" onClick={onCreate} disabled={disabled}>
              Create new
            </AppButton>
            <AppButton type="button" onClick={onChoose} disabled={disabled}>
              Choose match
            </AppButton>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <strong className="text-sm font-semibold">No Expenses transaction found</strong>
          <div className="flex flex-wrap justify-end gap-2">
            <AppButton type="button" onClick={onCreate} disabled={disabled}>
              <PlusIcon data-icon="inline-start" className="h-4 w-4" weight="bold" />
              Create new transaction
            </AppButton>
          </div>
        </div>
      )}
    </article>
  )
}

function StatusLabel({ status }: { status: BankStatementRow["status"] }) {
  const copy =
    status === "suggested"
      ? "Suggested"
      : status === "ambiguous"
        ? "Choose match"
        : "Not tracked"
  const tone =
    status === "suggested"
      ? "bg-semantic-green/10 text-semantic-green"
      : status === "ambiguous"
        ? "bg-signal-yellow-soft text-text"
        : "bg-semantic-red/10 text-semantic-red"
  return (
    <span className={`rounded-full px-2.5 py-1 font-sans text-[11px] font-semibold leading-none ${tone}`}>
      {copy}
    </span>
  )
}

function CandidateSummary({
  transaction,
  showDescription = false,
  linked = true,
}: {
  transaction: BankReconciliationTransaction
  showDescription?: boolean
  linked?: boolean
}) {
  const title = transaction.title || "Untitled transaction"
  return (
    <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4">
      <span className="min-w-0">
        {linked ? (
          <Link
            to={`/transactions/${transaction.id}`}
            className="block truncate text-sm font-semibold text-text underline-offset-2 hover:underline"
          >
            {title}
          </Link>
        ) : (
          <span className="block truncate text-sm font-semibold text-text">{title}</span>
        )}
        <span className="mt-0.5 block truncate text-xs text-muted">
          {transactionDateLabel(transaction)}
          {transaction.category ? ` · ${transaction.category}` : ""}
        </span>
        {showDescription && transaction.description ? (
          <span className="mt-1 block truncate text-xs text-muted">{transaction.description}</span>
        ) : null}
      </span>
      <strong className={`shrink-0 font-mono text-sm font-semibold ${amountTone(transaction.signed_amount_cents)}`}>
        {formatCurrency(transaction.signed_amount_cents)} €
      </strong>
    </div>
  )
}

function BankReference({ row }: { row: BankStatementRow }) {
  return (
    <div className="flex items-center justify-between gap-4 border-y border-border py-3">
      <span className="min-w-0">
        <strong className="block truncate text-sm">{rowTitle(row)}</strong>
        <span className="font-mono text-xs text-muted">{formatEuroDate(row.booking_date)} booked</span>
      </span>
      <strong className={`shrink-0 font-mono ${amountTone(row.amount_cents)}`}>
        {formatCurrency(row.amount_cents)} {row.currency}
      </strong>
    </div>
  )
}

function CreateTransactionDialog({
  row,
  categories,
  pending,
  errorMessage,
  onClose,
  onSubmit,
}: {
  row: BankStatementRow
  categories: CategoriesResponse["categories"]
  pending: boolean
  errorMessage: string
  onClose: () => void
  onSubmit: (payload: CreateTransactionPayload) => void
}) {
  const titleInputRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState(rowTitle(row))
  const [date, setDate] = useState(row.value_date ?? row.booking_date)
  const [categoryId, setCategoryId] = useState("")
  const [description, setDescription] = useState(row.purpose ?? row.raw_description)
  const transactionType = row.amount_cents >= 0 ? "income" : "expense"
  const availableCategories = categories.filter(
    (category) => category.archived_at === null && category.type === transactionType
  )
  const selectedCategory = availableCategories.find(
    (category) => String(category.id) === categoryId
  )

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!title.trim()) return
    onSubmit({
      date,
      category_id: categoryId ? Number(categoryId) : null,
      title: title.trim(),
      description: description.trim() || null,
    })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-label="Create transaction"
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-5"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          titleInputRef.current?.focus()
        }}
      >
        <DialogHeader>
          <div>
            <DialogTitle>Create transaction</DialogTitle>
            <DialogDescription className="sr-only">
              Edit the transaction details before creating and matching it.
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <AppButton
              type="button"
              tone="ghost"
              className="h-10 w-10 rounded-full p-0"
              aria-label="Close"
              disabled={pending}
            >
              <XIcon className="h-4 w-4" />
            </AppButton>
          </DialogClose>
        </DialogHeader>

        <BankReference row={row} />

        <form onSubmit={submit} className="mt-4 space-y-3">
          <AppFieldLabel>
            <span>Title</span>
            <AppInput
              ref={titleInputRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </AppFieldLabel>

          <div className="grid gap-3 sm:grid-cols-2">
            <AppFieldLabel>
              <span>Transaction date</span>
              <AppInput
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                required
              />
            </AppFieldLabel>
            <AppFieldLabel>
              <span>Category</span>
              <div className="flex items-center gap-2">
                <CategoryIcon
                  icon={selectedCategory?.icon ?? null}
                  label={selectedCategory?.name ?? "Uncategorized"}
                />
                <AppNativeSelect
                  value={categoryId}
                  onChange={(event) => setCategoryId(event.target.value)}
                >
                  <option value="">Uncategorized</option>
                  {availableCategories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </AppNativeSelect>
              </div>
            </AppFieldLabel>
          </div>

          <AppFieldLabel>
            <span>Description (optional)</span>
            <AppTextarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
            />
          </AppFieldLabel>

          {errorMessage ? (
            <p className="text-sm text-semantic-red" role="alert">{errorMessage}</p>
          ) : null}

          <DialogFooter className="flex-col-reverse justify-end sm:flex-row">
            <AppButton type="button" tone="ghost" onClick={onClose} disabled={pending}>
              Cancel
            </AppButton>
            <AppButton type="submit" disabled={pending || !title.trim() || !date}>
              <PlusIcon data-icon="inline-start" className="h-4 w-4" weight="bold" />
              {pending ? "Creating…" : "Create and match"}
            </AppButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function MatchTransactionDialog({
  row,
  pending,
  errorMessage,
  onClose,
  onCreate,
  onSubmit,
}: {
  row: BankStatementRow
  pending: boolean
  errorMessage: string
  onClose: () => void
  onCreate: () => void
  onSubmit: (transaction: BankReconciliationTransaction) => void
}) {
  const [selectedId, setSelectedId] = useState(row.candidates[0]?.id ?? null)
  const selected = row.candidates.find((candidate) => candidate.id === selectedId)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-label="Choose transaction"
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-5"
      >
        <DialogHeader>
          <div>
            <DialogTitle>Choose transaction</DialogTitle>
            <DialogDescription className="sr-only">
              Select an existing transaction to match with this bank row.
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <AppButton
              type="button"
              tone="ghost"
              className="h-10 w-10 rounded-full p-0"
              aria-label="Close"
              disabled={pending}
            >
              <XIcon className="h-4 w-4" />
            </AppButton>
          </DialogClose>
        </DialogHeader>

        <BankReference row={row} />

        <div className="mt-4 space-y-2" role="radiogroup" aria-label="Possible transactions">
          {row.candidates.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              role="radio"
              aria-checked={selectedId === candidate.id}
              className={`w-full rounded-xl border p-3.5 text-left transition-[border-color,background-color,transform] active:scale-[0.99] ${
                selectedId === candidate.id
                  ? "border-accent bg-accent/10"
                  : "border-border bg-surface-hi hover:border-border-hi"
              }`}
              onClick={() => setSelectedId(candidate.id)}
            >
              <CandidateSummary transaction={candidate} showDescription linked={false} />
            </button>
          ))}
        </div>

        {errorMessage ? (
          <p className="mt-3 text-sm text-semantic-red" role="alert">{errorMessage}</p>
        ) : null}

        <DialogFooter className="flex-col-reverse justify-between sm:flex-row">
          <AppButton type="button" tone="ghost" onClick={onCreate} disabled={pending}>
            Create new instead
          </AppButton>
          <AppButton
            type="button"
            disabled={pending || !selected}
            onClick={() => selected && onSubmit(selected)}
          >
            <LinkSimpleIcon data-icon="inline-start" className="h-4 w-4" weight="bold" />
            {pending ? "Matching…" : "Match selected"}
          </AppButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ReconciliationPage
