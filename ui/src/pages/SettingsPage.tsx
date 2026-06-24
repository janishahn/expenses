import { useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { UploadSimpleIcon } from "@phosphor-icons/react/UploadSimple"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../app/auth"
import { apiFetch, apiFetchFormData } from "../app/api"
import { formatCurrency, formatEuroDate, formatEuroDateTime } from "../app/format"
import PageIntro from "../components/PageIntro"
import ThemePreferenceControl from "../components/ThemePreferenceControl"
import { AppButton } from "../components/ui/product-button"
import { AppCard } from "../components/ui/product-card"
import { AppFieldLabel, AppInput } from "../components/ui/product-fields"

type BalanceAnchor = {
  id: number
  as_of_at: string
  balance_cents: number
  note: string | null
}

type SettingsPayload = {
  current_balance: number
  balance_anchors: BalanceAnchor[]
  ingest_token: IngestTokenMetadata | null
}

type CsvPreviewRow = {
  date: string
  type: string
  is_reimbursement: boolean
  amount_cents: number
  category: string | null
  title: string
  description: string | null
  category_id: number | null
}

type CsvPreviewResponse = {
  rows: CsvPreviewRow[]
  errors: string[]
}

type CsvCommitResponse = {
  imported_count: number
}

type IngestTokenMetadata = {
  token_hint: string
  created_at: string
  updated_at: string
  last_used_at: string | null
}

type IngestTokenCreateResponse = {
  token: string
  ingest_token: IngestTokenMetadata
}

function SettingsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user, logout } = useAuth()
  const csvInputRef = useRef<HTMLInputElement>(null)

  const [editingAnchorId, setEditingAnchorId] = useState<number | null>(null)
  const [anchorAt, setAnchorAt] = useState("")
  const [anchorBalance, setAnchorBalance] = useState("")
  const [anchorNote, setAnchorNote] = useState("")
  const [formError, setFormError] = useState("")

  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [csvPreview, setCsvPreview] = useState<CsvPreviewResponse | null>(null)
  const [csvStatus, setCsvStatus] = useState("")
  const [csvError, setCsvError] = useState("")
  const [isCsvDragActive, setIsCsvDragActive] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [ingestTokenError, setIngestTokenError] = useState("")
  const [ingestTokenStatus, setIngestTokenStatus] = useState("")
  const [generatedIngestToken, setGeneratedIngestToken] = useState("")

  const { data, isLoading, error } = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiFetch<SettingsPayload>("/api/settings"),
  })

  const createAnchorMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<{ id: number }>("/api/settings/balance-anchors", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] })
      setEditingAnchorId(null)
      setFormError("")
    },
  })

  const updateAnchorMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<{ id: number }>(`/api/settings/balance-anchors/${editingAnchorId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] })
      setEditingAnchorId(null)
      setFormError("")
    },
  })

  const deleteAnchorMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch<{ status: string }>(`/api/settings/balance-anchors/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] })
    },
  })

  const rotateIngestTokenMutation = useMutation({
    mutationFn: () =>
      apiFetch<IngestTokenCreateResponse>("/api/settings/ingest-token", {
        method: "POST",
      }),
    onSuccess: (result) => {
      setGeneratedIngestToken(result.token)
      setIngestTokenError("")
      setIngestTokenStatus(
        data?.ingest_token ? "Ingest token rotated." : "Ingest token created."
      )
      queryClient.invalidateQueries({ queryKey: ["settings"] })
    },
    onError: (mutationError) => {
      setIngestTokenStatus("")
      setIngestTokenError(String(mutationError))
    },
  })

  const revokeIngestTokenMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ status: string }>("/api/settings/ingest-token", {
        method: "DELETE",
      }),
    onSuccess: () => {
      setGeneratedIngestToken("")
      setIngestTokenError("")
      setIngestTokenStatus("Ingest token revoked.")
      queryClient.invalidateQueries({ queryKey: ["settings"] })
    },
    onError: (mutationError) => {
      setIngestTokenStatus("")
      setIngestTokenError(String(mutationError))
    },
  })

  const csvPreviewMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append("file", file)
      return apiFetchFormData<CsvPreviewResponse>("/api/import/csv/preview", {
        method: "POST",
        body: form,
      })
    },
    onSuccess: (preview) => {
      setCsvPreview(preview)
      setCsvStatus("")
      setCsvError("")
    },
    onError: (mutationError) => {
      setCsvPreview(null)
      setCsvStatus("")
      setCsvError(String(mutationError))
    },
  })

  const csvCommitMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append("file", file)
      return apiFetchFormData<CsvCommitResponse>("/api/import/csv/commit", {
        method: "POST",
        body: form,
      })
    },
    onSuccess: (result) => {
      setCsvStatus(`Imported ${result.imported_count} transaction(s).`)
      setCsvError("")
      queryClient.invalidateQueries({ queryKey: ["transactions"] })
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
    },
    onError: (mutationError) => {
      setCsvStatus("")
      setCsvError(String(mutationError))
    },
  })

  const parseAmount = (raw: string) => {
    const normalized = raw.replace(/\s/g, "").replace(",", ".")
    const value = Number(normalized)
    if (!Number.isFinite(value)) {
      return null
    }
    return Math.round(value * 100)
  }

  const resetAnchorForm = () => {
    setEditingAnchorId(null)
    setAnchorAt("")
    setAnchorBalance("")
    setAnchorNote("")
    setFormError("")
  }

  const handleAnchorSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError("")
    if (!anchorAt) {
      setFormError("Select a date and time.")
      return
    }
    const balanceCents = parseAmount(anchorBalance)
    if (balanceCents === null) {
      setFormError("Enter a valid balance.")
      return
    }
    const payload = {
      as_of_at: `${anchorAt}:00`,
      balance_cents: balanceCents,
      note: anchorNote.trim() || null,
    }
    if (editingAnchorId) {
      updateAnchorMutation.mutate(payload)
      return
    }
    createAnchorMutation.mutate(payload)
  }

  const handleEditAnchor = (anchor: BalanceAnchor) => {
    setEditingAnchorId(anchor.id)
    setAnchorAt(anchor.as_of_at.slice(0, 16))
    setAnchorBalance((anchor.balance_cents / 100).toFixed(2))
    setAnchorNote(anchor.note || "")
  }

  const handleCsvPreview = () => {
    setCsvStatus("")
    setCsvError("")
    if (!csvFile) {
      setCsvError("Select a CSV file first.")
      return
    }
    csvPreviewMutation.mutate(csvFile)
  }

  const handleCsvImport = () => {
    setCsvStatus("")
    setCsvError("")
    if (!csvFile) {
      setCsvError("Select a CSV file first.")
      return
    }
    csvCommitMutation.mutate(csvFile)
  }

  const handleLogout = async () => {
    if (isLoggingOut) {
      return
    }
    setIsLoggingOut(true)
    try {
      await logout()
      navigate("/login", { replace: true })
    } finally {
      setIsLoggingOut(false)
    }
  }

  const handleCreateOrRotateIngestToken = () => {
    setIngestTokenError("")
    setIngestTokenStatus("")
    rotateIngestTokenMutation.mutate()
  }

  const handleRevokeIngestToken = () => {
    if (!confirm("Revoke this ingest token? Existing external clients will stop working.")) {
      return
    }
    setIngestTokenError("")
    setIngestTokenStatus("")
    revokeIngestTokenMutation.mutate()
  }

  if (isLoading) {
    return <div className="text-muted">Loading settings…</div>
  }
  if (error || !data) {
    return <div className="text-semantic-red">Unable to load settings.</div>
  }

  return (
    <section data-testid="settings-page" className="space-y-6">
      <PageIntro title="Settings" />

      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <AppCard className="p-5 lg:col-span-2">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="space-y-1">
              <h2 className="font-head text-2xl font-bold tracking-tight">Account</h2>
              <p className="text-sm text-muted">
                Signed in as{" "}
                <span className="font-semibold text-text" data-testid="auth-username">
                  {user?.username || "Signed in"}
                </span>
                .
              </p>
            </div>
            <AppButton
              type="button"
              tone="ghost"
              data-testid="auth-logout"
              onClick={handleLogout}
              disabled={isLoggingOut}
            >
              {isLoggingOut ? "Logging out…" : "Logout"}
            </AppButton>
          </div>

          <div className="mt-4 border-t border-border pt-4">
            <div className="space-y-1">
              <h3 className="font-head text-lg font-bold">Ingest Token</h3>
              <p className="text-sm text-muted">
                Use this token for external POST calls to <code>/api/ingest</code>.
              </p>
              {data.ingest_token ? (
                <p className="text-xs text-muted">
                  Token ending in <span className="font-mono text-text">{data.ingest_token.token_hint}</span>
                  {data.ingest_token.last_used_at
                    ? ` · last used ${formatEuroDateTime(data.ingest_token.last_used_at)}`
                    : " · not used yet"}
                </p>
              ) : (
                <p className="text-xs text-muted">No token configured yet.</p>
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <AppButton
                type="button"
                onClick={handleCreateOrRotateIngestToken}
                disabled={rotateIngestTokenMutation.isPending || revokeIngestTokenMutation.isPending}
              >
                {rotateIngestTokenMutation.isPending
                  ? data.ingest_token
                    ? "Rotating…"
                    : "Creating…"
                  : data.ingest_token
                    ? "Rotate token"
                    : "Create token"}
              </AppButton>
              {data.ingest_token ? (
                <AppButton
                  type="button"
                  tone="danger"
                  onClick={handleRevokeIngestToken}
                  disabled={rotateIngestTokenMutation.isPending || revokeIngestTokenMutation.isPending}
                >
                  {revokeIngestTokenMutation.isPending ? "Revoking…" : "Revoke token"}
                </AppButton>
              ) : null}
            </div>

            {ingestTokenError ? <p className="mt-2 text-xs text-semantic-red">{ingestTokenError}</p> : null}
            {ingestTokenStatus ? (
              <p className="mt-2 text-xs font-semibold text-semantic-green">{ingestTokenStatus}</p>
            ) : null}

            {generatedIngestToken ? (
              <div className="mt-3 space-y-2 rounded-lg border border-border bg-surface-hi/55 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                  Copy now — this is shown once
                </p>
                <AppInput value={generatedIngestToken} readOnly className="font-mono text-xs" />
              </div>
            ) : null}
          </div>
        </AppCard>

        <AppCard className="p-5 lg:col-span-2">
          <h2 className="font-head text-2xl font-bold tracking-tight">Appearance</h2>
          <ThemePreferenceControl
            testId="settings-theme-control"
            label="Theme"
            helper="Choose system, light, or dark mode for the whole app."
            className="mt-4"
          />
        </AppCard>

        <AppCard className="p-5 lg:col-span-2">
          <h2 className="text-xl font-head font-bold">Balance Snapshots</h2>
          <p className="mt-2 text-sm text-muted">
            Reconcile your account balance at a specific moment. Transactions are
            applied before or after this timestamp.
          </p>
          <div className="mt-4 text-sm text-muted">
            Current balance (as of now):{" "}
            <span className="font-mono font-semibold">
              {formatCurrency(data.current_balance)} €
            </span>
          </div>

          <form
            data-testid="settings-balance-anchor-form"
            onSubmit={handleAnchorSubmit}
            className="mt-4 space-y-3"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <AppFieldLabel>
                As of
                <AppInput
                  type="datetime-local"
                  value={anchorAt}
                  onChange={(event) => setAnchorAt(event.target.value)}
                  className="mt-1"
                  required
                />
              </AppFieldLabel>
              <AppFieldLabel>
                Balance
                <AppInput
                  value={anchorBalance}
                  onChange={(event) => setAnchorBalance(event.target.value)}
                  inputMode="decimal"
                  className="mt-1"
                  placeholder="-12.34"
                  required
                />
              </AppFieldLabel>
            </div>
            <AppFieldLabel>
              Note (optional)
              <AppInput
                value={anchorNote}
                onChange={(event) => setAnchorNote(event.target.value)}
                maxLength={200}
                className="mt-1"
              />
            </AppFieldLabel>
            {formError ? <p className="text-xs text-semantic-red">{formError}</p> : null}
            <div className="flex gap-2">
              <AppButton
                type="submit"
                className="flex-1"
                disabled={createAnchorMutation.isPending || updateAnchorMutation.isPending}
              >
                {editingAnchorId
                  ? updateAnchorMutation.isPending
                    ? "Saving…"
                    : "Update snapshot"
                  : createAnchorMutation.isPending
                    ? "Saving…"
                    : "Save snapshot"}
              </AppButton>
              {editingAnchorId ? (
                <AppButton type="button" onClick={resetAnchorForm} tone="ghost">
                  Cancel
                </AppButton>
              ) : null}
            </div>
          </form>

          {data.balance_anchors.length > 0 ? (
            <div className="mt-4 space-y-2 border-t border-border pt-4">
              <p className="text-xs font-semibold uppercase text-muted">Saved snapshots</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border text-left text-xs uppercase text-muted">
                    <tr>
                      <th className="px-3 py-2">When</th>
                      <th className="px-3 py-2 text-right">Balance</th>
                      <th className="px-3 py-2">Note</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.balance_anchors.map((anchor) => (
                      <tr key={anchor.id}>
                        <td className="px-3 py-2 text-text">{formatEuroDateTime(anchor.as_of_at)}</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold text-text">
                          {formatCurrency(anchor.balance_cents)} €
                        </td>
                        <td className="px-3 py-2 text-muted">{anchor.note || ""}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <AppButton type="button" onClick={() => handleEditAnchor(anchor)} tone="ghost">
                              Edit
                            </AppButton>
                            <AppButton
                              type="button"
                              onClick={() => {
                                if (confirm("Delete this balance snapshot?")) {
                                  deleteAnchorMutation.mutate(anchor.id)
                                }
                              }}
                              tone="danger"
                            >
                              Delete
                            </AppButton>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </AppCard>

        <AppCard data-testid="settings-csv-import" className="p-5 lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-head font-bold">CSV Import</h2>
              <p className="mt-1 text-sm text-muted">
                Preview and import transactions from a CSV export into your own account.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <AppButton asChild tone="ghost">
                <a href="/api/export/csv">Download your CSV</a>
              </AppButton>
              <AppButton asChild tone="ghost">
                <a href="/api/export/portable.zip">Download portable archive</a>
              </AppButton>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <input
              type="file"
              ref={csvInputRef}
              className="hidden"
              accept=".csv"
              aria-label="CSV file"
              onChange={(event) => setCsvFile(event.target.files?.[0] ?? null)}
            />
            <div
              onClick={() => csvInputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault()
                setIsCsvDragActive(true)
              }}
              onDragLeave={() => setIsCsvDragActive(false)}
              onDrop={(event) => {
                event.preventDefault()
                setIsCsvDragActive(false)
                setCsvFile(event.dataTransfer.files[0] ?? null)
              }}
              className={`cursor-pointer rounded-md border-2 border-dashed px-4 py-8 text-center transition ${
                isCsvDragActive
                  ? "border-accent bg-accent-dim"
                  : "border-border hover:border-accent hover:bg-accent-dim"
              }`}
            >
              <UploadSimpleIcon className="mx-auto h-8 w-8 text-muted" />
              <p className="mt-2 text-sm font-semibold text-text">Drop a CSV file here</p>
              <p className="text-xs text-muted">or click to browse</p>
              {csvFile ? <p className="mt-2 text-xs text-accent">{csvFile.name}</p> : null}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <AppButton
                type="button"
                onClick={handleCsvPreview}
                disabled={csvPreviewMutation.isPending || csvCommitMutation.isPending}
                tone="ghost"
                className="flex-1"
              >
                {csvPreviewMutation.isPending ? "Previewing…" : "Preview CSV"}
              </AppButton>
              <AppButton
                type="button"
                onClick={handleCsvImport}
                disabled={csvCommitMutation.isPending || csvPreviewMutation.isPending}
                className="flex-1"
              >
                {csvCommitMutation.isPending ? "Importing…" : "Import CSV"}
              </AppButton>
            </div>

            {csvError ? <p className="text-xs text-semantic-red">{csvError}</p> : null}
            {csvStatus ? <p className="text-xs font-semibold text-semantic-green">{csvStatus}</p> : null}

            {csvPreview ? (
              <div className="rounded-lg border border-border bg-surface-hi/55 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-text">Preview</p>
                  <span className="chip text-[11px] text-text">
                    {csvPreview.rows.length} row{csvPreview.rows.length === 1 ? "" : "s"}
                  </span>
                </div>

                {csvPreview.errors.length ? (
                  <ul className="mb-3 list-disc space-y-1 rounded-md border border-semantic-red/35 bg-semantic-red/10 px-5 py-2 text-xs text-semantic-red">
                    {csvPreview.errors.slice(0, 8).map((previewError) => (
                      <li key={previewError}>{previewError}</li>
                    ))}
                  </ul>
                ) : null}

                {csvPreview.rows.length ? (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="min-w-full text-xs">
                      <thead className="bg-faint text-[11px] font-semibold uppercase tracking-wide text-muted">
                        <tr>
                          <th className="px-3 py-2 text-left">Date</th>
                          <th className="px-3 py-2 text-left">Type</th>
                          <th className="px-3 py-2 text-right">Amount</th>
                          <th className="px-3 py-2 text-left">Category</th>
                          <th className="px-3 py-2 text-left">Title</th>
                          <th className="px-3 py-2 text-left">Description</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border text-text">
                        {csvPreview.rows.slice(0, 15).map((row) => (
                          <tr key={`${row.date}-${row.title}-${row.amount_cents}`}>
                            <td className="px-3 py-2">{formatEuroDate(row.date)}</td>
                            <td className="px-3 py-2 capitalize">
                              {row.type}
                              {row.is_reimbursement ? " (reimb)" : ""}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">
                              {formatCurrency(row.amount_cents)} €
                            </td>
                            <td className="px-3 py-2">{row.category || "—"}</td>
                            <td className="max-w-[260px] truncate px-3 py-2">{row.title}</td>
                            <td className="max-w-[260px] truncate px-3 py-2 text-muted">
                              {row.description || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-muted">No rows previewed.</p>
                )}
              </div>
            ) : null}
          </div>
        </AppCard>
      </div>
    </section>
  )
}

export default SettingsPage
