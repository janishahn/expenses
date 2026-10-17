import { Fragment, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { apiFetch } from "../app/api"
import type { AIUsage, AIUsageChat, AIUsageChatDetail, AIUsagePeriod, AIUsageRun, AIUsageSlice } from "../app/api-types"
import { formatCount, formatShortDate, formatShortDateTime } from "../app/format"
import { Button, LinkButton } from "../components/ui/Button"
import { ChartCard, ChartTable, ChartTooltip, Swatch } from "../components/ui/ChartCard"
import { ColumnChart } from "../components/ui/Charts"
import { DayBand } from "../components/ui/DayBand"
import { EmptyState, Status } from "../components/ui/EmptyState"
import { Cell, List, ListFooter, ListHead, Row, type Columns } from "../components/ui/LedgerRow"
import { useIsDesktop } from "../components/ui/layout-state"
import { ErrorBody, LoadingBody } from "../components/ui/Panel"
import { Peek, PeekHeadline, PeekSection } from "../components/ui/Peek"
import { Property, PropertyList } from "../components/ui/PropertyList"
import { SegmentedControl } from "../components/ui/SegmentedControl"
import { MetricStrip, Sheet, type Metric } from "../components/ui/Sheet"
import { FEATURE_NAMES, type UsageScope } from "./ai-usage"

const RUN_STATUS: Record<AIUsageRun["status"], string> = {
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  stopped: "Stopped",
}
const CHAT_PAGE = 50
// The most chats the server lists at once.
const CHAT_LIMIT = 500
// Sized for the settings column, which stays under the 780px narrow width.
const SLICE_COLUMNS: Columns = {
  columns: "10px minmax(0, 1fr) minmax(0, 112px) 48px 96px 80px",
  mobileColumns: "10px minmax(0, 1fr) auto",
}
const CHAT_COLUMNS: Columns = {
  columns: "minmax(0, 1fr) 124px 48px 96px 80px",
  mobileColumns: "minmax(0, 1fr) auto",
}
const RUN_COLUMNS: Columns = {
  columns: "minmax(0, 1fr) 96px 96px",
  mobileColumns: "minmax(0, 1fr) auto",
}
const MONTH = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" })
const MONTH_YEAR = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })

// "$0.0123", "$1.84": costs under a dollar keep three significant digits, so a fraction of a cent stays short.
function usd(decimal: string): string {
  const amount = Number(decimal)
  const options = Math.abs(amount) < 1 ? { maximumSignificantDigits: 3 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 }
  return `$${amount.toLocaleString("en-US", options)}`
}

// A cost no backend reported reads as a dash, never as $0; accessible names say "not priced".
function cost(priced: number, decimal: string): string {
  return priced > 0 ? usd(decimal) : "–"
}

function costLabel(priced: number, decimal: string): string {
  return priced > 0 ? usd(decimal) : "not priced"
}

// "1 turn", "6 turns".
function counted(value: number, noun: string): string {
  return `${formatCount(value)} ${noun}${value === 1 ? "" : "s"}`
}

function seconds(ms: number): string {
  return `${(ms / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })} s`
}

function sliceKey(slice: AIUsageSlice): string {
  return `${slice.feature}|${slice.backend ?? ""}|${slice.model}`
}

function sliceColor(index: number): string {
  return `var(--cat-${(index % 8) + 1})`
}

// "qwen3 on local"; the feature joins it when the same model serves several features.
function sliceName(slice: AIUsageSlice, slices: AIUsageSlice[]): string {
  const name = slice.backend ? `${slice.model} on ${slice.backend}` : slice.model
  const shared = slices.some((other) => other !== slice && other.model === slice.model && other.backend === slice.backend)
  return shared ? `${name} · ${FEATURE_NAMES[slice.feature]}` : name
}

function scopeHref(slice: AIUsageSlice): string {
  const params = new URLSearchParams({ feature: slice.feature, model: slice.model })
  if (slice.backend) params.set("backend", slice.backend)
  return `/admin/usage?${params.toString()}`
}

function chatName(chat: AIUsageChat): string {
  if (chat.access === "own" && chat.title) return chat.title
  if (chat.access === "private") return `Chat by ${chat.username ?? "a removed user"}`
  return "Deleted chat"
}

function bucketLabel(bucket: AIUsage["bucket"], iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  if (bucket === "day") return String(date.getUTCDate())
  if (bucket === "week") return `${date.getUTCDate()} ${MONTH.format(date)}`
  return MONTH.format(date)
}

function bucketTitle(bucket: AIUsage["bucket"], iso: string): string {
  if (bucket === "day") return formatShortDate(iso)
  if (bucket === "week") return `Week of ${formatShortDate(iso)}`
  return MONTH_YEAR.format(new Date(`${iso}T00:00:00Z`))
}

