import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CopyIcon } from "@phosphor-icons/react/Copy"
import { DownloadSimpleIcon } from "@phosphor-icons/react/DownloadSimple"
import { PlusIcon } from "@phosphor-icons/react/Plus"
import { SignOutIcon } from "@phosphor-icons/react/SignOut"
import { XIcon } from "@phosphor-icons/react/X"
import { Navigate, useNavigate, useParams } from "react-router-dom"
import { apiFetch, apiFetchFormData, getApiErrorMessage } from "../app/api"
import { useAuth } from "../app/auth"
import { copyText } from "../app/clipboard"
import { formatShortDate, formatShortDateTime } from "../app/format"
import AISettingsPanel from "../components/AISettingsPanel"
import AutoCategorizationSettings, { type AutoCategorizationSettingsData } from "../components/AutoCategorizationSettings"
import { confirmDialog } from "../components/confirm"
import { Amount } from "../components/ui/Amount"
import { Button, IconButton, LinkButton } from "../components/ui/Button"
import { Dialog } from "../components/ui/Dialog"
import { EmptyState } from "../components/ui/EmptyState"
import { FileDrop } from "../components/ui/FileDrop"
import { useIsDesktop } from "../components/ui/layout-state"
import { AmountCell, Cell, List, Row, RowActions, type Columns } from "../components/ui/LedgerRow"
import { ErrorBody, LoadingBody } from "../components/ui/Panel"
import { SegmentedControl } from "../components/ui/SegmentedControl"
import { SettingRow, SettingsShell } from "../components/ui/SettingsShell"
import { Sheet } from "../components/ui/Sheet"
import { Field, FieldError, FieldGrid, TextField } from "../components/ui/TextField"
import { showToast } from "../components/ui/toast-store"
import type { ThemePreference } from "../theme/runtime"
import { useThemePreference } from "../theme/useThemePreference"
import { SETTINGS_SECTIONS, useSettingsGroups, type SettingsSectionKey } from "./settings-nav"

type BalanceAnchor = {
  id: number
  as_of_at: string
  balance_cents: number
  note: string | null
}

type IngestTokenMetadata = {
  token_hint: string
  created_at: string
  updated_at: string
  last_used_at: string | null
}

type SettingsPayload = {
  auto_categorization: AutoCategorizationSettingsData
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

type CsvPreviewResponse = { rows: CsvPreviewRow[]; errors: string[] }

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
]
// The settings column is narrower than a list's narrow breakpoint, so cells drop only on mobile.
const SNAPSHOT_COLUMNS: Columns = {
  columns: "160px 120px minmax(0, 1fr) 28px",
  mobileColumns: "minmax(0, 1fr) auto 28px",
}
const PREVIEW_COLUMNS: Columns = {
  columns: "96px minmax(0, 1fr) minmax(0, 160px) 110px",
  mobileColumns: "minmax(0, 1fr) auto",
}
const PREVIEW_ROWS = 15

function parseAmount(raw: string): number | null {
  const value = Number(raw.replace(/\s/g, "").replace(",", "."))
  return raw.trim() && Number.isFinite(value) ? Math.round(value * 100) : null
}

function ProfileCard() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const [signingOut, setSigningOut] = useState(false)
  const signOut = async () => {
    setSigningOut(true)
    try {
      await logout()
      navigate("/login", { replace: true })
    } finally {
      setSigningOut(false)
    }
  }
  return (
    <Sheet title="Profile" body="flush">
      <SettingRow label="Username">{user?.username}</SettingRow>
      <SettingRow label="Session">
        <Button variant="quiet" icon={SignOutIcon} disabled={signingOut} onClick={() => void signOut()}>
          {signingOut ? "Signing out…" : "Sign out"}
        </Button>
      </SettingRow>
    </Sheet>
  )
}

