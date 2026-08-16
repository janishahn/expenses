import { memo, useMemo } from "react"
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
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
  LightChartTooltipCard,
  type ChartTooltipRow,
  useChartAnimation,
} from "./chartTheme"

type DailyPoint = {
  day: number
  cumulative_cents: number
}

type BudgetBurndownChartProps = {
  monthValue: string
  daysInMonth: number
  budgetAmountCents: number
  dailySeries: DailyPoint[]
  compareDailySeries?: DailyPoint[]
  height?: number
}

type BurndownRow = {
  day: string
  under: [number, number] | null
  over: [number, number] | null
  ideal: number
  actual: number | null
  previous: number | null
}

function getCurrentMonthCutoff(monthValue: string, daysInMonth: number): number {
  const [yearRaw, monthRaw] = monthValue.split("-")
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return daysInMonth
  }
  const now = new Date()
  if (now.getFullYear() === year && now.getMonth() + 1 === month) {
    return now.getDate()
  }
  if (
    now.getFullYear() < year ||
    (now.getFullYear() === year && now.getMonth() + 1 < month)
  ) {
    return 0
  }
  return daysInMonth
}

function seriesByDay(points: DailyPoint[], daysInMonth: number): number[] {
  const byDay = new Map(
    points.map((point) => [point.day, point.cumulative_cents]),
  )
  const out: number[] = []
  let last = 0
  for (let day = 1; day <= daysInMonth; day += 1) {
    const value = byDay.get(day)
    if (value !== undefined) {
      last = value
    }
    out.push(last)
  }
  return out
}

function BurndownTooltip({ active, payload }: Partial<TooltipContentProps>) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload as BurndownRow | undefined
  if (!row) return null
  const rows: ChartTooltipRow[] = [
    {
      label: "Ideal",
      value: `${formatCurrency(row.ideal)} €`,
      color: "rgb(var(--muted))",
    },
  ]
  if (row.actual !== null) {
    rows.push({
      label: "Actual",
      value: `${formatCurrency(row.actual)} €`,
      color: "rgb(var(--accent))",
    })
  }
  if (row.previous !== null) {
    rows.push({
      label: "Previous month",
      value: `${formatCurrency(row.previous)} €`,
      color: "rgb(var(--muted))",
    })
  }
  return <LightChartTooltipCard title={`Day ${row.day}`} rows={rows} />
}

function BudgetBurndownChart({
  monthValue,
  daysInMonth,
  budgetAmountCents,
  dailySeries,
  compareDailySeries,
  height = 240,
}: BudgetBurndownChartProps) {
  const animationActive = useChartAnimation()
  const cutoffDay = getCurrentMonthCutoff(monthValue, daysInMonth)
  const rows = useMemo<BurndownRow[]>(() => {
    const actualFull = seriesByDay(dailySeries, daysInMonth)
    const compareBase = compareDailySeries?.length
      ? seriesByDay(compareDailySeries, compareDailySeries.length)
      : []
    return Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1
      const ideal = Math.round((budgetAmountCents * day) / daysInMonth)
      const actual = day <= cutoffDay ? actualFull[index] : null
      const previous = compareBase.length
        ? compareBase[Math.min(index, compareBase.length - 1)]
        : null
      return {
        day: String(day),
        under:
          actual === null ? null : [Math.min(actual, ideal), ideal],
        over:
          actual === null ? null : [ideal, Math.max(actual, ideal)],
        ideal,
        actual,
        previous,
      }
    })
  }, [budgetAmountCents, compareDailySeries, cutoffDay, dailySeries, daysInMonth])

  return (
    <div
      className="min-w-0 overflow-hidden"
      style={{ height }}
      role="img"
      aria-label={`Budget spending pace for ${monthValue}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={rows}
          margin={{ top: 12, right: 12, bottom: 4, left: 4 }}
          accessibilityLayer={false}
        >
          <CartesianGrid stroke={CHART_GRID_COLOR} vertical={false} />
          <XAxis
            dataKey="day"
            axisLine={false}
            tickLine={false}
            tick={CHART_TICK_STYLE}
            tickMargin={9}
            height={30}
            interval="preserveStartEnd"
            minTickGap={20}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={CHART_TICK_STYLE}
            tickMargin={8}
            tickFormatter={(value: number) => formatCurrency(value, false)}
            width={58}
          />
          <Area
            dataKey="under"
            type="monotone"
            fill="rgb(var(--semantic-green) / 0.18)"
            fillOpacity={1}
            stroke="none"
            activeDot={false}
            connectNulls={false}
            isAnimationActive={animationActive}
            animationDuration={CHART_ANIMATION_DURATION}
          />
          <Area
            dataKey="over"
            type="monotone"
            fill="rgb(var(--semantic-red) / 0.16)"
            fillOpacity={1}
            stroke="none"
            activeDot={false}
            connectNulls={false}
            isAnimationActive={animationActive}
            animationDuration={CHART_ANIMATION_DURATION}
          />
          <Line
            dataKey="ideal"
            name="Ideal"
            type="linear"
            stroke="rgb(var(--muted))"
            strokeWidth={1.5}
            strokeDasharray="6 4"
            strokeLinecap="round"
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={animationActive}
            animationDuration={CHART_ANIMATION_DURATION}
          />
          <Line
            dataKey="actual"
            name="Actual"
            type="monotone"
            stroke="rgb(var(--accent))"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={false}
            activeDot={{ r: 4 }}
            connectNulls={false}
            isAnimationActive={animationActive}
            animationDuration={CHART_ANIMATION_DURATION}
          />
          <Line
            dataKey="previous"
            name="Previous month"
            type="linear"
            stroke="rgb(var(--muted))"
            strokeWidth={1.5}
            strokeDasharray="2 4"
            strokeLinecap="round"
            dot={false}
            activeDot={{ r: 4 }}
            connectNulls={false}
            isAnimationActive={animationActive}
            animationDuration={CHART_ANIMATION_DURATION}
          />
          {cutoffDay > 0 && cutoffDay < daysInMonth ? (
            <ReferenceLine
              x={String(cutoffDay)}
              stroke="rgb(var(--muted))"
              strokeDasharray="4 4"
            />
          ) : null}
          <Tooltip
            cursor={false}
            isAnimationActive={animationActive}
            animationDuration={CHART_TOOLTIP_ANIMATION_DURATION}
            content={<BurndownTooltip />}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

export default memo(BudgetBurndownChart)
