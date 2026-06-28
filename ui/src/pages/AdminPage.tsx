import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { apiFetch, fetchAIUsageSummary } from "../app/api"
import type { AIUsageSummary } from "../app/api-types"
import { formatEuroDateTime, formatFileSize } from "../app/format"
import Sparkline from "../components/charts/Sparkline"
import PageIntro from "../components/PageIntro"
import { AppButton } from "../components/ui/product-button"
import { AppCard } from "../components/ui/product-card"
import { AppInput } from "../components/ui/product-fields"

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

type SparklineMetric =
  | "cpu_temp_celsius"
  | "cpu_load_percent"
  | "ram_percent"
  | "disk_percent"

type SparklineHistory = Record<SparklineMetric, number[]>
type SparklinePoints = Record<SparklineMetric, string | undefined>

const SPARKLINE_HISTORY_LIMIT = 60

function toSparklinePoints(values: number[]): string | undefined {
  if (!values.length) {
    return undefined
  }
  if (values.length === 1) {
    return "50,15"
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100
      const normalized = (value - min) / span
      const y = 30 - normalized * 30
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(" ")
}

const INTEGER_FORMAT = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
})

function trimDecimal(value: string): string {
  if (!value.includes(".")) {
    return value
  }
  return value.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "")
}

function formatCostAmount(decimal: string, unit: string | null): string {
  const value = trimDecimal(decimal)
  if (unit === "openrouter_credits") {
    return `${value} credits`
  }
  if (unit === "usd") {
    return `$${value}`
  }
  if (unit === "mixed") {
    return `${value} (mixed)`
  }
  return unit ? `${value} ${unit}` : value
}

