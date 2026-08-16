import { memo, useMemo } from "react"
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts"
import { formatCurrency } from "../../app/format"
import {
  CHART_ANIMATION_DURATION,
  CHART_GRID_COLOR,
  CHART_MONO_TICK_STYLE,
  CHART_TOOLTIP_ANIMATION_DURATION,
  LightChartTooltipCard,
  type ChartTooltipRow,
  useChartAnimation,
} from "./chartTheme"

export type DashboardForecast = {
  start_balance_cents: number
  months: Array<{
    month: string
    end_balance_cents: number
    end_balance_p10_cents?: number | null
    end_balance_p90_cents?: number | null
  }>
}

type ActualBalanceMonth = {
  month: string
  balance_cents: number
}

type DashboardBalanceChartProps = {
  actualMonths: ActualBalanceMonth[]
  currentBalanceCents: number
  forecast?: DashboardForecast
  forecastStatus: "historical" | "loading" | "unavailable" | "ready"
  incognito: boolean
}

type BalanceRow = {
  index: number
  label: string
  actual: number | null
  likely: number | null
  range: [number | null, number | null] | null
}

const EMPTY_FORECAST_MONTHS: DashboardForecast["months"] = []

function shortMonth(month: string): string {
  return new Intl.DateTimeFormat("en-GB", { month: "short" }).format(
    new Date(`${month}-01T00:00:00`),
  )
}

function BalanceTooltip({ active, payload }: Partial<TooltipContentProps>) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload as BalanceRow | undefined
  if (!row) return null

  const rows: ChartTooltipRow[] = []
  if (row.range) {
    const [low, high] = row.range
    if (low !== null) {
      rows.push({ label: "80% range low", value: `${formatCurrency(low)} €` })
    }
    if (high !== null) {
      rows.push({ label: "80% range high", value: `${formatCurrency(high)} €` })
    }
  }
  if (row.actual !== null) {
    rows.push({
      label: "Actual balance",
      value: `${formatCurrency(row.actual)} €`,
      color: "rgb(var(--primary))",
    })
  }
  if (row.likely !== null) {
    rows.push({
      label: "Likely balance",
      value: `${formatCurrency(row.likely)} €`,
      color: "rgb(var(--warning))",
    })
  }

  return <LightChartTooltipCard title={row.label} rows={rows} />
}