function IngestTokenCard({ token }: { token: IngestTokenMetadata | null }) {
  const queryClient = useQueryClient()
  const [generated, setGenerated] = useState("")
  const rotate = useMutation({
    mutationFn: () => apiFetch<{ token: string; ingest_token: IngestTokenMetadata }>("/api/settings/ingest-token", { method: "POST" }),
    onSuccess: (result) => {
      setGenerated(result.token)
      showToast({ message: token ? "Ingest token rotated." : "Ingest token created." })
      void queryClient.invalidateQueries({ queryKey: ["settings"] })
    },
  })
  const revoke = useMutation({
    mutationFn: () => apiFetch<{ status: string }>("/api/settings/ingest-token", { method: "DELETE" }),
    onSuccess: () => {
      setGenerated("")
      showToast({ message: "Ingest token revoked." })
      void queryClient.invalidateQueries({ queryKey: ["settings"] })
    },
  })
  const busy = rotate.isPending || revoke.isPending
  const error = rotate.error
    ? getApiErrorMessage(rotate.error, "Unable to create ingest token.")
    : revoke.error
      ? getApiErrorMessage(revoke.error, "Unable to revoke ingest token.")
      : null

  return (
    <Sheet title="Ingest token" body="flush">
      <SettingRow
        label={token ? `Token ending in ${token.token_hint}` : "No token"}
        detail={token ? (token.last_used_at ? `used ${formatShortDateTime(token.last_used_at)}` : "not used yet") : undefined}
      >
        <Button
          variant="quiet"
          disabled={busy}
          onClick={() => {
            revoke.reset()
            rotate.mutate()
          }}
        >
          {token ? "Rotate" : "Create"}
        </Button>
        {token ? (
          <Button
            variant="danger"
            disabled={busy}
            onClick={async () => {
              const confirmed = await confirmDialog({
                title: "Revoke the ingest token?",
                description: "Clients that use it stop working.",
                confirmLabel: "Revoke",
                tone: "danger",
              })
              if (!confirmed) return
              rotate.reset()
              revoke.mutate()
            }}
          >
            Revoke
          </Button>
        ) : null}
      </SettingRow>
      {generated ? (
        <SettingRow label="Copy the new token now. It is shown once." stack>
          <TextField readOnly value={generated} aria-label="New ingest token" onFocus={(event) => event.target.select()} />
          <IconButton
            icon={CopyIcon}
            label="Copy token"
            onClick={() => {
              copyText(generated)
              showToast({ message: "Token copied." })
            }}
          />
        </SettingRow>
      ) : null}
      {error ? (
        <SettingRow label={<FieldError>{error}</FieldError>} />
      ) : null}
    </Sheet>
  )
}

function AppearanceCard() {
  const { preference, setPreference } = useThemePreference()
  return (
    <Sheet title="Appearance" body="flush">
      <SettingRow label="Theme">
        <SegmentedControl label="Theme" value={preference} options={THEME_OPTIONS} onChange={setPreference} />
      </SettingRow>
    </Sheet>
  )
}