function AdminPage() {
  const queryClient = useQueryClient()
  const [purgeDays, setPurgeDays] = useState("30")
  const [recurringCatchUpMessage, setRecurringCatchUpMessage] = useState<{
    tone: "success" | "error"
    text: string
  } | null>(null)
  const [logFilter, setLogFilter] = useState<LogFilter>("errors")
  const [logSearch, setLogSearch] = useState("")
  const [logCursor, setLogCursor] = useState<string | null>(null)
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null)
  const [usagePeriod, setUsagePeriod] =
    useState<AIUsageSummary["period"]>("week")
  const [isPageVisible, setIsPageVisible] = useState(() => !document.hidden)
  const sparklineHistoryRef = useRef<SparklineHistory>({
    cpu_temp_celsius: [],
    cpu_load_percent: [],
    ram_percent: [],
    disk_percent: [],
  })
  const [sparklinePoints, setSparklinePoints] = useState<SparklinePoints>({
    cpu_temp_celsius: undefined,
    cpu_load_percent: undefined,
    ram_percent: undefined,
    disk_percent: undefined,
  })

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "info"],
    queryFn: () => apiFetch<AdminInfo>("/api/admin/info"),
  })
  const { data: systemHealth } = useQuery({
    queryKey: ["admin", "system-health"],
    queryFn: () => apiFetch<SystemHealth>("/api/admin/system-health"),
    enabled: isPageVisible,
    refetchInterval: isPageVisible ? 60_000 : false,
  })
  const usageQuery = useQuery({
    queryKey: ["ai-usage-summary", "spending_chat", usagePeriod],
    queryFn: () => fetchAIUsageSummary(usagePeriod),
    staleTime: 60_000,
  })
  const logQueryParams = new URLSearchParams({ limit: "40" })
  if (logCursor) {
    logQueryParams.set("cursor", logCursor)
  }
  if (logFilter === "ingest") {
    logQueryParams.set("path", "/api/ingest")
  } else if (logFilter === "imports") {
    logQueryParams.set("q", "import_")
  } else if (logFilter === "scheduler") {
    logQueryParams.set("q", "scheduler_")
  } else if (logFilter === "errors") {
    logQueryParams.set("error_only", "true")
  }
  if (logSearch.trim()) {
    logQueryParams.set("q", logSearch.trim())
  }
  const logQuery = `/api/admin/logs?${logQueryParams.toString()}`
  const { data: logsData, isLoading: logsLoading } = useQuery({
    queryKey: ["admin", "logs", logFilter, logSearch, logCursor],
    queryFn: () => apiFetch<AdminLogsResponse>(logQuery),
    enabled: isPageVisible,
    refetchInterval: isPageVisible && logCursor === null ? 30_000 : false,
  })
  const visibleLogs = logsData?.entries || []
  const nextLogCursor = logsData?.next_cursor || null

  useEffect(() => {
    const onVisibilityChange = () => {
      setIsPageVisible(!document.hidden)
    }
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange)
  }, [])

  useEffect(() => {
    if (!systemHealth) {
      return
    }
    const nextRamPercent =
      systemHealth.ram_total_bytes > 0
        ? (systemHealth.ram_used_bytes / systemHealth.ram_total_bytes) * 100
        : 0
    const nextDiskPercent =
      systemHealth.disk_total_bytes > 0
        ? (systemHealth.disk_used_bytes / systemHealth.disk_total_bytes) * 100
        : 0
    const history = sparklineHistoryRef.current
    const nextMetrics = {
      cpu_temp_celsius: systemHealth.cpu_temp_celsius,
      cpu_load_percent: systemHealth.cpu_load_percent,
      ram_percent: nextRamPercent,
      disk_percent: nextDiskPercent,
    } satisfies Record<SparklineMetric, number | null>

    for (const [metric, value] of Object.entries(nextMetrics) as Array<
      [SparklineMetric, number | null]
    >) {
      if (value === null) {
        continue
      }
      history[metric].push(value)
      if (history[metric].length > SPARKLINE_HISTORY_LIMIT) {
        history[metric].shift()
      }
    }

    setSparklinePoints({
      cpu_temp_celsius: toSparklinePoints(history.cpu_temp_celsius),
      cpu_load_percent: toSparklinePoints(history.cpu_load_percent),
      ram_percent: toSparklinePoints(history.ram_percent),
      disk_percent: toSparklinePoints(history.disk_percent),
    })
  }, [systemHealth])

  const purgeMutation = useMutation({
    mutationFn: (days: number) =>
      apiFetch("/api/admin/purge-deleted", {
        method: "POST",
        body: JSON.stringify({ days }),
      }),
    onSuccess: () => {
      alert("Deleted transactions purged successfully")
    },
  })

  const rebuildMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/admin/rebuild-rollups", { method: "POST" }),
    onSuccess: () => {
      alert("Monthly rollups rebuilt successfully")
    },
  })

  const recurringCatchUpMutation = useMutation({
    mutationFn: () =>
      apiFetch<RecurringCatchUpResult>("/api/admin/recurring-catch-up", {
        method: "POST",
      }),
    onSuccess: (payload) => {
      queryClient.invalidateQueries({ queryKey: ["recurring"] })
      queryClient.invalidateQueries({ queryKey: ["transactions"] })
      if (payload.updated) {
        const suffix = payload.advanced_rules === 1 ? "" : "s"
        setRecurringCatchUpMessage({
          tone: "success",
          text: `Catch-up ran. Updated ${payload.advanced_rules} rule${suffix}.`,
        })
        return
      }
      if (payload.overdue_rules > 0) {
        const suffix = payload.overdue_rules === 1 ? "" : "s"
        setRecurringCatchUpMessage({
          tone: "error",
          text: `Catch-up ran. No updates. ${payload.overdue_rules} overdue rule${suffix} remain.`,
        })
        return
      }
      setRecurringCatchUpMessage({
        tone: "success",
        text: "Catch-up ran. No updates needed.",
      })
    },
    onError: (error) => {
      setRecurringCatchUpMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Catch-up failed.",
      })
    },
  })

  const handlePurge = () => {
    if (!confirm(`Purge deleted transactions older than ${purgeDays} days?`)) {
      return
    }
    purgeMutation.mutate(Number(purgeDays) || 30)
  }

  const handleRebuild = () => {
    if (!confirm("Rebuild monthly rollups now?")) {
      return
    }
    rebuildMutation.mutate()
  }

  const handleRecurringCatchUp = () => {
    setRecurringCatchUpMessage(null)
    recurringCatchUpMutation.mutate()
  }
  const handleLogFilterChange = (nextFilter: LogFilter) => {
    setLogFilter(nextFilter)
    setLogCursor(null)
    setSelectedLog(null)
  }
  const levelTone = (level: string) => {
    if (level === "ERROR" || level === "CRITICAL") {
      return "border-semantic-red/40 bg-semantic-red/10 text-semantic-red"
    }
    if (level === "WARNING") {
      return "border-accent/45 bg-accent/14 text-accent"
    }
    return "border-border bg-surface-hi text-text"
  }

  if (isLoading) {
    return <div className="text-muted">Loading admin info…</div>
  }
  if (error || !data) {
    return <div className="text-semantic-red">Unable to load admin info.</div>
  }

  const ramUsagePercent =
    systemHealth && systemHealth.ram_total_bytes > 0
      ? (systemHealth.ram_used_bytes / systemHealth.ram_total_bytes) * 100
      : 0
  const diskFreePercent =
    systemHealth && systemHealth.disk_total_bytes > 0
      ? (systemHealth.disk_free_bytes / systemHealth.disk_total_bytes) * 100
      : 0
  const diskUsagePercent =
    systemHealth && systemHealth.disk_total_bytes > 0
      ? (systemHealth.disk_used_bytes / systemHealth.disk_total_bytes) * 100
      : 0
  const tempTone =
    systemHealth?.cpu_temp_celsius === null || systemHealth?.cpu_temp_celsius === undefined
      ? "text-muted"
      : systemHealth.cpu_temp_celsius > 75
        ? "text-semantic-red"
        : systemHealth.cpu_temp_celsius >= 60
          ? "text-accent"
          : "text-semantic-green"
  const usageTone = (percent: number) => {
    if (percent > 90) {
      return "text-semantic-red"
    }
    if (percent > 80) {
      return "text-accent"
    }
    return "text-semantic-green"
  }
  const statusBadgeClass =
    systemHealth?.status === "critical"
      ? "border-semantic-red/40 bg-semantic-red/10 text-semantic-red"
      : systemHealth?.status === "warm"
        ? "border-accent/45 bg-accent/14 text-accent"
        : "border-semantic-green/40 bg-semantic-green/10 text-semantic-green"
  const statusLabel =
    systemHealth?.status === "critical"
      ? "Critical"
      : systemHealth?.status === "warm"
        ? "Warm"
        : "Healthy"

  const storageOtherBytes =
    systemHealth === undefined
      ? 0
      : Math.max(
          0,
          systemHealth.disk_used_bytes -
            systemHealth.db_size_bytes -
            systemHealth.receipts_size_bytes
        )

  const usage = usageQuery.data
  const usageTiles = usage
    ? [
        {
          label: "Total cost",
          value:
            usage.costed_chats > 0
              ? formatCostAmount(usage.total_cost_decimal, usage.cost_unit)
              : "Not reported",
          detail:
            usage.costed_chats > 0
              ? `Ø ${formatCostAmount(usage.average_cost_decimal, usage.cost_unit)} per chat`
              : "No billed usage",
        },
        {
          label: "Total tokens",
          value: INTEGER_FORMAT.format(usage.total_tokens),
          detail: `${INTEGER_FORMAT.format(usage.cached_input_tokens)} cached · ${INTEGER_FORMAT.format(usage.reasoning_tokens)} reasoning`,
        },
        {
          label: "Chats",
          value: INTEGER_FORMAT.format(usage.total_chats),
          detail: `${INTEGER_FORMAT.format(usage.completed_chats)} completed · ${INTEGER_FORMAT.format(usage.failed_chats)} failed`,
        },
        {
          label: "Avg / chat",
          value: `${INTEGER_FORMAT.format(usage.average_total_tokens)} tok`,
          detail:
            usage.p95_duration_ms != null
              ? `${INTEGER_FORMAT.format(usage.p95_duration_ms)} ms p95`
              : "no latency yet",
        },
      ]
    : []

  return (
    <section className="space-y-6">
      <PageIntro title="Admin" />

      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <AppCard className="p-5 lg:col-span-2">
          <h2 className="font-head text-2xl font-bold tracking-tight">Pi Health</h2>

          <div className="mt-4 space-y-3">
            <span
              className={`inline-block rounded-full border px-3 py-1 text-xs font-semibold ${statusBadgeClass}`}
            >
              {statusLabel}
            </span>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
              <div className="rounded-lg border border-border bg-surface-hi p-2.5 md:p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted md:text-[11px]">
                  CPU Temp
                </p>
                <p className={`font-mono text-sm font-semibold md:text-base ${tempTone}`}>
                  {systemHealth?.cpu_temp_celsius === null ||
                  systemHealth?.cpu_temp_celsius === undefined
                    ? "N/A"
                    : `${Math.round(systemHealth.cpu_temp_celsius)}°C`}
                </p>
                {sparklinePoints.cpu_temp_celsius && (
                  <Sparkline points={sparklinePoints.cpu_temp_celsius} className="mt-2 h-5 w-full text-accent" />
                )}
              </div>
              <div className="rounded-lg border border-border bg-surface-hi p-2.5 md:p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted md:text-[11px]">
                  CPU Load
                </p>
                <p className="font-mono text-sm font-semibold text-text md:text-base">
                  {systemHealth ? `${Math.round(systemHealth.cpu_load_percent)}%` : "—"}
                </p>
                {sparklinePoints.cpu_load_percent && (
                  <Sparkline points={sparklinePoints.cpu_load_percent} className="mt-2 h-5 w-full text-accent" />
                )}
              </div>
              <div className="min-w-0 rounded-lg border border-border bg-surface-hi p-2.5 md:p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted md:text-[11px]">
                  RAM
                </p>
                <p className={`truncate font-mono text-sm font-semibold md:text-base ${usageTone(ramUsagePercent)}`}>
                  {systemHealth
                    ? `${formatFileSize(systemHealth.ram_used_bytes)} / ${formatFileSize(systemHealth.ram_total_bytes)}`
                    : "—"}
                </p>
                {sparklinePoints.ram_percent && (
                  <Sparkline points={sparklinePoints.ram_percent} className="mt-2 h-5 w-full text-accent" />
                )}
              </div>
              <div className="min-w-0 rounded-lg border border-border bg-surface-hi p-2.5 md:p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted md:text-[11px]">
                  Disk
                </p>
                <p className={`truncate font-mono text-sm font-semibold md:text-base ${usageTone(diskUsagePercent)}`}>
                  {systemHealth
                    ? `${formatFileSize(systemHealth.disk_used_bytes)} / ${formatFileSize(systemHealth.disk_total_bytes)}`
                    : "—"}
                </p>
                {sparklinePoints.disk_percent && (
                  <Sparkline points={sparklinePoints.disk_percent} className="mt-2 h-5 w-full text-accent" />
                )}
              </div>
            </div>
          </div>

          {systemHealth && diskFreePercent < 20 && (
            <div className="mt-4 rounded-lg border border-semantic-red/40 bg-semantic-red/10 p-3">
              <p className="text-sm font-semibold text-semantic-red">
                Storage is running low. {formatFileSize(systemHealth.disk_free_bytes)} remaining.
              </p>
              <p className="mt-1 text-xs text-muted">
                Database: {formatFileSize(systemHealth.db_size_bytes)} · Receipts:{" "}
                {formatFileSize(systemHealth.receipts_size_bytes)} · Other:{" "}
                {formatFileSize(storageOtherBytes)}
              </p>
              <a href="#danger-zone" className="mt-2 inline-block text-xs text-semantic-red underline">
                Purge deleted transactions
              </a>
            </div>
          )}
        </AppCard>

        <div className="space-y-4 rounded-xl border border-semantic-blue/40 bg-semantic-blue/5 p-4">
          <h2 className="text-xl font-head font-bold">Database Backups</h2>
          <p className="text-sm text-muted">
            Download a complete SQLite dump so you can restore everything if
            something goes sideways.
          </p>
          <AppButton asChild className="block text-center">
            <a href="/api/admin/download-db">Download backup</a>
          </AppButton>
        </div>

        <div className="space-y-4 rounded-xl border border-semantic-green/40 bg-semantic-green/5 p-4">
          <h2 className="text-xl font-head font-bold">Export Transactions</h2>
          <p className="text-sm text-muted">
            Grab a CSV of every transaction for auditing or to bring into
            spreadsheets.
          </p>
          <AppButton asChild className="block w-full text-center">
            <a href="/api/admin/export-csv">Export CSV</a>
          </AppButton>
        </div>

        <div className="space-y-4 rounded-xl border border-semantic-blue/40 bg-semantic-blue/5 p-4">
          <h2 className="text-xl font-head font-bold">Import</h2>
          <p className="text-sm text-muted">
            Import transactions from a legacy SQLite database.
          </p>
          <AppButton asChild className="block text-center">
            <Link to="/admin/import">Open importer</Link>
          </AppButton>
        </div>

        <div
          id="danger-zone"
          className="space-y-4 rounded-xl border border-semantic-red/40 bg-semantic-red/5 p-4"
        >
          <h2 className="text-xl font-head font-bold">Danger Zone</h2>
          <p className="text-sm text-muted">
            Purge soft-deleted transactions older than a safe window to keep the
            database lean.
          </p>
          <div className="flex gap-2">
            <AppInput
              type="number"
              min={1}
              max={365}
              value={purgeDays}
              onChange={(event) => setPurgeDays(event.target.value)}
              className="w-24"
              placeholder="30"
            />
            <AppButton
              type="button"
              onClick={handlePurge}
              disabled={purgeMutation.isPending}
              tone="danger"
              className="flex-1"
            >
              {purgeMutation.isPending ? "Purging…" : "Purge now"}
            </AppButton>
          </div>
        </div>

        <div className="space-y-4 rounded-xl border border-accent/40 bg-accent/5 p-4">
          <h2 className="text-xl font-head font-bold">Rebuild Rollups</h2>
          <p className="text-sm text-muted">
            Recalculate monthly aggregates from the transaction ledger (use after
            imports or large backfills).
          </p>
          <AppButton
            type="button"
            onClick={handleRebuild}
            disabled={rebuildMutation.isPending}
            className="w-full"
          >
            {rebuildMutation.isPending ? "Rebuilding…" : "Rebuild now"}
          </AppButton>
        </div>

        <div className="space-y-4 rounded-xl border border-accent/40 bg-accent/5 p-4">
          <h2 className="text-xl font-head font-bold">Recurring Catch-Up</h2>
          <p className="text-sm text-muted">
            Run overdue recurring auto-posts now.
          </p>
          <AppButton
            type="button"
            onClick={handleRecurringCatchUp}
            disabled={recurringCatchUpMutation.isPending}
            className="w-full"
          >
            {recurringCatchUpMutation.isPending ? "Running…" : "Run catch-up"}
          </AppButton>
          {recurringCatchUpMessage && (
            <p
              className={`text-sm ${
                recurringCatchUpMessage.tone === "error"
                  ? "text-semantic-red"
                  : "text-semantic-green"
              }`}
            >
              {recurringCatchUpMessage.text}
            </p>
          )}
        </div>

      </div>

      <AppCard>
        <div className="border-b border-border px-4 py-3">
          <h2 className="font-head text-lg font-bold">System information</h2>
        </div>
        <div className="divide-y divide-border">
          {[
            { label: "App version", value: data.app_version },
            { label: "Environment", value: data.environment },
            { label: "Database path", value: data.db_path },
            { label: "DB size", value: `${data.db_size_mb} MB` },
            {
              label: "DB modified",
              value: data.db_modified
                ? formatEuroDateTime(data.db_modified)
                : "—",
            },
            { label: "Log path", value: data.log_path },
            { label: "Log size", value: `${data.log_size_mb} MB` },
            {
              label: "Log modified",
              value: data.log_modified
                ? formatEuroDateTime(data.log_modified)
                : "—",
            },
            {
              label: "Retained log files",
              value: String(data.log_retained_files),
            },
          ].map((item) => (
            <div
              key={item.label}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <span className="shrink-0 text-sm text-muted">{item.label}</span>
              <span className="min-w-0 truncate font-mono text-sm text-text">{item.value}</span>
            </div>
          ))}
        </div>
      </AppCard>

      <AppCard data-testid="admin-ai-usage">
        <div className="border-b border-border px-4 py-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-head text-lg font-bold">Assistant usage</h2>
              <p className="text-sm text-muted">
                Spending Assistant model usage and cost.
              </p>
            </div>
            <div className="pill-group">
              {([
                ["week", "Week"],
                ["month", "Month"],
                ["all", "All time"],
              ] as Array<[AIUsageSummary["period"], string]>).map(
                ([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setUsagePeriod(value)}
                    className={`pill-button ${usagePeriod === value ? "pill-button-active" : ""}`}
                  >
                    {label}
                  </button>
                )
              )}
            </div>
          </div>
        </div>
        <div className="px-4 py-4">
          {usageQuery.isLoading ? (
            <p className="text-sm text-muted">Loading usage…</p>
          ) : usageQuery.error || !usage ? (
            <p className="text-sm text-muted">
              Usage stats are unavailable right now.
            </p>
          ) : usage.total_chats === 0 ? (
            <p className="text-sm text-muted">
              No assistant usage recorded for this period.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
                {usageTiles.map((tile) => (
                  <div
                    key={tile.label}
                    className="min-w-0 rounded-lg border border-border bg-surface-hi p-2.5 md:p-3"
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted md:text-[11px]">
                      {tile.label}
                    </p>
                    <p className="mt-1 truncate font-mono text-sm font-semibold text-text md:text-base">
                      {tile.value}
                    </p>
                    <p className="mt-1 truncate text-xs text-muted">
                      {tile.detail}
                    </p>
                  </div>
                ))}
              </div>
              <p className="min-h-4 text-xs text-muted">
                {usage.started_at
                  ? `Since ${formatEuroDateTime(usage.started_at)}`
                  : null}
              </p>
            </div>
          )}
        </div>
      </AppCard>

      <AppCard>
        <div className="border-b border-border px-4 py-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-head text-lg font-bold">Application logs</h2>
              <p className="text-sm text-muted">
                Recent structured backend logs from the Pi.
              </p>
            </div>
            <AppInput
              value={logSearch}
              onChange={(event) => {
                setLogSearch(event.target.value)
                setLogCursor(null)
                setSelectedLog(null)
              }}
              placeholder="Search text, request id, event…"
              className="md:max-w-sm"
            />
          </div>
          <div className="mt-3 pill-group">
            {([
              ["errors", "Errors"],
              ["ingest", "Ingest"],
              ["imports", "Imports"],
              ["scheduler", "Scheduler"],
              ["all", "All"],
            ] as Array<[LogFilter, string]>).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => handleLogFilterChange(value)}
                className={`pill-button ${logFilter === value ? "pill-button-active" : ""}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.95fr)]">
          <div className="min-w-0 border-b border-border lg:border-b-0 lg:border-r">
            {logsLoading && !visibleLogs.length ? (
              <div className="px-4 py-6 text-sm text-muted">Loading logs…</div>
            ) : visibleLogs.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted">No matching log entries.</div>
            ) : (
              <div className="max-h-[34rem] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 border-b border-border bg-surface-hi text-left text-xs uppercase text-muted">
                    <tr>
                      <th className="px-4 py-2">Time</th>
                      <th className="px-4 py-2">Level</th>
                      <th className="px-4 py-2">Event</th>
                      <th className="px-4 py-2">Path</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {visibleLogs.map((entry, index) => {
                      const isSelected =
                        selectedLog?.timestamp === entry.timestamp &&
                        selectedLog?.event === entry.event &&
                        selectedLog?.request_id === entry.request_id
                      return (
                        <tr
                          key={`${entry.timestamp}-${entry.event}-${entry.request_id || index}`}
                          className={`cursor-pointer ${
                            isSelected ? "bg-accent/10" : "hover:bg-faint/70"
                          }`}
                          onClick={() => setSelectedLog(entry)}
                        >
                          <td className="whitespace-nowrap px-4 py-3 text-muted">
                            {formatEuroDateTime(entry.timestamp)}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${levelTone(entry.level)}`}
                            >
                              {entry.level}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-text">
                            {entry.event}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-muted">
                            {entry.path || "—"}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {nextLogCursor && (
              <div className="border-t border-border px-4 py-3">
                <AppButton
                  type="button"
                  onClick={() => setLogCursor(nextLogCursor)}
                  tone="ghost"
                >
                  Load older logs
                </AppButton>
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className="border-b border-border px-4 py-3">
              <h3 className="font-head text-base font-bold">Entry details</h3>
            </div>
            {selectedLog ? (
              <div className="space-y-3 px-4 py-4">
                <div className="grid gap-2 text-sm md:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Event
                    </p>
                    <p className="font-mono text-xs text-text">{selectedLog.event}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Request ID
                    </p>
                    <p className="font-mono text-xs text-text">
                      {selectedLog.request_id || "—"}
                    </p>
                  </div>
                </div>
                {"raw_body" in selectedLog && typeof selectedLog.raw_body === "string" && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Captured body
                    </p>
                    <pre className="mt-1 overflow-x-auto rounded-lg border border-border bg-surface-hi p-3 text-xs text-text">
                      {selectedLog.raw_body}
                    </pre>
                  </div>
                )}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Structured payload
                  </p>
                  <pre className="mt-1 max-h-[24rem] overflow-auto rounded-lg border border-border bg-surface-hi p-3 text-xs text-text">
                    {JSON.stringify(selectedLog, null, 2)}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="px-4 py-6 text-sm text-muted">
                Select a log entry to inspect the full payload.
              </div>
            )}
          </div>
        </div>
      </AppCard>
    </section>
  )
}

export default AdminPage
