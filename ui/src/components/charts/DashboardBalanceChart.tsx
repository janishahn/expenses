import { memo, useMemo } from "react"
import type { ChartData, ChartOptions, TooltipItem } from "chart.js"
import { Line } from "react-chartjs-2"
import { formatCurrency } from "../../app/format"
import { useThemePreference } from "../../theme/useThemePreference"
import { readThemeAlpha, readThemeColor } from "./chartSetup"

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

const EMPTY_FORECAST_MONTHS: DashboardForecast["months"] = []

function shortMonth(month: string): string {
  return new Intl.DateTimeFormat("en-GB", { month: "short" }).format(
    new Date(`${month}-01T00:00:00`),
  )
}

function DashboardBalanceChart({
  actualMonths,
  currentBalanceCents,
  forecast,
  forecastStatus,
  incognito,
}: DashboardBalanceChartProps) {
  const { effectiveTheme } = useThemePreference()
  const forecastMonths = forecast?.months ?? EMPTY_FORECAST_MONTHS
  const actual = useMemo(
    () => actualMonths.length
      ? actualMonths
      : [{ month: "today", balance_cents: currentBalanceCents }],
    [actualMonths, currentBalanceCents],
  )
  const finalForecast = forecastMonths[forecastMonths.length - 1]
  const currentDate = new Date()
  const currentMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}`
  const actualEnd = actual[actual.length - 1]
  const actualEndLabel = actualEnd.month === "today" || actualEnd.month === currentMonth
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
  const actualData = [
    ...actual.map((point) => point.balance_cents),
    ...forecastMonths.map(() => null),
  ]
  const projectedData = [
    ...actual.slice(0, -1).map(() => null),
    actual[actual.length - 1].balance_cents,
    ...forecastMonths.map((month) => month.end_balance_cents),
  ]
  const intervalAvailable = forecastMonths.length > 0 && forecastMonths.every(
    (month) =>
      month.end_balance_p10_cents != null && month.end_balance_p90_cents != null,
  )
  const lowerData = [
    ...actual.slice(0, -1).map(() => null),
    actual[actual.length - 1].balance_cents,
    ...forecastMonths.map((month) => month.end_balance_p10_cents ?? null),
  ]
  const upperData = [
    ...actual.slice(0, -1).map(() => null),
    actual[actual.length - 1].balance_cents,
    ...forecastMonths.map((month) => month.end_balance_p90_cents ?? null),
  ]
  const primary = readThemeColor("--primary", "59 78 232")
  const warning = readThemeColor("--warning", "237 189 53")
  const intervalFill = readThemeAlpha("--warning", 0.16, "237 189 53")
  const line = readThemeColor("--border", "217 220 214")
  const muted = readThemeColor("--muted", "116 122 118")
  const surface = readThemeColor("--surface-hi", "255 255 255")
  const text = readThemeColor("--text", "24 29 26")

  const data: ChartData<"line", Array<number | null>, string> = {
    labels,
    datasets: [
      ...(intervalAvailable
        ? [
            {
              label: "80% range low",
              data: lowerData,
              borderColor: "rgb(0 0 0 / 0)",
              backgroundColor: "rgb(0 0 0 / 0)",
              pointRadius: 0,
              borderWidth: 0,
              tension: 0.38,
              spanGaps: false,
            },
            {
              label: "80% range high",
              data: upperData,
              borderColor: "rgb(0 0 0 / 0)",
              backgroundColor: intervalFill,
              pointRadius: 0,
              borderWidth: 0,
              tension: 0.38,
              spanGaps: false,
              fill: 0,
            },
          ]
        : []),
      {
        label: "Actual",
        data: actualData,
        borderColor: primary,
        pointRadius: 0,
        pointHitRadius: 16,
        pointHoverRadius: 5,
        pointHoverBorderWidth: 2,
        borderWidth: 3,
        tension: 0.38,
        spanGaps: false,
      },
      ...(forecastMonths.length
        ? [{
            label: "Likely",
            data: projectedData,
            borderColor: warning,
            pointRadius: 0,
            pointHitRadius: 16,
            pointHoverRadius: 5,
            pointHoverBorderWidth: 2,
            borderWidth: 3,
            borderDash: [7, 6],
            tension: 0.38,
            spanGaps: false,
          }]
        : []),
    ],
  }
  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { intersect: false, mode: "index" },
    plugins: {
      legend: { display: false },
      tooltip: {
        enabled: !incognito,
        position: "nearest",
        backgroundColor: surface,
        titleColor: text,
        bodyColor: text,
        borderColor: line,
        borderWidth: 1,
        cornerRadius: 10,
        padding: 12,
        caretPadding: 10,
        displayColors: true,
        usePointStyle: true,
        boxWidth: 8,
        boxHeight: 8,
        titleFont: { family: "IBM Plex Mono", size: 11, weight: 600 },
        bodyFont: { family: "IBM Plex Mono", size: 11, weight: 500 },
        callbacks: {
          title: (items: TooltipItem<"line">[]) => items[0]?.label ?? "",
          label: (context: TooltipItem<"line">) => {
            const label = context.dataset.label === "Likely"
              ? "Likely balance"
              : context.dataset.label === "80% range low"
                ? "80% range low"
                : context.dataset.label === "80% range high"
                  ? "80% range high"
                  : "Actual balance"
            return `${label}: ${formatCurrency(context.parsed.y ?? 0)} €`
          },
        },
      },
    },
    scales: {
      x: {
        border: { display: false },
        grid: { display: false },
        ticks: {
          color: muted,
          autoSkip: false,
          minRotation: 0,
          maxRotation: 0,
          font: { family: "IBM Plex Mono", size: 9, weight: 500 },
          callback: (_value, index) => {
            if (index === 0 || index === actual.length - 1 || index === labels.length - 1) {
              return index === actual.length - 1 ? actualEndLabel : labels[index]
            }
            return ""
          },
        },
      },
      y: {
        border: { display: false },
        grid: { color: line, drawTicks: false },
        ticks: { display: false, count: 4 },
      },
    },
  }
  const forecastStatusText = finalForecast
    ? `${shortMonth(finalForecast.month)} likely balance ${formatCurrency(finalForecast.end_balance_cents)} euros${finalForecast.end_balance_p10_cents != null && finalForecast.end_balance_p90_cents != null ? `, with an 80 percent range from ${formatCurrency(finalForecast.end_balance_p10_cents)} to ${formatCurrency(finalForecast.end_balance_p90_cents)} euros` : ""}`
    : forecastStatus === "historical"
      ? "The selected period is historical"
      : forecastStatus === "loading"
        ? "Likely forecast is loading"
        : "Likely forecast is unavailable"
  const historyText = actualMonths.length > 1
    ? `Actual balance moved from ${formatCurrency(actualMonths[0].balance_cents)} euros in ${shortMonth(actualMonths[0].month)} to ${formatCurrency(actualMonths[actualMonths.length - 1].balance_cents)} euros ${actualEndLabel === "Today" ? "today" : `in ${actualEndLabel}`}.`
    : `Current actual balance is ${formatCurrency(currentBalanceCents)} euros; earlier history is unavailable.`
  const accessibleLabel = incognito
    ? `Actual balance history hidden. ${finalForecast ? `${shortMonth(finalForecast.month)} likely balance hidden` : forecastStatusText}.`
    : `${historyText} ${forecastStatusText}.`

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
              <span className="w-5 border-t-[3px] border-dashed border-[rgb(var(--warning))]" aria-hidden="true" />
              Likely
            </span>
          ) : null}
        </div>
        <p className={`font-mono text-[10px] font-semibold tabular-nums text-muted ${incognito ? "kpi-hidden" : ""}`}>
          {finalForecast
            ? `${shortMonth(finalForecast.month)} · ${formatCurrency(finalForecast.end_balance_cents, false)} €`
            : forecastStatus === "historical"
              ? "Historical period"
              : forecastStatus === "loading"
                ? "Loading forecast…"
                : "Forecast unavailable"}
        </p>
      </div>
      <div className="mt-1 h-[126px] min-w-0">
        <Line
          key={`dashboard-balance-${effectiveTheme}`}
          data={data}
          options={options}
          role="img"
          aria-label={accessibleLabel}
        />
      </div>
    </div>
  )
}

export default memo(DashboardBalanceChart)