// Stored times are UTC; show them in the browser's time zone.
function localTime(iso: string): string {
  const date = new Date(/(Z|[+-]\d\d:\d\d)$/.test(iso) ? iso : `${iso}Z`)
  const pad = (value: number) => String(value).padStart(2, "0")
  return formatShortDateTime(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`)
}

function usageMetrics(totals: AIUsage["totals"], chats: boolean): Metric[] {
  const runDetail = [
    totals.failed_runs ? `${formatCount(totals.failed_runs)} failed` : null,
    totals.p95_duration_ms != null ? `${seconds(totals.p95_duration_ms)} p95` : null,
  ].filter(Boolean)
  return [
    {
      label: "Cost",
      value: cost(totals.priced_runs, totals.cost_usd),
      detail:
        totals.priced_runs === 0
          ? "No prices reported"
          : totals.priced_runs < totals.runs
            ? `${formatCount(totals.priced_runs)} of ${formatCount(totals.runs)} runs priced`
            : undefined,
    },
    {
      label: "Tokens",
      value: formatCount(totals.total_tokens),
      detail: `${formatCount(totals.cached_input_tokens)} cached`,
    },
    { label: "Runs", value: formatCount(totals.runs), detail: runDetail.length ? runDetail.join(" · ") : undefined },
    ...(chats ? [{ label: "Chats", value: formatCount(totals.chats), detail: counted(totals.turns, "turn") }] : []),
  ]
}

function UsageChart({ data }: { data: AIUsage }) {
  const [chosen, setChosen] = useState<"cost" | "tokens" | null>(null)
  // Usage that no backend priced, such as a self-hosted model's, opens on tokens.
  const measure = chosen ?? (data.totals.priced_runs > 0 ? "cost" : "tokens")
  const value = (slice: AIUsageSlice, index: number) =>
    measure === "cost" ? Number(slice.bucket_cost_usd[index]) : slice.bucket_tokens[index]
  const shown = (slice: AIUsageSlice, index: number) =>
    measure === "cost" ? usd(slice.bucket_cost_usd[index]) : formatCount(slice.bucket_tokens[index])
  // The table keeps each cost exact, where the chart and its tooltip round it.
  const exact = (slice: AIUsageSlice, index: number) =>
    measure === "cost" ? `$${slice.bucket_cost_usd[index]}` : formatCount(slice.bucket_tokens[index])
  const labels = data.buckets.map((iso) => bucketLabel(data.bucket, iso))
  const last = data.buckets.length - 1
  const title = (index: number) => `${bucketTitle(data.bucket, data.buckets[index])}${index === last ? " so far" : ""}`
  return (
    <ChartCard
      title={`By ${data.bucket}`}
      controls={
        <SegmentedControl
          label="Chart measure"
          value={measure}
          options={[
            { value: "cost", label: "Cost" },
            { value: "tokens", label: "Tokens" },
          ]}
          onChange={setChosen}
        />
      }
      legend={data.slices.map((slice, index) => ({ key: sliceKey(slice), label: sliceName(slice, data.slices), color: sliceColor(index) }))}
      empty={measure === "cost" && data.totals.priced_runs === 0 ? "No prices reported in this period." : undefined}
      table={
        <ChartTable
          label={`${measure === "cost" ? "Cost" : "Tokens"} by ${data.bucket}`}
          columns={["Date", ...data.slices.map((slice) => sliceName(slice, data.slices))]}
          rows={data.buckets.map((iso, index) => ({
            key: iso,
            cells: [title(index), ...data.slices.map((slice) => exact(slice, index))],
          }))}
        />
      }
    >
      {(focus) => (
        <ColumnChart
          labels={labels}
          // Phones label every fifth day.
          shortLabels={data.bucket === "day" && labels.length > 7 ? labels.map((label, index) => (index % 5 === 0 ? label : "")) : undefined}
          formatY={(tick) => (measure === "cost" ? usd(String(tick)) : COMPACT.format(tick))}
          focus={focus}
          series={data.slices.map((slice, index) => ({
            key: sliceKey(slice),
            values: data.buckets.map((_, bucket) => value(slice, bucket)),
            color: sliceColor(index),
          }))}
          tooltip={(index) => (
            <ChartTooltip
              title={title(index)}
              rows={data.slices.map((slice, sliceIndex) => ({
                key: sliceKey(slice),
                label: sliceName(slice, data.slices),
                value: shown(slice, index),
                color: sliceColor(sliceIndex),
              }))}
            />
          )}
        />
      )}
    </ChartCard>
  )
}

function SliceList({ slices }: { slices: AIUsageSlice[] }) {
  const navigate = useNavigate()
  const isDesktop = useIsDesktop()
  const features = [...new Set(slices.map((slice) => slice.feature))]
  return (
    <Sheet title="Features and models" body="flush">
      <List flat label="Usage by feature and model">
        <ListHead {...SLICE_COLUMNS}>
          <span />
          <span>Model</span>
          <Cell hide="mobile">Backend</Cell>
          <Cell align="right" hide="mobile">
            Runs
          </Cell>
          <Cell align="right" hide="mobile">
            Tokens
          </Cell>
          <Cell align="right">{isDesktop ? "Cost" : "Usage"}</Cell>
        </ListHead>
        {features.map((feature) => {
          const group = slices.filter((slice) => slice.feature === feature)
          const priced = group.reduce((sum, slice) => sum + slice.priced_runs, 0)
          const groupCost = group.reduce((sum, slice) => sum + Number(slice.cost_usd), 0)
          const tokens = group.reduce((sum, slice) => sum + slice.total_tokens, 0)
          return (
            <Fragment key={feature}>
              <DayBand label={FEATURE_NAMES[feature]} end={priced > 0 ? usd(String(groupCost)) : `${formatCount(tokens)} tokens`} />
              {group.map((slice) => (
                <Row
                  key={sliceKey(slice)}
                  {...SLICE_COLUMNS}
                  label={`${FEATURE_NAMES[slice.feature]}, ${sliceName(slice, [])}, ${counted(slice.runs, "run")}, ${formatCount(slice.total_tokens)} tokens, ${costLabel(slice.priced_runs, slice.cost_usd)}`}
                  onOpen={() => navigate(scopeHref(slice))}
                >
                  <Cell>
                    <Swatch color={sliceColor(slices.indexOf(slice))} />
                  </Cell>
                  <Cell>{slice.model}</Cell>
                  <Cell tone="muted" hide="mobile">
                    {slice.backend}
                  </Cell>
                  <Cell align="right" hide="mobile">
                    {formatCount(slice.runs)}
                  </Cell>
                  <Cell align="right" hide="mobile">
                    {formatCount(slice.total_tokens)}
                  </Cell>
                  <Cell align="right">
                    {isDesktop || slice.priced_runs > 0 ? cost(slice.priced_runs, slice.cost_usd) : `${formatCount(slice.total_tokens)} tokens`}
                  </Cell>
                </Row>
              ))}
            </Fragment>
          )
        })}
      </List>
    </Sheet>
  )
}

function ChatList({
  data,
  selected,
  onSelect,
  onMore,
}: {
  data: AIUsage
  selected: string | null
  onSelect: (id: string) => void
  onMore: () => void
}) {
  const isDesktop = useIsDesktop()
  return (
    <Sheet title="Chats" meta={formatCount(data.chat_count)} body="flush">
      <List
        flat
        label="Assistant chats"
        footer={
          data.chats.length < Math.min(data.chat_count, CHAT_LIMIT) ? (
            <ListFooter>
              <Button variant="ghost" onClick={onMore}>
                Show more
              </Button>
            </ListFooter>
          ) : null
        }
      >
        <ListHead {...CHAT_COLUMNS}>
          <span>Chat</span>
          <Cell hide="mobile">Last turn</Cell>
          <Cell align="right" hide="mobile">
            Turns
          </Cell>
          <Cell align="right" hide="mobile">
            Tokens
          </Cell>
          <Cell align="right">{isDesktop ? "Cost" : "Usage"}</Cell>
        </ListHead>
        {data.chats.map((chat) => (
          <Row
            key={chat.id}
            {...CHAT_COLUMNS}
            label={`${chatName(chat)}, ${counted(chat.turns, "turn")}, ${formatCount(chat.total_tokens)} tokens, ${costLabel(chat.priced_runs, chat.cost_usd)}`}
            selected={chat.id === selected}
            onOpen={() => onSelect(chat.id)}
          >
            <Cell tone={chat.access === "own" ? undefined : "muted"}>{chatName(chat)}</Cell>
            <Cell tone="muted" hide="mobile">
              {localTime(chat.last_run_at)}
            </Cell>
            <Cell align="right" hide="mobile">
              {formatCount(chat.turns)}
            </Cell>
            <Cell align="right" hide="mobile">
              {formatCount(chat.total_tokens)}
            </Cell>
            <Cell align="right">
              {isDesktop || chat.priced_runs > 0 ? cost(chat.priced_runs, chat.cost_usd) : `${formatCount(chat.total_tokens)} tokens`}
            </Cell>
          </Row>
        ))}
      </List>
    </Sheet>
  )
}

// The server's AI usage in a period: totals, a chart and list by feature and model, and
// Assistant chats. A model's row opens the same view for that model alone.
export function UsageSection({
  period,
  scope,
  selectedChat,
  onSelectChat,
}: {
  period: AIUsagePeriod
  scope: UsageScope | null
  selectedChat: string | null
  onSelectChat: (id: string | null) => void
}) {
  const [chatLimit, setChatLimit] = useState(CHAT_PAGE)
  const params = new URLSearchParams({ period, chats: String(chatLimit) })
  if (scope) {
    params.set("feature", scope.feature)
    params.set("model", scope.model)
    if (scope.backend) params.set("backend", scope.backend)
  }
  const view = ["ai-usage", period, scope?.feature, scope?.backend, scope?.model]
  const usage = useQuery({
    queryKey: [...view, chatLimit],
    queryFn: () => apiFetch<AIUsage>(`/api/admin/ai/usage?${params.toString()}`),
    staleTime: 60_000,
    // Showing more chats keeps the figures on screen while the longer list loads.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey.slice(0, view.length).every((part, index) => part === view[index]) ? previous : undefined,
  })
  if (usage.isPending) return <LoadingBody label="Loading usage…" />
  if (usage.error) return <ErrorBody message="Usage is unavailable right now." />
  const data = usage.data
  if (data.totals.runs === 0) return <EmptyState>No AI usage in this period.</EmptyState>
  const chats = scope === null || scope.feature === "spending_chat"
  return (
    <>
      <MetricStrip metrics={usageMetrics(data.totals, chats)} />
      <UsageChart data={data} />
      {scope === null ? <SliceList slices={data.slices} /> : null}
      {chats && data.chat_count > 0 ? (
        <ChatList data={data} selected={selectedChat} onSelect={onSelectChat} onMore={() => setChatLimit(chatLimit + CHAT_PAGE)} />
      ) : null}
    </>
  )
}

function RunRow({ run }: { run: AIUsageRun }) {
  const isDesktop = useIsDesktop()
  const failed = run.status === "failed"
  return (
    <Row
      {...RUN_COLUMNS}
      label={`${RUN_STATUS[run.status]} turn at ${localTime(run.created_at)}, ${formatCount(run.total_tokens)} tokens, ${run.cost_usd !== null ? usd(run.cost_usd) : "not priced"}`}
    >
      <Cell>
        {localTime(run.created_at)}
        {run.status !== "completed" ? (
          <>
            {" · "}
            <Status tone={failed ? "bad" : "neutral"}>{RUN_STATUS[run.status]}</Status>
          </>
        ) : null}
      </Cell>
      <Cell align="right" hide="mobile">
        {formatCount(run.total_tokens)}
      </Cell>
      <Cell align="right">
        {run.cost_usd !== null ? usd(run.cost_usd) : isDesktop ? "–" : `${formatCount(run.total_tokens)} tokens`}
      </Cell>
    </Row>
  )
}

// One chat's usage, turn by turn. Each turn counts every model request and tool call it made.
export function UsageChatPeek({ id, onClose }: { id: string; onClose: () => void }) {
  const chat = useQuery({
    queryKey: ["ai-usage-chat", id],
    queryFn: () => apiFetch<AIUsageChatDetail>(`/api/admin/ai/usage/chats/${id}`),
    staleTime: 60_000,
  })
  const title = chat.data ? chatName(chat.data) : "Chat"
  const models = chat.data ? chat.data.models.map((used) => (used.backend ? `${used.model} on ${used.backend}` : used.model)) : []
  // A long chat lists its latest turns, as the Assistant does.
  const turnsTitle = chat.data && chat.data.runs.length < chat.data.turns ? `Latest ${formatCount(chat.data.runs.length)} turns` : "Turns"
  return (
    <Peek
      parent="AI usage"
      title={title}
      onClose={onClose}
      footer={
        chat.data?.access === "own" ? (
          <LinkButton variant="quiet" to={`/assistant?chat=${id}`}>
            Open chat
          </LinkButton>
        ) : undefined
      }
    >
      {chat.isPending ? (
        <LoadingBody label="Loading chat usage…" />
      ) : chat.error ? (
        <ErrorBody message="This chat's usage is unavailable right now." />
      ) : (
        <>
          <PeekHeadline
            title={title}
            figure={chat.data.priced_runs > 0 ? usd(chat.data.cost_usd) : `${formatCount(chat.data.total_tokens)} tokens`}
            detail={chat.data.priced_runs > 0 ? `${formatCount(chat.data.total_tokens)} tokens` : undefined}
          />
          <PropertyList>
            <Property label="User">{chat.data.username ?? "Removed user"}</Property>
            <Property label="Started">{localTime(chat.data.started_at)}</Property>
            <Property label="Turns">{formatCount(chat.data.turns)}</Property>
            <Property label="Model">{models.join(", ")}</Property>
            <Property label="Tool calls">{formatCount(chat.data.tool_calls)}</Property>
          </PropertyList>
          <PeekSection title={turnsTitle}>
            <List flat label={turnsTitle}>
              {chat.data.runs.map((run, index) => (
                <RunRow key={index} run={run} />
              ))}
            </List>
          </PeekSection>
        </>
      )}
    </Peek>
  )
}