function DashboardBalanceChart({
  actualMonths,
  currentBalanceCents,
  forecast,
  forecastStatus,
  incognito,
}: DashboardBalanceChartProps) {
  const animationActive = useChartAnimation()
  const forecastMonths = forecast?.months ?? EMPTY_FORECAST_MONTHS
  const actual = useMemo(
    () =>
      actualMonths.length
        ? actualMonths
        : [{ month: "today", balance_cents: currentBalanceCents }],
    [actualMonths, currentBalanceCents],
  )
  const finalForecast = forecastMonths[forecastMonths.length - 1]
  const currentDate = new Date()
  const currentMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}`
  const actualEnd = actual[actual.length - 1]
  const actualEndLabel =
    actualEnd.month === "today" || actualEnd.month === currentMonth
      ? "Today"
      : shortMonth(actualEnd.month)
  const labels = useMemo(
    () => [
      ...actual.map((point) =>
        point.month === "today" ? "Today" : shortMonth(point.month),
      ),
      ...forecastMonths.map((month) => shortMonth(month.month)),
    ],
    [actual, forecastMonths],
  )
  const intervalAvailable =
    forecastMonths.length > 0 &&
    forecastMonths.every(
      (month) =>
        month.end_balance_p10_cents != null &&
        month.end_balance_p90_cents != null,
    )
  const rows = useMemo<BalanceRow[]>(
    () =>
      labels.map((label, index) => {
        const actualPoint = actual[index]
        const forecastIndex = index - actual.length
        const forecastPoint = forecastMonths[forecastIndex]
        const isBridge = index === actual.length - 1
        return {
          index,
          label: isBridge ? actualEndLabel : label,
          actual: actualPoint?.balance_cents ?? null,
          likely: isBridge
            ? actualEnd.balance_cents
            : forecastPoint?.end_balance_cents ?? null,
          range:
            intervalAvailable && (isBridge || forecastPoint)
              ? isBridge
                ? [actualEnd.balance_cents, actualEnd.balance_cents]
                : [
                    forecastPoint.end_balance_p10_cents ?? null,
                    forecastPoint.end_balance_p90_cents ?? null,
                  ]
              : null,
        }
      }),
    [actual, actualEnd.balance_cents, actualEndLabel, forecastMonths, intervalAvailable, labels],
  )
  const forecastStatusText = finalForecast
    ? `${shortMonth(finalForecast.month)} likely balance ${formatCurrency(finalForecast.end_balance_cents)} euros${finalForecast.end_balance_p10_cents != null && finalForecast.end_balance_p90_cents != null ? `, with an 80 percent range from ${formatCurrency(finalForecast.end_balance_p10_cents)} to ${formatCurrency(finalForecast.end_balance_p90_cents)} euros` : ""}`
    : forecastStatus === "historical"
      ? "The selected period is historical"
      : forecastStatus === "loading"
        ? "Likely forecast is loading"
        : "Likely forecast is unavailable"
  const historyText =
    actualMonths.length > 1
      ? `Actual balance moved from ${formatCurrency(actualMonths[0].balance_cents)} euros in ${shortMonth(actualMonths[0].month)} to ${formatCurrency(actualMonths[actualMonths.length - 1].balance_cents)} euros ${actualEndLabel === "Today" ? "today" : `in ${actualEndLabel}`}.`
      : `Current actual balance is ${formatCurrency(currentBalanceCents)} euros; earlier history is unavailable.`
  const accessibleLabel = incognito
    ? `Actual balance history hidden. ${finalForecast ? `${shortMonth(finalForecast.month)} likely balance hidden` : forecastStatusText}.`
    : `${historyText} ${forecastStatusText}.`
  const xTicks = [...new Set([0, actual.length - 1, labels.length - 1])]
  const lineSegmentCount = Math.max(1, labels.length - 1)
  const actualLineAnimationDuration = Math.round(
    CHART_ANIMATION_DURATION *
      (Math.max(0, actual.length - 1) / lineSegmentCount),
  )
  const likelyLineAnimationDuration =
    CHART_ANIMATION_DURATION - actualLineAnimationDuration

  return (
    <div data-testid="dashboard-balance-history" className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <div className="flex items-center gap-3 text-[11px] font-medium text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-5 border-t-[3px] border-primary" aria-hidden="true" />
            Actual
          </span>
          {forecastMonths.length ? (
            <span className="inline-flex items-center gap-1.5">
              <span
                className="w-5 border-t-[3px] border-dashed border-[rgb(var(--warning))]"
                aria-hidden="true"
              />
              Likely
            </span>
          ) : null}
        </div>
        <p
          className={`font-mono text-[10px] font-semibold tabular-nums text-muted ${incognito ? "kpi-hidden" : ""}`}
        >
          {finalForecast
            ? `${shortMonth(finalForecast.month)} · ${formatCurrency(finalForecast.end_balance_cents, false)} €`
            : forecastStatus === "historical"
              ? "Historical period"
              : forecastStatus === "loading"
                ? "Loading forecast…"
                : "Forecast unavailable"}
        </p>
      </div>
      <div className="mt-1 h-[126px] min-w-0" role="img" aria-label={accessibleLabel}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={rows}
            margin={{ top: 8, right: 8, bottom: 2, left: 4 }}
            accessibilityLayer={false}
          >
            <CartesianGrid stroke={CHART_GRID_COLOR} vertical={false} />
            <XAxis
              type="number"
              dataKey="index"
              domain={[0, Math.max(0, labels.length - 1)]}
              ticks={xTicks}
              tickFormatter={(value: number) => rows[value]?.label ?? ""}
              axisLine={false}
              tickLine={false}
              tick={{ ...CHART_MONO_TICK_STYLE, fontSize: 10 }}
              tickMargin={6}
            />
            <YAxis hide tickCount={4} />
            {intervalAvailable ? (
              <Area
                dataKey="range"
                type="monotone"
                fill="rgb(var(--warning) / 0.16)"
                fillOpacity={1}
                stroke="none"
                activeDot={false}
                connectNulls={false}
                isAnimationActive={animationActive}
                animationDuration={CHART_ANIMATION_DURATION}
              />
            ) : null}
            <Line
              dataKey="actual"
              name="Actual"
              type="monotone"
              stroke="rgb(var(--primary))"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={false}
              activeDot={{ r: 5, strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={animationActive}
              animationDuration={actualLineAnimationDuration}
              animationEasing={forecastMonths.length ? "linear" : undefined}
            />
            {forecastMonths.length ? (
              <Line
                dataKey="likely"
                name="Likely"
                type="monotone"
                stroke="rgb(var(--warning))"
                strokeWidth={3}
                strokeDasharray="7 6"
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                activeDot={{ r: 5, strokeWidth: 2 }}
                connectNulls={false}
                isAnimationActive={animationActive}
                animationBegin={actualLineAnimationDuration}
                animationDuration={likelyLineAnimationDuration}
                animationEasing="linear"
              />
            ) : null}
            {!incognito ? (
              <Tooltip
                cursor={false}
                isAnimationActive={animationActive}
                animationDuration={CHART_TOOLTIP_ANIMATION_DURATION}
                content={<BalanceTooltip />}
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default memo(DashboardBalanceChart)
