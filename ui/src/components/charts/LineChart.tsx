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
  CHART_TICK_STYLE,
  CHART_TOOLTIP_ANIMATION_DURATION,
  type ChartTooltipRow,
  LightChartTooltipCard,
  useChartAnimation,
  withAlpha,
} from "./chartTheme"

type LineSeries = {
  label: string
  data: number[]
  color: string
  fill?: boolean | number
  fillColor?: string
  dashed?: boolean
  lineWidth?: number
  pointRadius?: number
}

type LineBand = {
  lower: Array<number | null>
  upper: Array<number | null>
  fill: string
  labelLow?: string
  labelHigh?: string
}

type LineChartProps = {
  ariaLabel: string
  labels: string[]
  series: LineSeries[]
  band?: LineBand
  height?: number
  tooltipComparisonLabel?: string
}

type LineRow = {
  label: string
  band?: [number | null, number | null]
  [key: string]: string | number | null | [number | null, number | null] | undefined
}

function LineTooltip({
  active,
  label,
  payload,
  series,
  band,
  comparisonLabel,
}: Partial<TooltipContentProps> & {
  series: LineSeries[]
  band?: LineBand
  comparisonLabel?: string
}) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload as LineRow | undefined
  if (!row) return null

  const rows: ChartTooltipRow[] = series.flatMap((item, index) => {
    const value = row[`s${index}`]
    return typeof value === "number"
      ? [{ label: item.label, value: `${formatCurrency(value)} €`, color: item.color }]
      : []
  })
  if (band && row.band) {
    const [low, high] = row.band
    if (band.labelLow && low !== null) {
      rows.push({ label: band.labelLow, value: `${formatCurrency(low)} €` })
    }
    if (band.labelHigh && high !== null) {
      rows.push({ label: band.labelHigh, value: `${formatCurrency(high)} €` })
    }
  }

  const first = row.s0
  const second = row.s1
  const difference =
    comparisonLabel && typeof first === "number" && typeof second === "number"
      ? second - first
      : null

  return (
    <LightChartTooltipCard
      title={label}
      rows={rows}
      footer={
        difference === null
          ? undefined
          : `${comparisonLabel}: ${difference >= 0 ? "+" : ""}${formatCurrency(difference)} €`
      }
    />
  )
}

function LineChart({
  ariaLabel,
  labels,
  series,
  band,
  height = 240,
  tooltipComparisonLabel,
}: LineChartProps) {
  const animationActive = useChartAnimation()
  const rows = useMemo<LineRow[]>(
    () =>
      labels.map((label, index) => {
        const row: LineRow = { label }
        series.forEach((item, seriesIndex) => {
          row[`s${seriesIndex}`] = item.data[index] ?? null
        })
        if (band) {
          row.band = [band.lower[index] ?? null, band.upper[index] ?? null]
        }
        return row
      }),
    [band, labels, series],
  )

  return (
    <div role="img" aria-label={ariaLabel} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={rows}
          margin={{ top: 12, right: 12, bottom: 4, left: 4 }}
          accessibilityLayer={false}
        >
          <CartesianGrid stroke={CHART_GRID_COLOR} vertical={false} />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={CHART_TICK_STYLE}
            tickMargin={9}
            height={30}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={CHART_TICK_STYLE}
            tickMargin={8}
            tickFormatter={(value: number) => formatCurrency(value, false)}
            width={58}
          />
          {band ? (
            <Area
              dataKey="band"
              type="monotone"
              fill={band.fill}
              fillOpacity={1}
              stroke="none"
              activeDot={false}
              connectNulls={false}
              isAnimationActive={animationActive}
              animationDuration={CHART_ANIMATION_DURATION}
            />
          ) : null}
          {series.map((item, index) => {
            const common = {
              dataKey: `s${index}`,
              name: item.label,
              type: "monotone" as const,
              stroke: item.color,
              strokeWidth: item.lineWidth ?? 2,
              strokeLinecap: "round" as const,
              strokeLinejoin: "round" as const,
              strokeDasharray: item.dashed ? "6 4" : undefined,
              dot:
                item.pointRadius !== undefined
                  ? { r: item.pointRadius, fill: item.color, stroke: item.color }
                  : labels.length === 1
                    ? { r: 4, fill: item.color, stroke: item.color }
                    : false,
              activeDot: { r: 5, strokeWidth: 2 },
              connectNulls: false,
              isAnimationActive: animationActive,
              animationDuration: CHART_ANIMATION_DURATION,
            }
            return item.fill ? (
              <Area
                key={`${item.label}-${index}`}
                {...common}
                fill={item.fillColor ?? withAlpha(item.color, 0.2)}
                fillOpacity={1}
              />
            ) : (
              <Line key={`${item.label}-${index}`} {...common} fill="none" />
            )
          })}
          <Tooltip
            cursor={false}
            isAnimationActive={animationActive}
            animationDuration={CHART_TOOLTIP_ANIMATION_DURATION}
            content={
              <LineTooltip
                series={series}
                band={band}
                comparisonLabel={tooltipComparisonLabel}
              />
            }
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

export default memo(LineChart)
