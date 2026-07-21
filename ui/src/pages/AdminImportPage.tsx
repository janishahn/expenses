import { useRef, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { DatabaseIcon } from "@phosphor-icons/react/Database"
import { apiFetch, apiFetchFormData } from "../app/api"
import { formatCurrency, formatEuroDate } from "../app/format"
import PageIntro from "../components/PageIntro"
import { FinancialPanel } from "../components/product/ProductSurfaces"
import { AppButton } from "../components/ui/product-button"
import { AppNativeSelect } from "../components/ui/product-fields"

type SqliteCategory = {
  id: number
  name: string
  type: string
}

type SqliteMappingRow = {
  idx: number
  legacy_type: string
  legacy_category: string
  transaction_count: number
  suggested_category_id: number | null
  suggested_category_name: string | null
}

type SqliteRecurringRow = {
  description: string
  legacy_type: string
  legacy_category: string
  amount_cents: number
  start_date: string
  recurrence_type: string
  interval: number
  last_processed_date: string | null
  computed_next_occurrence: string | null
}

type SqlitePreview = {
  transactions_count: number
  recurring_count: number
  min_transaction_date: string | null
  max_transaction_date: string | null
  non_midnight_transaction_times: number
  warnings: string[]
  mapping_rows: SqliteMappingRow[]
  recurring_rows: SqliteRecurringRow[]
}

type SqlitePreviewResponse = {
  token: string
  preview: SqlitePreview
  categories: SqliteCategory[]
}

type SqliteCommitResponse = {
  result: Record<string, number>
}

function AdminImportPage() {
  const sqliteInputRef = useRef<HTMLInputElement>(null)

  const [sqliteFile, setSqliteFile] = useState<File | null>(null)
  const [sqlitePreview, setSqlitePreview] = useState<SqlitePreviewResponse | null>(
    null
  )
  const [sqliteStatus, setSqliteStatus] = useState<string>("")
  const [sqliteError, setSqliteError] = useState("")
  const [sqliteMapping, setSqliteMapping] = useState<Record<number, string>>({})
  const [importRecurringRules, setImportRecurringRules] = useState(true)
  const [recurringAutoPost, setRecurringAutoPost] = useState(false)
  const [linkRecurringTransactions, setLinkRecurringTransactions] = useState(true)
  const [preserveTimeInTitle, setPreserveTimeInTitle] = useState(false)

  const sqlitePreviewMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append("file", file)
      return apiFetchFormData<SqlitePreviewResponse>("/api/import/sqlite/preview", {
        method: "POST",
        body: form,
      })
    },
    onSuccess: (data) => {
      setSqlitePreview(data)
      setSqliteStatus("")
      setSqliteError("")

      setImportRecurringRules(data.preview.recurring_count > 0)
      setRecurringAutoPost(false)
      setLinkRecurringTransactions(true)
      setPreserveTimeInTitle(data.preview.non_midnight_transaction_times > 0)

      const nextMapping: Record<number, string> = {}
      for (const row of data.preview.mapping_rows) {
        if (row.suggested_category_id) {
          nextMapping[row.idx] = `existing:${row.suggested_category_id}`
        } else {
          nextMapping[row.idx] = "create"
        }
      }
      setSqliteMapping(nextMapping)
    },
    onError: (error) => {
      setSqlitePreview(null)
      setSqliteStatus("")
      setSqliteError(String(error))
    },
  })

  const sqliteCommitMutation = useMutation({
    mutationFn: async () => {
      if (!sqlitePreview) {
        throw new Error("Upload and preview a legacy database first.")
      }

      const mapping_targets = sqlitePreview.preview.mapping_rows.map((row) => {
        const value = sqliteMapping[row.idx] || "create"
        if (value === "discard") {
          return {
            legacy_type: row.legacy_type,
            legacy_category: row.legacy_category,
            target: "discard" as const,
            existing_category_id: null,
          }
        }
        if (value.startsWith("existing:")) {
          const id = Number(value.split(":", 2)[1])
          return {
            legacy_type: row.legacy_type,
            legacy_category: row.legacy_category,
            target: "existing" as const,
            existing_category_id: id,
          }
        }
        return {
          legacy_type: row.legacy_type,
          legacy_category: row.legacy_category,
          target: "create" as const,
          existing_category_id: null,
        }
      })

      return apiFetch<SqliteCommitResponse>("/api/import/sqlite/commit", {
        method: "POST",
        body: JSON.stringify({
          token: sqlitePreview.token,
          options: {
            import_recurring_rules: importRecurringRules,
            recurring_auto_post: recurringAutoPost,
            link_recurring_transactions: linkRecurringTransactions,
            preserve_time_in_title: preserveTimeInTitle,
          },
          mapping_targets,
        }),
      })
    },
    onSuccess: (data) => {
      const entries = Object.entries(data.result)
      const message = entries.length
        ? entries.map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join(" · ")
        : "Import completed."
      setSqliteStatus(message)
      setSqliteError("")
    },
    onError: (error) => {
      setSqliteStatus("")
      setSqliteError(String(error))
    },
  })

  const handleSqlitePreview = () => {
    setSqliteStatus("")
    setSqliteError("")
    if (!sqliteFile) {
      setSqliteError("Select a .db file first.")
      return
    }
    sqlitePreviewMutation.mutate(sqliteFile)
  }

  const handleSqliteImport = () => {
    setSqliteStatus("")
    setSqliteError("")
    sqliteCommitMutation.mutate()
  }

  return (
    <section className="space-y-4">
      <PageIntro
        title="SQLite Import"
        backHref="/admin"
        backLabel="← Back to admin"
      />

      <FinancialPanel role="inspector" className="mx-auto w-full max-w-6xl p-5">
          <h2 className="text-xl font-head font-bold">Legacy SQLite</h2>
          <p className="mt-1 text-sm text-muted">
            Upload an old expense tracker database and map categories into this
            tracker. CSV import is available in Settings.
          </p>

          <div className="mt-4 space-y-3">
            <input
              type="file"
              ref={sqliteInputRef}
              className="hidden"
              accept=".db"
              aria-label="SQLite database file"
              onChange={(event) => setSqliteFile(event.target.files?.[0] || null)}
            />
            <button
              type="button"
              onClick={() => sqliteInputRef.current?.click()}
              className="w-full cursor-pointer rounded-md border-2 border-dashed border-border px-4 py-8 text-center transition hover:border-accent hover:bg-accent-dim"
            >
              <DatabaseIcon className="mx-auto h-8 w-8 text-muted" />
              <p className="mt-2 text-sm font-semibold text-text">Upload a .db file</p>
              <p className="text-xs text-muted">Legacy SQLite database</p>
              {sqliteFile && <p className="mt-2 text-xs text-accent">{sqliteFile.name}</p>}
            </button>

            <AppButton
              type="button"
              onClick={handleSqlitePreview}
              disabled={sqlitePreviewMutation.isPending || sqliteCommitMutation.isPending}
              tone="ghost"
              className="w-full"
            >
              {sqlitePreviewMutation.isPending ? "Previewing…" : "Preview SQLite"}
            </AppButton>

            {sqliteError ? (
              <p className="text-xs text-semantic-red">{sqliteError}</p>
            ) : null}
            {sqliteStatus ? (
              <p className="text-xs font-semibold text-semantic-green">
                {sqliteStatus}
              </p>
            ) : null}

            {sqlitePreview ? (
              <div className="space-y-4">
                <div className="rounded-lg bg-surface-hi/65 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-text">Preview</p>
                    <span className="chip text-[11px] text-text">
                      {sqlitePreview.preview.transactions_count} txns ·{" "}
                      {sqlitePreview.preview.recurring_count} recurring
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-md bg-surface p-3">
                      <p className="text-xs font-semibold text-muted">
                        Date range
                      </p>
                      <p className="text-sm font-semibold text-text">
                        {sqlitePreview.preview.min_transaction_date
                          ? formatEuroDate(
                              sqlitePreview.preview.min_transaction_date
                            )
                          : "—"}{" "}
                        →{" "}
                        {sqlitePreview.preview.max_transaction_date
                          ? formatEuroDate(
                              sqlitePreview.preview.max_transaction_date
                            )
                          : "—"}
                      </p>
                    </div>
                    <div className="rounded-md bg-surface p-3">
                      <p className="text-xs font-semibold text-muted">
                        Category groups
                      </p>
                      <p className="text-sm font-semibold text-text">
                        {sqlitePreview.preview.mapping_rows.length}
                      </p>
                    </div>
                    <div className="rounded-md bg-surface p-3">
                      <p className="text-xs font-semibold text-muted">
                        Non-midnight times
                      </p>
                      <p className="text-sm font-semibold text-text">
                        {sqlitePreview.preview.non_midnight_transaction_times}
                      </p>
                    </div>
                  </div>

                  {sqlitePreview.preview.warnings.length ? (
                    <ul className="mt-3 list-disc space-y-1 rounded-md border border-semantic-red/35 bg-semantic-red/10 px-5 py-2 text-xs text-semantic-red">
                      {sqlitePreview.preview.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>

                <div className="rounded-lg bg-surface-hi/65 p-4">
                  <p className="mb-2 text-sm font-semibold text-text">Options</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="flex items-center gap-3 rounded-md bg-surface px-3 py-2.5 text-xs text-text">
                      <input
                        type="checkbox"
                        checked={importRecurringRules}
                        onChange={(event) =>
                          setImportRecurringRules(event.target.checked)
                        }
                        className="control-check"
                      />
                      Import recurring rules
                    </label>
                    <label className="flex items-center gap-3 rounded-md bg-surface px-3 py-2.5 text-xs text-text">
                      <input
                        type="checkbox"
                        checked={recurringAutoPost}
                        onChange={(event) =>
                          setRecurringAutoPost(event.target.checked)
                        }
                        className="control-check"
                      />
                      Enable auto-post for imported rules
                    </label>
                    <label className="flex items-center gap-3 rounded-md bg-surface px-3 py-2.5 text-xs text-text">
                      <input
                        type="checkbox"
                        checked={linkRecurringTransactions}
                        onChange={(event) =>
                          setLinkRecurringTransactions(event.target.checked)
                        }
                        className="control-check"
                      />
                      Link "(Recurring)" transactions to rules
                    </label>
                    <label className="flex items-center gap-3 rounded-md bg-surface px-3 py-2.5 text-xs text-text">
                      <input
                        type="checkbox"
                        checked={preserveTimeInTitle}
                        onChange={(event) =>
                          setPreserveTimeInTitle(event.target.checked)
                        }
                        className="control-check"
                      />
                      Append time-of-day to title (if present)
                    </label>
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    Re-running this import can create duplicates for non-recurring
                    transactions.
                  </p>
                </div>

                <div className="rounded-lg bg-surface-hi/65 p-4">
                  <p className="mb-1 text-sm font-semibold text-text">
                    Category mapping
                  </p>
                  <p className="mb-3 text-xs text-muted">
                    Map each legacy category per transaction type (income/expense).
                  </p>

                  <div className="space-y-2">
                    {sqlitePreview.preview.mapping_rows.map((row) => {
                      const cats = sqlitePreview.categories.filter(
                        (cat) => cat.type === row.legacy_type
                      )
                      return (
                        <div
                          key={`${row.legacy_type}-${row.legacy_category}`}
                          className="rounded-md bg-surface p-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-text">
                                {row.legacy_category}
                              </p>
                              <p className="text-xs text-muted">
                                <span className="capitalize">{row.legacy_type}</span>{" "}
                                · {row.transaction_count} txns
                              </p>
                            </div>
                            {row.suggested_category_name ? (
                              <span className="chip text-[11px] text-text">
                                Suggested: {row.suggested_category_name}
                              </span>
                            ) : null}
                          </div>

                          <AppNativeSelect
                            value={sqliteMapping[row.idx] || "create"}
                            onChange={(event) =>
                              setSqliteMapping((prev) => ({
                                ...prev,
                                [row.idx]: event.target.value,
                              }))
                            }
                            className="mt-3"
                          >
                            <option value="discard">
                              Discard all: {row.legacy_category}
                            </option>
                            <option value="create">
                              Create new: {row.legacy_category}
                            </option>
                            {cats.map((cat) => (
                              <option key={cat.id} value={`existing:${cat.id}`}>
                                Map to: {cat.name}
                              </option>
                            ))}
                          </AppNativeSelect>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {sqlitePreview.preview.recurring_rows.length ? (
                  <div className="rounded-lg bg-surface-hi/65 p-4">
                    <p className="mb-3 text-sm font-semibold text-text">
                      Recurring rules (legacy)
                    </p>
                    <div className="overflow-x-auto rounded-lg border border-border">
                      <table className="min-w-full text-xs">
                        <thead className="bg-faint text-[11px] font-semibold uppercase tracking-wide text-muted">
                          <tr>
                            <th className="px-3 py-2 text-left">Name</th>
                            <th className="px-3 py-2 text-left">Type</th>
                            <th className="px-3 py-2 text-left">Category</th>
                            <th className="px-3 py-2 text-right">Amount</th>
                            <th className="px-3 py-2 text-left">Start</th>
                            <th className="px-3 py-2 text-left">Recurrence</th>
                            <th className="px-3 py-2 text-left">Next</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border text-text">
                          {sqlitePreview.preview.recurring_rows.map((row) => (
                            <tr
                              key={`${row.description}-${row.legacy_type}-${row.legacy_category}-${row.amount_cents}`}
                            >
                              <td className="max-w-[240px] truncate px-3 py-2 font-semibold text-text">
                                {row.description}
                              </td>
                              <td className="px-3 py-2 capitalize">
                                {row.legacy_type}
                              </td>
                              <td className="px-3 py-2">{row.legacy_category}</td>
                              <td className="px-3 py-2 text-right font-mono tabular-nums">
                                {formatCurrency(row.amount_cents)} €
                              </td>
                              <td className="px-3 py-2">
                                {formatEuroDate(row.start_date)}
                              </td>
                              <td className="px-3 py-2">
                                {row.recurrence_type} / {row.interval}
                              </td>
                              <td className="px-3 py-2">
                                {row.computed_next_occurrence
                                  ? formatEuroDate(row.computed_next_occurrence)
                                  : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}

                <AppButton
                  type="button"
                  onClick={handleSqliteImport}
                  disabled={sqliteCommitMutation.isPending}
                  className="w-full"
                >
                  {sqliteCommitMutation.isPending ? "Importing…" : "Import legacy DB"}
                </AppButton>
              </div>
            ) : null}
          </div>
      </FinancialPanel>
    </section>
  )
}

export default AdminImportPage
