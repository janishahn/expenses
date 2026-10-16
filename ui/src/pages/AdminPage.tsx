import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowRightIcon } from "@phosphor-icons/react/ArrowRight"
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle"
import { DownloadSimpleIcon } from "@phosphor-icons/react/DownloadSimple"
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass"
import { ThermometerHotIcon } from "@phosphor-icons/react/ThermometerHot"
import { WarningIcon } from "@phosphor-icons/react/Warning"
import { Navigate, useParams } from "react-router-dom"
import { apiFetch, fetchAIUsageSummary, getApiErrorMessage } from "../app/api"
import type { AIUsageSummary } from "../app/api-types"
import { formatCount, formatShortDate, formatShortDateTime } from "../app/format"
import AISettingsPanel from "../components/AISettingsPanel"
import { confirmDialog } from "../components/confirm"
import { Button, LinkButton } from "../components/ui/Button"
import { EmptyState, Status } from "../components/ui/EmptyState"
import { Cell, List, ListFooter, Row, type Columns } from "../components/ui/LedgerRow"
import { useIsDesktop } from "../components/ui/layout-state"
import { ErrorBody, LoadingBody, ViewRow } from "../components/ui/Panel"
import { Peek, PeekSection } from "../components/ui/Peek"
import { Property, PropertyList } from "../components/ui/PropertyList"
import { SegmentedControl } from "../components/ui/SegmentedControl"
import { SettingRow, SettingsShell } from "../components/ui/SettingsShell"
import { CodeBlock, MetricStrip, Sheet } from "../components/ui/Sheet"
import { FieldError, TextField } from "../components/ui/TextField"
import { showToast } from "../components/ui/toast-store"
import { ADMIN_SECTIONS, useSettingsGroups, type AdminSectionKey } from "./settings-nav"

type AdminInfo = {
  app_version: string
  environment: string
  db_path: string
  db_size_mb: number
  db_modified: string | null
  log_path: string
  log_size_mb: number
  log_modified: string | null
  log_retained_files: number
}

type SystemHealth = {
  cpu_temp_celsius: number | null
  cpu_load_percent: number
  ram_used_bytes: number
  ram_total_bytes: number
  disk_used_bytes: number
  disk_total_bytes: number
  disk_free_bytes: number
  db_size_bytes: number
  receipts_size_bytes: number
  status: "healthy" | "warm" | "critical"
}

type RecurringCatchUpResult = {
  advanced_rules: number
  overdue_rules: number
  updated: boolean
}

type LogEntry = {
  timestamp: string
  level: string
  logger: string
  event: string
  request_id?: string
  method?: string
  path?: string
  route?: string
  status_code?: number
  duration_ms?: number
  raw_body?: string
  [key: string]: unknown
}

type AdminLogsResponse = {
  entries: LogEntry[]
  next_cursor: string | null
}

type LogFilter = "errors" | "ingest" | "imports" | "scheduler" | "all"

const DECIMAL = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 })
const GB = 1024 ** 3
const LOG_COLUMNS: Columns = {
  columns: "96px 64px minmax(0, 1fr) minmax(0, 200px)",
  narrowColumns: "96px 64px minmax(0, 1fr)",
  mobileColumns: "88px 56px minmax(0, 1fr)",
}
const USAGE_PERIODS: Array<{ value: AIUsageSummary["period"]; label: string }> = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "all", label: "All time" },
]
const LOG_FILTERS: Array<{ value: LogFilter; label: string }> = [
  { value: "errors", label: "Errors" },
  { value: "ingest", label: "Ingest" },
  { value: "imports", label: "Imports" },
  { value: "scheduler", label: "Scheduler" },
  { value: "all", label: "All" },
]
const HEALTH_STATUS = {
  healthy: { label: "Healthy", tone: "ok", icon: CheckCircleIcon },
  warm: { label: "Warm", tone: "neutral", icon: ThermometerHotIcon },
  critical: { label: "Critical", tone: "bad", icon: WarningIcon },
} as const