function SnapshotDialog({ anchor, onClose }: { anchor: BalanceAnchor | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [asOf, setAsOf] = useState(anchor ? anchor.as_of_at.slice(0, 16) : "")
  const [balance, setBalance] = useState(anchor ? (anchor.balance_cents / 100).toFixed(2) : "")
  const [note, setNote] = useState(anchor?.note ?? "")
  const [errors, setErrors] = useState<{ asOf?: string; balance?: string }>({})
  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<{ id: number }>(anchor ? `/api/settings/balance-anchors/${anchor.id}` : "/api/settings/balance-anchors", {
        method: anchor ? "PUT" : "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings"] })
      onClose()
    },
  })
  const remove = useMutation({
    mutationFn: (id: number) => apiFetch<{ status: string }>(`/api/settings/balance-anchors/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings"] })
      onClose()
    },
  })
  const submit = () => {
    const balanceCents = parseAmount(balance)
    const nextErrors = {
      asOf: asOf ? undefined : "Select a date and time.",
      balance: balanceCents === null ? "Enter a valid balance." : undefined,
    }
    setErrors(nextErrors)
    if (nextErrors.asOf || nextErrors.balance) return
    save.mutate({ as_of_at: `${asOf}:00`, balance_cents: balanceCents, note: note.trim() || null })
  }
  const mutationError = save.error ?? remove.error

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={anchor ? "Edit snapshot" : "Add snapshot"}
      size="narrow"
      footerStart={
        anchor ? (
          <Button
            variant="danger"
            disabled={remove.isPending}
            onClick={async () => {
              if (await confirmSnapshotDelete()) remove.mutate(anchor.id)
            }}
          >
            Delete
          </Button>
        ) : null
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={save.isPending} onClick={submit}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <FieldGrid narrow>
          <Field label="As of" error={errors.asOf}>
            <TextField type="datetime-local" value={asOf} autoFocus onChange={(event) => setAsOf(event.target.value)} />
          </Field>
          <Field label="Balance" error={errors.balance}>
            <TextField inputMode="decimal" suffix="€" placeholder="0,00" value={balance} onChange={(event) => setBalance(event.target.value)} />
          </Field>
          <Field label="Note">
            <TextField maxLength={200} placeholder="Bank statement" value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
        </FieldGrid>
        {mutationError ? <FieldError>{getApiErrorMessage(mutationError, "Unable to save the snapshot.")}</FieldError> : null}
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

async function confirmSnapshotDelete() {
  return confirmDialog({ title: "Delete this balance snapshot?", confirmLabel: "Delete", tone: "danger" })
}

function SnapshotsCard({ data }: { data: SettingsPayload }) {
  const queryClient = useQueryClient()
  const isDesktop = useIsDesktop()
  const [editing, setEditing] = useState<BalanceAnchor | "new" | null>(null)
  const remove = useMutation({
    mutationFn: (id: number) => apiFetch<{ status: string }>(`/api/settings/balance-anchors/${id}`, { method: "DELETE" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["settings"] }),
  })
  return (
    <>
      <Sheet
        title="Balance snapshots"
        meta={
          <>
            current <Amount cents={data.current_balance} />
          </>
        }
        actions={
          <Button variant="quiet" icon={PlusIcon} onClick={() => setEditing("new")}>
            Add snapshot
          </Button>
        }
        body="flush"
      >
        {data.balance_anchors.length ? (
          <List flat label="Balance snapshots">
            {data.balance_anchors.map((anchor) => (
              <Row
                key={anchor.id}
                {...SNAPSHOT_COLUMNS}
                label={`Snapshot ${formatShortDateTime(anchor.as_of_at)}`}
                onOpen={() => setEditing(anchor)}
              >
                <Cell>{formatShortDateTime(anchor.as_of_at)}</Cell>
                <AmountCell>
                  <Amount cents={anchor.balance_cents} />
                </AmountCell>
                <Cell tone="muted" hide="mobile">
                  {anchor.note}
                </Cell>
                <RowActions reveal={isDesktop}>
                  <IconButton
                    icon={XIcon}
                    label={`Delete snapshot ${formatShortDateTime(anchor.as_of_at)}`}
                    size="small"
                    disabled={remove.isPending}
                    onClick={async () => {
                      if (await confirmSnapshotDelete()) remove.mutate(anchor.id)
                    }}
                  />
                </RowActions>
              </Row>
            ))}
          </List>
        ) : (
          <EmptyState inline>No snapshots yet.</EmptyState>
        )}
        {remove.error ? <SettingRow label={<FieldError>{getApiErrorMessage(remove.error, "Unable to delete the snapshot.")}</FieldError>} /> : null}
      </Sheet>
      {editing ? <SnapshotDialog anchor={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </>
  )
}

function ExportCard() {
  return (
    <Sheet title="Export" body="flush">
      <SettingRow label="Transactions as CSV">
        <LinkButton variant="quiet" icon={DownloadSimpleIcon} to="/api/export/csv" reloadDocument aria-label="Download transactions as CSV">
          Download
        </LinkButton>
      </SettingRow>
      <SettingRow label="Portable archive">
        <LinkButton variant="quiet" icon={DownloadSimpleIcon} to="/api/export/portable.zip" reloadDocument aria-label="Download portable archive">
          Download
        </LinkButton>
      </SettingRow>
    </Sheet>
  )
}

function CsvImportCard() {
  const queryClient = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const form = (chosen: File) => {
    const body = new FormData()
    body.append("file", chosen)
    return body
  }
  const preview = useMutation({
    mutationFn: (chosen: File) =>
      apiFetchFormData<CsvPreviewResponse>("/api/import/csv/preview", { method: "POST", body: form(chosen) }),
  })
  const commit = useMutation({
    mutationFn: (chosen: File) =>
      apiFetchFormData<{ imported_count: number }>("/api/import/csv/commit", { method: "POST", body: form(chosen) }),
    onSuccess: (result) => {
      showToast({ message: `Imported ${result.imported_count} transaction${result.imported_count === 1 ? "" : "s"}.` })
      setFile(null)
      preview.reset()
      void queryClient.invalidateQueries({ queryKey: ["transactions"] })
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] })
    },
  })
  const choose = (chosen: File) => {
    setFile(chosen)
    commit.reset()
    preview.mutate(chosen)
  }
  const result = preview.data
  const error = preview.error
    ? getApiErrorMessage(preview.error, "Unable to preview CSV import.")
    : commit.error
      ? getApiErrorMessage(commit.error, "Unable to import CSV.")
      : null

  return (
    <Sheet
      title="Import CSV"
      meta={file ? file.name : undefined}
      actions={
        file && result?.rows.length ? (
          <Button variant="primary" disabled={commit.isPending} onClick={() => commit.mutate(file)}>
            {commit.isPending
              ? "Importing…"
              : `Import ${result.rows.length} transaction${result.rows.length === 1 ? "" : "s"}`}
          </Button>
        ) : null
      }
    >
      <FileDrop accept=".csv" label="CSV file" disabled={preview.isPending || commit.isPending} onFile={choose}>
        {preview.isPending ? "Reading the file…" : file ? "Drop another CSV file or choose one" : "Drop a CSV file or choose one"}
      </FileDrop>
      {error ? <FieldError>{error}</FieldError> : null}
      {result?.errors.slice(0, 8).map((message) => (
        <FieldError key={message}>{message}</FieldError>
      ))}
      {result ? (
        result.rows.length ? (
          <List flat label="Preview">
            {result.rows.slice(0, PREVIEW_ROWS).map((row, index) => (
              <Row key={`${index}-${row.date}-${row.title}`} {...PREVIEW_COLUMNS} label={row.title}>
                <Cell tone="muted" hide="mobile">
                  {formatShortDate(row.date)}
                </Cell>
                <Cell>{row.title}</Cell>
                <Cell tone="muted" hide="mobile">
                  {row.category ?? "Uncategorized"}
                </Cell>
                <AmountCell>
                  <Amount cents={row.amount_cents} kind={row.type === "income" ? "income" : "expense"} />
                </AmountCell>
              </Row>
            ))}
          </List>
        ) : (
          <EmptyState inline>The file has no rows to import.</EmptyState>
        )
      ) : null}
      {result && result.rows.length > PREVIEW_ROWS ? (
        <EmptyState inline>{`${result.rows.length - PREVIEW_ROWS} more rows are not shown.`}</EmptyState>
      ) : null}
    </Sheet>
  )
}

function SettingsPage() {
  const { section = "account" } = useParams()
  const groups = useSettingsGroups()
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiFetch<SettingsPayload>("/api/settings"),
    refetchInterval: (query) =>
      query.state.data?.auto_categorization.enabled && query.state.data.auto_categorization.training_status === "training"
        ? 2000
        : false,
  })
  if (!SETTINGS_SECTIONS.includes(section as SettingsSectionKey)) return <Navigate to="/settings" replace />
  const key = section as SettingsSectionKey
  const needsData = key === "account" || key === "categorization" || key === "snapshots"

  return (
    <SettingsShell title="Settings" groups={groups} current={key}>
      {needsData && isLoading ? <LoadingBody label="Loading settings…" /> : null}
      {needsData && !isLoading && (error || !data) ? <ErrorBody message="Unable to load settings." /> : null}
      {key === "account" && data ? (
        <>
          <ProfileCard />
          <IngestTokenCard token={data.ingest_token} />
        </>
      ) : null}
      {key === "appearance" ? <AppearanceCard /> : null}
      {key === "categorization" && data ? (
        <AutoCategorizationSettings
          settings={data.auto_categorization}
          onSaved={(auto_categorization) =>
            queryClient.setQueryData<SettingsPayload>(["settings"], (previous) => (previous ? { ...previous, auto_categorization } : previous))
          }
        />
      ) : null}
      {key === "ai" ? <AISettingsPanel /> : null}
      {key === "snapshots" && data ? <SnapshotsCard data={data} /> : null}
      {key === "data" ? (
        <>
          <ExportCard />
          <CsvImportCard />
        </>
      ) : null}
    </SettingsShell>
  )
}

export default SettingsPage
