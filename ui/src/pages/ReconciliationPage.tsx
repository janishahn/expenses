import { useRef, useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BankIcon } from "@phosphor-icons/react/Bank"
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle"
import { UploadSimpleIcon } from "@phosphor-icons/react/UploadSimple"
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle"
import { Link } from "react-router-dom"
import { apiFetch, apiFetchFormData } from "../app/api"
import type {
  BankReconciliationResponse,
  BankStatementPreviewResponse,
  BankStatementRow,
  BankStatementRowStatus,
  BankReconciliationTransaction,
} from "../app/api-types"
import { formatCurrency, formatEuroDate } from "../app/format"
import PageIntro from "../components/PageIntro"
import { AppButton } from "../components/ui/product-button"
import { AppCard } from "../components/ui/product-card"
import { AppFieldLabel, AppInput } from "../components/ui/product-fields"

type RowAction = "accept-suggestion" | "review" | "reopen" | "create-transaction"

const statusCopy: Record<BankStatementRowStatus, string> = {
  matched: "Matched",
  suggested: "Suggested",
  ambiguous: "Ambiguous",
  missing: "Missing",
  reviewed: "Reviewed",
}

function amountTone(amount: number) {
  return amount >= 0 ? "text-semantic-green" : "text-semantic-red"
}

function statusTone(status: BankStatementRowStatus) {
  if (status === "matched") return "border-semantic-green/30 bg-semantic-green/10 text-semantic-green"
  if (status === "suggested") return "border-semantic-blue/30 bg-semantic-blue/10 text-semantic-blue"
  if (status === "reviewed") return "border-border bg-faint text-muted"
  return "border-semantic-red/30 bg-semantic-red/10 text-semantic-red"
}

function transactionLabel(transaction: BankReconciliationTransaction) {
  const dateDelta =
    transaction.date_delta_days === 0
      ? "same day"
      : transaction.date_delta_days > 0
        ? `${transaction.date_delta_days}d earlier in Expenses`
        : `${Math.abs(transaction.date_delta_days)}d later in Expenses`
  return `${formatEuroDate(transaction.date)} · ${dateDelta}`
}