// Costs under 1 keep three significant digits, so a fraction of a cent stays short.
function formatCostAmount(decimal: string, unit: string | null): string {
  const amount = Number(decimal)
  const value = amount.toLocaleString("en-US", Math.abs(amount) < 1 ? { maximumSignificantDigits: 3 } : { maximumFractionDigits: 2 })
  if (unit === "openrouter_credits") return `${value} credits`
  if (unit === "usd") return `$${value}`
  if (unit === "mixed") return `${value} (mixed)`
  return unit ? `${value} ${unit}` : value
}

const gigabytes = (bytes: number) => `${DECIMAL.format(bytes / GB)} GB`
const SIZE_UNITS = ["B", "KB", "MB", "GB", "TB"]
function fileSize(bytes: number): string {
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${DECIMAL.format(value)} ${SIZE_UNITS[unit]}`
}
const levelLabel = (level: string) =>
  level === "ERROR" || level === "CRITICAL" ? "Error" : level === "WARNING" ? "Warning" : level === "INFO" ? "Info" : level
// "12 Oct 14:32"; the peek shows the full timestamp.
const logTime = (iso: string) => `${formatShortDate(iso).replace(/ \d{4}$/, "")} ${iso.slice(11, 16)}`
const sameEntry = (a: LogEntry, b: LogEntry) => a.timestamp === b.timestamp && a.event === b.event && a.request_id === b.request_id

function HealthSection() {
  const { data, error } = useQuery({
    queryKey: ["admin", "system-health"],
    queryFn: () => apiFetch<SystemHealth>("/api/admin/system-health"),
    refetchInterval: 60_000,
  })
  if (error) return <ErrorBody message="Unable to load server health." />
  if (!data) return <LoadingBody label="Loading server health…" />
  const status = HEALTH_STATUS[data.status]
  return (
    <>
      <MetricStrip
        metrics={[
          { label: "CPU temperature", value: data.cpu_temp_celsius === null ? "Not available" : `${DECIMAL.format(data.cpu_temp_celsius)} °C` },
          { label: "Load", value: `${DECIMAL.format(data.cpu_load_percent)} %` },
          { label: "Memory", value: gigabytes(data.ram_used_bytes), detail: `of ${gigabytes(data.ram_total_bytes)}` },
          { label: "Disk", value: gigabytes(data.disk_used_bytes), detail: `of ${gigabytes(data.disk_total_bytes)}` },
        ]}
      />
      <Sheet title="Status" body="flush">
        <SettingRow label="Server">
          <Status icon={status.icon} tone={status.tone}>
            {status.label}
          </Status>
        </SettingRow>
        <SettingRow label="Database">{fileSize(data.db_size_bytes)}</SettingRow>
        <SettingRow label="Receipts">{fileSize(data.receipts_size_bytes)}</SettingRow>
        <SettingRow label="Free disk space">{fileSize(data.disk_free_bytes)}</SettingRow>
      </Sheet>
    </>
  )
}

function MaintenanceSection() {
  const queryClient = useQueryClient()
  const [days, setDays] = useState("30")
  const validDays = /^\d{1,5}$/.test(days) && Number(days) >= 1
  const preview = useQuery({
    queryKey: ["admin", "purge-preview", days],
    queryFn: () => apiFetch<{ count: number }>(`/api/admin/purge-deleted/preview?days=${days}`),
    enabled: validDays,
  })
  const purge = useMutation({
    mutationFn: (value: number) =>
      apiFetch<{ count: number; attachments_count: number }>("/api/admin/purge-deleted", {
        method: "POST",
        body: JSON.stringify({ days: value }),
      }),
    onSuccess: (result) => {
      showToast({ message: `Purged ${result.count} deleted transaction${result.count === 1 ? "" : "s"}.` })
      void queryClient.invalidateQueries({ queryKey: ["admin", "purge-preview"] })
      void queryClient.invalidateQueries({ queryKey: ["transactions"] })
    },
  })
  const rebuild = useMutation({
    mutationFn: () => apiFetch("/api/admin/rebuild-rollups", { method: "POST" }),
    onSuccess: () => showToast({ message: "Monthly totals rebuilt." }),
  })
  const catchUp = useMutation({
    mutationFn: () => apiFetch<RecurringCatchUpResult>("/api/admin/recurring-catch-up", { method: "POST" }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["recurring"] })
      void queryClient.invalidateQueries({ queryKey: ["transactions"] })
      const plural = (count: number) => (count === 1 ? "" : "s")
      showToast({
        message: result.updated
          ? `Catch-up ran. Updated ${result.advanced_rules} rule${plural(result.advanced_rules)}.`
          : result.overdue_rules > 0
            ? `Catch-up ran. No updates. ${result.overdue_rules} overdue rule${plural(result.overdue_rules)} remain.`
            : "Catch-up ran. No updates needed.",
      })
    },
  })
  const count = preview.data?.count
  const error = rebuild.error
    ? getApiErrorMessage(rebuild.error, "Unable to rebuild monthly totals.")
    : catchUp.error
      ? getApiErrorMessage(catchUp.error, "Catch-up failed.")
      : null

  return (
    <>
      <Sheet title="Maintenance" body="flush">
        <SettingRow label="Database backup">
          <LinkButton variant="quiet" icon={DownloadSimpleIcon} to="/api/admin/download-db" reloadDocument aria-label="Download database backup">
            Download
          </LinkButton>
        </SettingRow>
        <SettingRow label="All users’ transactions as CSV">
          <LinkButton variant="quiet" icon={DownloadSimpleIcon} to="/api/admin/export-csv" reloadDocument aria-label="Download all users’ transactions as CSV">
            Download
          </LinkButton>
        </SettingRow>
        <SettingRow label="Rebuild monthly totals">
          <Button
            variant="quiet"
            disabled={rebuild.isPending}
            onClick={async () => {
              if (await confirmDialog({ title: "Rebuild monthly totals now?", confirmLabel: "Rebuild", tone: "primary" })) {
                catchUp.reset()
                rebuild.mutate()
              }
            }}
          >
            {rebuild.isPending ? "Rebuilding…" : "Rebuild"}
          </Button>
        </SettingRow>
        <SettingRow label="Post overdue recurring transactions">
          <Button
            variant="quiet"
            disabled={catchUp.isPending}
            onClick={() => {
              rebuild.reset()
              catchUp.mutate()
            }}
          >
            {catchUp.isPending ? "Running…" : "Run"}
          </Button>
        </SettingRow>
        <SettingRow label="Legacy SQLite import">
          <LinkButton variant="quiet" to="/admin/import" aria-label="Open legacy SQLite import">
            Open
            <ArrowRightIcon aria-hidden="true" />
          </LinkButton>
        </SettingRow>
        {error ? <SettingRow label={<FieldError>{error}</FieldError>} /> : null}
      </Sheet>
      <Sheet title="Purge deleted transactions" body="flush">
        <SettingRow
          label={<label htmlFor="purge-days">Older than</label>}
          detail={validDays && count !== undefined ? `${count} transaction${count === 1 ? "" : "s"}` : undefined}
        >
          <TextField
            id="purge-days"
            short
            inputMode="numeric"
            suffix="days"
            value={days}
            invalid={!validDays}
            onChange={(event) => {
              setDays(event.target.value)
              purge.reset()
            }}
          />
          <Button
            variant="danger"
            disabled={!validDays || !count || purge.isPending}
            onClick={async () => {
              const confirmed = await confirmDialog({
                title: `Purge ${count} deleted transaction${count === 1 ? "" : "s"}?`,
                description: `Deleted more than ${days} days ago. This cannot be undone.`,
                confirmLabel: "Purge",
                tone: "danger",
              })
              if (confirmed) purge.mutate(Number(days))
            }}
          >
            Purge
          </Button>
        </SettingRow>
        {!validDays ? <SettingRow label={<FieldError>Enter a whole number of days, at least 1.</FieldError>} /> : null}
        {purge.error ? (
          <SettingRow label={<FieldError>{getApiErrorMessage(purge.error, "Unable to purge deleted transactions.")}</FieldError>} />
        ) : null}
      </Sheet>
    </>
  )
}

function UsageSection({ period }: { period: AIUsageSummary["period"] }) {
  const usage = useQuery({
    queryKey: ["ai-usage-summary", "spending_chat", period],
    queryFn: () => fetchAIUsageSummary(period),
    staleTime: 60_000,
  })
  if (usage.isPending) return <LoadingBody label="Loading usage…" />
  if (usage.error) return <ErrorBody message="Usage is unavailable right now." />
  const data = usage.data
  if (data.total_chats === 0) return <EmptyState>No assistant usage in this period.</EmptyState>
  return (
    <MetricStrip
      metrics={[
        {
          label: "Cost",
          value: data.costed_chats > 0 ? formatCostAmount(data.total_cost_decimal, data.cost_unit) : "Not billed",
          detail: data.costed_chats > 0 ? `${formatCostAmount(data.average_cost_decimal, data.cost_unit)} per chat` : undefined,
        },
        {
          label: "Tokens",
          value: formatCount(data.total_tokens),
          detail: `${formatCount(data.cached_input_tokens)} cached · ${formatCount(data.reasoning_tokens)} reasoning`,
        },
        {
          label: "Chats",
          value: formatCount(data.total_chats),
          detail: `${formatCount(data.completed_chats)} completed · ${formatCount(data.failed_chats)} failed`,
        },
        {
          label: "Per chat",
          value: `${formatCount(data.average_total_tokens)} tokens`,
          detail: data.p95_duration_ms != null ? `${formatCount(data.p95_duration_ms)} ms p95` : undefined,
        },
      ]}
    />
  )
}

function useLogs(filter: LogFilter, search: string, cursor: string | null) {
  const params = new URLSearchParams({ limit: "40" })
  if (cursor) params.set("cursor", cursor)
  if (filter === "ingest") params.set("path", "/api/ingest")
  else if (filter === "imports") params.set("q", "import_")
  else if (filter === "scheduler") params.set("q", "scheduler_")
  else if (filter === "errors") params.set("error_only", "true")
  if (search.trim()) params.set("q", search.trim())
  return useQuery({
    queryKey: ["admin", "logs", filter, search, cursor],
    queryFn: () => apiFetch<AdminLogsResponse>(`/api/admin/logs?${params.toString()}`),
    refetchInterval: cursor === null ? 30_000 : false,
  })
}

function LogPeek({ entry, onClose }: { entry: LogEntry; onClose: () => void }) {
  return (
    <Peek parent="Logs" title={entry.event} onClose={onClose}>
      <PropertyList wide>
        <Property label="Time">{entry.timestamp}</Property>
        <Property label="Level">{levelLabel(entry.level)}</Property>
        <Property label="Logger">{entry.logger}</Property>
        <Property label="Request ID" empty={!entry.request_id}>
          {entry.request_id ?? "None"}
        </Property>
        {entry.method || entry.path ? <Property label="Request">{[entry.method, entry.path].filter(Boolean).join(" ")}</Property> : null}
        {entry.status_code !== undefined ? <Property label="Status">{entry.status_code}</Property> : null}
        {entry.duration_ms !== undefined ? <Property label="Duration">{`${formatCount(entry.duration_ms)} ms`}</Property> : null}
      </PropertyList>
      {typeof entry.raw_body === "string" ? (
        <PeekSection title="Captured body">
          <CodeBlock label="Captured body">{entry.raw_body}</CodeBlock>
        </PeekSection>
      ) : null}
      <PeekSection title="Payload">
        <CodeBlock label="Structured payload">{JSON.stringify(entry, null, 2)}</CodeBlock>
      </PeekSection>
    </Peek>
  )
}

function LogsSection({ selected, onSelect }: { selected: LogEntry | null; onSelect: (entry: LogEntry | null) => void }) {
  const isDesktop = useIsDesktop()
  const [filter, setFilter] = useState<LogFilter>("errors")
  const [search, setSearch] = useState("")
  const [cursor, setCursor] = useState<string | null>(null)
  const logs = useLogs(filter, search, cursor)
  const entries = logs.data?.entries ?? []
  const reset = () => {
    setCursor(null)
    onSelect(null)
  }
  const searchField = (
    <TextField
      type="search"
      icon={MagnifyingGlassIcon}
      aria-label="Search logs"
      placeholder="Request ID, event, text"
      value={search}
      onChange={(event) => {
        setSearch(event.target.value)
        reset()
      }}
    />
  )

  return (
    <>
      {isDesktop ? null : searchField}
      <ViewRow>
        {isDesktop ? searchField : null}
        <SegmentedControl
          label="Log type"
          value={filter}
          options={LOG_FILTERS}
          onChange={(value) => {
            setFilter(value)
            reset()
          }}
        />
      </ViewRow>
      {logs.error ? (
        <ErrorBody message="Unable to load logs." />
      ) : logs.isPending ? (
        <LoadingBody label="Loading logs…" />
      ) : (
        <List
          scroll={false}
          label="Log entries"
          footer={
            entries.length === 0 ? (
              <EmptyState inline>No matching log entries.</EmptyState>
            ) : logs.data.next_cursor ? (
              <ListFooter>
                <Button variant="ghost" onClick={() => setCursor(logs.data.next_cursor)}>
                  Load older
                </Button>
              </ListFooter>
            ) : null
          }
        >
          {entries.map((entry, index) => {
            const isError = entry.level === "ERROR" || entry.level === "CRITICAL"
            return (
              <Row
                key={`${entry.timestamp}-${entry.event}-${entry.request_id ?? index}`}
                {...LOG_COLUMNS}
                label={`${levelLabel(entry.level)} ${entry.event} at ${logTime(entry.timestamp)}`}
                selected={selected !== null && sameEntry(selected, entry)}
                onOpen={() => onSelect(entry)}
              >
                <Cell tone="muted">{logTime(entry.timestamp)}</Cell>
                <Cell tone={isError ? undefined : "muted"}>{isError ? <Status tone="bad">Error</Status> : levelLabel(entry.level)}</Cell>
                <Cell>{entry.event}</Cell>
                <Cell tone="muted" hide="narrow">
                  {entry.path}
                </Cell>
              </Row>
            )
          })}
        </List>
      )}
    </>
  )
}

function SystemSection() {
  const { data, error } = useQuery({
    queryKey: ["admin", "info"],
    queryFn: () => apiFetch<AdminInfo>("/api/admin/info"),
  })
  if (error) return <ErrorBody message="Unable to load admin info." />
  if (!data) return <LoadingBody label="Loading admin info…" />
  return (
    <Sheet title="System">
      <PropertyList wide>
        <Property label="Version">{data.app_version}</Property>
        <Property label="Environment">{data.environment}</Property>
        <Property label="Database">{`${data.db_path} · ${DECIMAL.format(data.db_size_mb)} MB`}</Property>
        <Property label="Modified" empty={!data.db_modified}>
          {data.db_modified ? formatShortDateTime(data.db_modified) : "Unknown"}
        </Property>
        <Property label="Logs">
          {`${data.log_path} · ${DECIMAL.format(data.log_size_mb)} MB · ${data.log_retained_files} file${data.log_retained_files === 1 ? "" : "s"}`}
        </Property>
        <Property label="Logs modified" empty={!data.log_modified}>
          {data.log_modified ? formatShortDateTime(data.log_modified) : "Unknown"}
        </Property>
      </PropertyList>
    </Sheet>
  )
}

function AdminPage() {
  const { section = "health" } = useParams()
  const groups = useSettingsGroups()
  const [usagePeriod, setUsagePeriod] = useState<AIUsageSummary["period"]>("week")
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null)
  if (!ADMIN_SECTIONS.includes(section as AdminSectionKey)) {
    return <Navigate to="/admin" replace />
  }
  const key = section as AdminSectionKey

  return (
    <SettingsShell
      title="Admin"
      groups={groups}
      current={key}
      actions={
        key === "usage" ? (
          <SegmentedControl label="Assistant usage period" value={usagePeriod} options={USAGE_PERIODS} onChange={setUsagePeriod} />
        ) : undefined
      }
      peek={key === "logs" ? selectedLog ? <LogPeek entry={selectedLog} onClose={() => setSelectedLog(null)} /> : null : undefined}
    >
      {key === "health" ? <HealthSection /> : null}
      {key === "maintenance" ? <MaintenanceSection /> : null}
      {key === "ai" ? <AISettingsPanel /> : null}
      {key === "usage" ? <UsageSection period={usagePeriod} /> : null}
      {key === "logs" ? <LogsSection selected={selectedLog} onSelect={setSelectedLog} /> : null}
      {key === "system" ? <SystemSection /> : null}
    </SettingsShell>
  )
}

export default AdminPage
