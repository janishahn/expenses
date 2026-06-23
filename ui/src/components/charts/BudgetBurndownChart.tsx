import { memo } from "react"
import { Line } from "react-chartjs-2"
import type { Chart, ChartOptions } from "chart.js"
import { readThemeAlpha, readThemeColor } from "./chartSetup"
import { formatCurrency } from "../../app/format"
import { useThemePreference } from "../../theme/useThemePreference"

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
  if (now.getFullYear() < year || (now.getFullYear() === year && now.getMonth() + 1 < month)) {
    return 0
  }
  return daysInMonth
}

function seriesByDay(points: DailyPoint[], daysInMonth: number): number[] {
  const byDay = new Map(points.map((point) => [point.day, point.cumulative_cents]))
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

function BudgetBurndownChart({
  monthValue,
  daysInMonth,
  budgetAmountCents,
  dailySeries,
  compareDailySeries,
  height = 240,
}: BudgetBurndownChartProps) {
  const { effectiveTheme } = useThemePreference()
  const muted = readThemeColor("--muted", "142 160 170")
  const border = readThemeColor("--border", "44 60 70")
  const accent = readThemeColor("--accent", "99 199 214")
  const labels = Array.from({ length: daysInMonth }, (_, index) => String(index + 1))
  const cutoffDay = getCurrentMonthCutoff(monthValue, daysInMonth)

  const ideal = labels.map((_, index) => {
    const day = index + 1
    return Math.round((budgetAmountCents * day) / daysInMonth)
  })

  const actualFull = seriesByDay(dailySeries, daysInMonth)
  const actual = actualFull.map((value, index) => (index + 1 <= cutoffDay ? value : null))

  const belowArea = actual.map((value, index) => {
    if (value === null) return null
    return Math.min(value, ideal[index])
  })
  const aboveArea = actual.map((value, index) => {
    if (value === null) return null
    return Math.max(value, ideal[index])
  })

  const compareBase = compareDailySeries?.length
    ? seriesByDay(compareDailySeries, compareDailySeries.length)
    : []
  const compare = labels.map((_, index) => {
    if (!compareBase.length) return null
    if (index < compareBase.length) return compareBase[index]
    return compareBase[compareBase.length - 1]
  })

  const data = {
    labels,
    datasets: [
      {
        label: "Under pace",
        data: belowArea,
        borderWidth: 0,
        pointRadius: 0,
        fill: { target: 2 },
        backgroundColor: readThemeAlpha("--semantic-green", 0.18, "98 196 146"),
      },
      {
        label: "Over pace",
        data: aboveArea,
        borderWidth: 0,
        pointRadius: 0,
        fill: { target: 2 },
        backgroundColor: readThemeAlpha("--semantic-red", 0.16, "224 114 102"),
      },
      {
        label: "Ideal",
        data: ideal,
        borderColor: muted,
        borderDash: [6, 4],
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
      },
      {
        label: "Actual",
        data: actual,
        borderColor: accent,
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.25,
        fill: false,
      },
      {
        label: "Previous month",
        data: compare,
        borderColor: muted,
        borderDash: [2, 4],
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
      },
    ],
  }

  const todayMarkerPlugin = {
    id: "today-marker",
    afterDraw: (chart: Chart<"line">) => {
      if (cutoffDay <= 0 || cutoffDay >= daysInMonth) {
        return
      }
      const xScale = chart.scales.x
      const yScale = chart.scales.y
      if (!xScale || !yScale) {
        return
      }
      const x = xScale.getPixelForValue(cutoffDay - 1)
      const ctx = chart.ctx
      ctx.save()
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = muted
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x, yScale.top)
      ctx.lineTo(x, yScale.bottom)
      ctx.stroke()
      ctx.restore()
    },
  }

  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (context) => {
            const label = context.dataset.label ?? ""
            const value = context.parsed.y ?? 0
            return `${label}: ${formatCurrency(value)} €`
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: muted, font: { size: 10 }, maxTicksLimit: 8 },
      },
      y: {
        grid: { color: border },
        ticks: {
          color: muted,
          callback: (value) => formatCurrency(Number(value), false),
        },
      },
    },
  }

  return (
    <div className="min-w-0 overflow-hidden" style={{ height }}>
      <Line
        key={`burndown-${effectiveTheme}`}
        className="!h-full !w-full !max-w-full"
        style={{ width: "100%", height: "100%" }}
        data={data}
        options={options}
        plugins={[todayMarkerPlugin]}
      />
    </div>
  )
}

export default memo(BudgetBurndownChart)
