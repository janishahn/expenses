import { memo, useMemo } from "react"
import {
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts"
import { formatCurrency } from "../../app/format"
import {
  CHART_BAR_ANIMATION_DURATION,
  CHART_GRID_COLOR,
  CHART_TICK_STYLE,
  CHART_TOOLTIP_ANIMATION_DURATION,
  LightChartTooltipCard,
  useChartAnimation,
} from "./chartTheme"

type BarSeries = {
  label: string
  data: number[]
  color: string
}

type BarChartProps = {
  ariaLabel: string
  labels: string[]
  series: BarSeries[]
  height?: number
}

type BarRow = {
  label: string
  [key: string]: string | number
}

function BarTooltip({
  active,
  label,
  payload,
}: Partial<TooltipContentProps>) {
  if (!active || !payload?.length) return null
  return (
    <LightChartTooltipCard
      title={label}
      rows={payload.flatMap((item) =>
        typeof item.value === "number"
          ? [
              {
                label: String(item.name ?? ""),
                value: `${formatCurrency(item.value)} €`,
                color: item.color,
              },
            ]
          : [],
      )}
    />
  )
}

function BarChart({ ariaLabel, labels, series, height = 240 }: BarChartProps) {
  const animationActive = useChartAnimation()
  const rows = useMemo<BarRow[]>(
    () =>
      labels.map((label, index) => {
        const row: BarRow = { label }
        series.forEach((item, seriesIndex) => {
          row[`s${seriesIndex}`] = item.data[index] ?? 0
        })
        return row
      }),
    [labels, series],
  )

  return (
    <div role="img" aria-label={ariaLabel} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsBarChart
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
          {series.map((item, index) => (
            <Bar
              key={`${item.label}-${index}`}
              dataKey={`s${index}`}
              name={item.label}
              fill={item.color}
              radius={[6, 6, 0, 0]}
              maxBarSize={28}
              isAnimationActive={animationActive}
              animationDuration={CHART_BAR_ANIMATION_DURATION}
            />
          ))}
          <Tooltip
            cursor={false}
            isAnimationActive={animationActive}
            animationDuration={CHART_TOOLTIP_ANIMATION_DURATION}
            content={<BarTooltip />}
          />
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  )
}

export default memo(BarChart)