function ReconciliationPage() {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [accountLabel, setAccountLabel] = useState("StartKonto")
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<BankStatementPreviewResponse | null>(null)
  const [message, setMessage] = useState("")
  const [errorMessage, setErrorMessage] = useState("")

  const { data, isLoading, error } = useQuery({
    queryKey: ["reconciliation"],
    queryFn: () => apiFetch<BankReconciliationResponse>("/api/reconciliation"),
  })

  const previewMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append("account_label", accountLabel)
      form.append("file", file)
      return apiFetchFormData<BankStatementPreviewResponse>(
        "/api/reconciliation/commerzbank-csv/preview",
        { method: "POST", body: form }
      )
    },
    onSuccess: (result) => {
      setPreview(result)
      setMessage("")
      setErrorMessage("")
    },
    onError: (mutationError) => {
      setPreview(null)
      setMessage("")
      setErrorMessage(String(mutationError))
    },
  })

  const commitMutation = useMutation({
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
      setPreview(null)
      setMessage(
        `Imported ${result.imported_count} new row(s), skipped ${result.duplicate_count} duplicate(s).`
      )
      setErrorMessage("")
      queryClient.invalidateQueries({ queryKey: ["reconciliation"] })
    },
    onError: (mutationError) => {
      setMessage("")
      setErrorMessage(String(mutationError))
    },
  })

  const rowActionMutation = useMutation({
    mutationFn: ({ rowId, action }: { rowId: number; action: RowAction }) =>
      apiFetch<{ status?: string; transaction_id?: number }>(
        `/api/reconciliation/bank-rows/${rowId}/${action}`,
        { method: "POST" }
      ),
    onSuccess: () => {
      setMessage("")
      setErrorMessage("")
      queryClient.invalidateQueries({ queryKey: ["reconciliation"] })
      queryClient.invalidateQueries({ queryKey: ["transactions"] })
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
    },
    onError: (mutationError) => {
      setMessage("")
      setErrorMessage(String(mutationError))
    },
  })

  const handlePreview = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!csvFile) {
      setErrorMessage("Choose a Commerzbank CSV file first.")
      return
    }
    previewMutation.mutate(csvFile)
  }

  const handleImport = () => {
    if (!csvFile) {
      setErrorMessage("Choose a Commerzbank CSV file first.")
      return
    }
    commitMutation.mutate(csvFile)
  }

  const rows = data?.rows ?? []
  const unresolvedRows = rows.filter(
    (row) => row.status === "missing" || row.status === "ambiguous"
  )
  const suggestedRows = rows.filter((row) => row.status === "suggested")

  if (isLoading) {
    return (
      <section className="space-y-6" data-testid="reconciliation-page">
        <PageIntro title="Reconciliation" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)]">
          <div className="h-72 animate-pulse rounded-2xl bg-surface-hi/40" />
          <div className="h-72 animate-pulse rounded-2xl bg-surface-hi/40" />
        </div>
      </section>
    )
  }

  if (error) {
    return <div className="text-semantic-red">Unable to load reconciliation.</div>
  }

  return (
    <section data-testid="reconciliation-page" className="space-y-6">
      <PageIntro title="Reconciliation" />
      <p className="max-w-3xl text-sm leading-6 text-muted">
        Import Commerzbank CSV rows as external evidence, then reconcile them against
        Expenses with a five-day booking window for delayed card postings.
      </p>

      <div className="grid gap-4 md:grid-cols-4">
        <Metric label="Bank rows" value={`${data?.summary.row_count ?? 0}`} />
        <Metric label="Needs review" value={`${data?.summary.unresolved_count ?? 0}`} tone="red" />
        <Metric label="Suggested" value={`${data?.summary.suggested_count ?? 0}`} tone="blue" />
        <Metric
          label="Statement delta"
          value={`${formatCurrency(data?.summary.bank_total_cents ?? 0)} €`}
          tone={(data?.summary.bank_total_cents ?? 0) >= 0 ? "green" : "red"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)] [&>*]:min-w-0">
        <div className="space-y-4">
          <AppCard className="p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div className="space-y-1">
                <h2 className="font-head text-2xl font-bold tracking-tight">
                  Commerzbank CSV
                </h2>
                <p className="text-sm text-muted">
                  Export one account at a time from Online Banking, then preview before importing.
                </p>
              </div>
              <BankIcon className="hidden h-8 w-8 text-muted md:block" />
            </div>

            <form onSubmit={handlePreview} className="mt-5 grid gap-3 md:grid-cols-[220px_1fr_auto] md:items-end">
              <div className="space-y-1.5">
                <AppFieldLabel htmlFor="reconciliation-account">Account label</AppFieldLabel>
                <AppInput
                  id="reconciliation-account"
                  value={accountLabel}
                  onChange={(event) => {
                    setAccountLabel(event.target.value)
                    setPreview(null)
                  }}
                  placeholder="StartKonto"
                />
              </div>
              <div className="space-y-1.5">
                <AppFieldLabel htmlFor="reconciliation-file">CSV file</AppFieldLabel>
                <AppInput
                  ref={fileInputRef}
                  id="reconciliation-file"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => {
                    setCsvFile(event.target.files?.[0] ?? null)
                    setPreview(null)
                  }}
                />
              </div>
              <AppButton
                type="submit"
                disabled={previewMutation.isPending || commitMutation.isPending}
                className="md:mb-0"
              >
                <UploadSimpleIcon className="h-4 w-4" />
                {previewMutation.isPending ? "Previewing…" : "Preview CSV"}
              </AppButton>
            </form>

            {preview ? (
              <div className="mt-5 rounded-xl border border-border bg-surface-hi/45 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="font-semibold text-text">
                      {preview.new_count} new row(s), {preview.duplicate_count} duplicate(s)
                    </p>
                    <p className="text-xs text-muted">
                      {preview.rows.length} parsed row(s) for {preview.account_label}.
                    </p>
                  </div>
                  <AppButton
                    type="button"
                    onClick={handleImport}
                    disabled={
                      preview.new_count === 0 ||
                      preview.errors.length > 0 ||
                      commitMutation.isPending
                    }
                  >
                    {commitMutation.isPending ? "Importing…" : "Import rows"}
                  </AppButton>
                </div>

                {preview.errors.length > 0 ? (
                  <div className="mt-3 rounded-lg border border-semantic-red/25 bg-semantic-red/10 p-3 text-xs text-semantic-red">
                    {preview.errors.map((previewError) => (
                      <p key={previewError}>{previewError}</p>
                    ))}
                  </div>
                ) : null}

                <div className="mt-4 max-h-64 overflow-auto rounded-lg border border-border/70">
                  {preview.rows.slice(0, 8).map((row, index) => (
                    <div
                      key={`${row.booking_date}-${row.amount_cents}-${index}`}
                      className="grid gap-2 border-b border-border/70 px-3 py-2 text-xs last:border-b-0 md:grid-cols-[90px_1fr_auto]"
                    >
                      <span className="font-mono text-muted">
                        {formatEuroDate(row.booking_date)}
                      </span>
                      <span className="truncate text-text">{row.raw_description}</span>
                      <span className={`font-mono font-semibold ${amountTone(row.amount_cents)}`}>
                        {formatCurrency(row.amount_cents)} €
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {message ? <p className="mt-3 text-sm font-semibold text-semantic-green">{message}</p> : null}
            {errorMessage ? <p className="mt-3 text-sm text-semantic-red">{errorMessage}</p> : null}
          </AppCard>

          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-head text-2xl font-bold tracking-tight">Statement rows</h2>
                <p className="text-sm text-muted">
                  Conservative matches use amount, type, and date. Vendor text only breaks ties.
                </p>
              </div>
              {suggestedRows.length > 0 ? (
                <p className="rounded-full border border-semantic-blue/25 bg-semantic-blue/10 px-3 py-1 text-xs font-semibold text-semantic-blue">
                  {suggestedRows.length} suggestion(s) waiting
                </p>
              ) : null}
            </div>

            {rows.length > 0 ? (
              <div className="space-y-3">
                {rows.map((row) => (
                  <BankRowCard
                    key={row.id}
                    row={row}
                    pending={rowActionMutation.isPending}
                    onAction={(action) => rowActionMutation.mutate({ rowId: row.id, action })}
                  />
                ))}
              </div>
            ) : (
              <AppCard className="p-8 text-center">
                <CheckCircleIcon className="mx-auto h-9 w-9 text-muted" />
                <h3 className="mt-3 font-head text-xl font-bold">No bank rows imported</h3>
                <p className="mx-auto mt-2 max-w-md text-sm text-muted">
                  Start with a CSV export from Commerzbank Online Banking. The import keeps
                  bank evidence separate until you accept or create a transaction.
                </p>
              </AppCard>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <AppCard className="p-5">
            <h2 className="font-head text-xl font-bold tracking-tight">Review queue</h2>
            <p className="mt-1 text-sm text-muted">
              Missing rows are likely untracked spending, cash withdrawals, or imports that
              need a manual decision.
            </p>
            <div className="mt-4 space-y-2">
              {unresolvedRows.slice(0, 6).map((row) => (
                <div key={row.id} className="rounded-lg border border-border bg-surface-hi/40 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-semibold text-text">
                      {row.payee || row.booking_text || "Bank row"}
                    </p>
                    <span className={`font-mono text-sm font-semibold ${amountTone(row.amount_cents)}`}>
                      {formatCurrency(row.amount_cents)} €
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {formatEuroDate(row.booking_date)} · {statusCopy[row.status]}
                  </p>
                </div>
              ))}
              {unresolvedRows.length === 0 ? (
                <p className="rounded-lg border border-border bg-surface-hi/40 p-3 text-sm text-muted">
                  No unresolved bank rows right now.
                </p>
              ) : null}
            </div>
          </AppCard>

          <AppCard className="p-5">
            <h2 className="font-head text-xl font-bold tracking-tight">Only in Expenses</h2>
            <p className="mt-1 text-sm text-muted">
              These nearby app entries did not get a bank match yet. Cash and early manual
              entries often belong here.
            </p>
            <div className="mt-4 space-y-2">
              {(data?.only_in_expenses ?? []).slice(0, 10).map((transaction) => (
                <Link
                  key={transaction.id}
                  to={`/transactions/${transaction.id}`}
                  className="block rounded-lg border border-border bg-surface-hi/40 p-3 transition hover:border-border-hi hover:bg-faint/70 active:scale-[0.99]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-semibold text-text">
                      {transaction.title || "Untitled transaction"}
                    </p>
                    <span className={`font-mono text-sm font-semibold ${amountTone(transaction.signed_amount_cents)}`}>
                      {formatCurrency(transaction.signed_amount_cents)} €
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {formatEuroDate(transaction.date)}
                    {transaction.category ? ` · ${transaction.category}` : ""}
                  </p>
                </Link>
              ))}
              {(data?.only_in_expenses ?? []).length === 0 ? (
                <p className="rounded-lg border border-border bg-surface-hi/40 p-3 text-sm text-muted">
                  No unmatched Expenses entries in the imported statement window.
                </p>
              ) : null}
            </div>
          </AppCard>
        </aside>
      </div>
    </section>
  )
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string
  value: string
  tone?: "default" | "red" | "green" | "blue"
}) {
  const toneClass =
    tone === "red"
      ? "text-semantic-red"
      : tone === "green"
        ? "text-semantic-green"
        : tone === "blue"
          ? "text-semantic-blue"
          : "text-text"
  return (
    <AppCard className="p-4">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
        {label}
      </p>
      <p className={`mt-2 font-mono text-2xl font-semibold leading-none ${toneClass}`}>
        {value}
      </p>
    </AppCard>
  )
}

function BankRowCard({
  row,
  pending,
  onAction,
}: {
  row: BankStatementRow
  pending: boolean
  onAction: (action: RowAction) => void
}) {
  return (
    <AppCard className="p-4 transition hover:border-border-hi hover:bg-surface-hi/45">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone(row.status)}`}>
              {statusCopy[row.status]}
            </span>
            <span className="font-mono text-xs text-muted">
              {formatEuroDate(row.booking_date)}
              {row.value_date ? ` · value ${formatEuroDate(row.value_date)}` : ""}
            </span>
          </div>
          <div>
            <h3 className="truncate font-head text-lg font-bold tracking-tight">
              {row.payee || row.booking_text || "Bank transaction"}
            </h3>
            <p className="mt-1 line-clamp-2 text-sm text-muted">{row.raw_description}</p>
          </div>
          {row.suggested_transaction ? (
            <Link
              to={`/transactions/${row.suggested_transaction.id}`}
              className="inline-flex max-w-full items-center gap-2 rounded-lg border border-border bg-faint/50 px-3 py-2 text-sm transition hover:border-border-hi hover:bg-faint active:scale-[0.99]"
            >
              <CheckCircleIcon className="h-4 w-4 shrink-0 text-semantic-green" />
              <span className="truncate">
                {row.suggested_transaction.title || "Matched transaction"}
              </span>
              <span className="shrink-0 text-xs text-muted">
                {transactionLabel(row.suggested_transaction)}
              </span>
            </Link>
          ) : row.status === "ambiguous" ? (
            <p className="inline-flex items-center gap-2 text-xs text-semantic-red">
              <WarningCircleIcon className="h-4 w-4" />
              {row.candidate_count} same-amount candidates in the booking window.
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col gap-3 md:items-end">
          <p className={`font-mono text-xl font-semibold ${amountTone(row.amount_cents)}`}>
            {formatCurrency(row.amount_cents)} {row.currency}
          </p>
          <div className="flex flex-wrap justify-start gap-2 md:justify-end">
            {row.status === "suggested" ? (
              <AppButton
                type="button"
                onClick={() => onAction("accept-suggestion")}
                disabled={pending}
              >
                Accept match
              </AppButton>
            ) : null}
            {row.status === "missing" ? (
              <AppButton
                type="button"
                onClick={() => onAction("create-transaction")}
                disabled={pending}
              >
                Create transaction
              </AppButton>
            ) : null}
            {row.status === "missing" || row.status === "ambiguous" ? (
              <AppButton
                type="button"
                tone="ghost"
                onClick={() => onAction("review")}
                disabled={pending}
              >
                Mark reviewed
              </AppButton>
            ) : null}
            {row.status === "reviewed" || row.status === "matched" ? (
              <AppButton
                type="button"
                tone="ghost"
                onClick={() => onAction("reopen")}
                disabled={pending}
              >
                Reopen
              </AppButton>
            ) : null}
          </div>
        </div>
      </div>
    </AppCard>
  )
}

export default ReconciliationPage
