import { memo, useMemo } from "react"
import { Bar } from "react-chartjs-2"
import type { TooltipItem } from "chart.js"
import { readThemeColor } from "./chartSetup"
import { formatCurrency } from "../../app/format"
import { useThemePreference } from "../../theme/useThemePreference"

type BarSeries = {
  label: string
  data: number[]
  color: string
}

type BarChartProps = {
  labels: string[]
  series: BarSeries[]
  height?: number
}

function BarChart({ labels, series, height = 240 }: BarChartProps) {
  const { effectiveTheme } = useThemePreference()
  const data = useMemo(
    () => ({
      labels,
      datasets: series.map((item) => ({
        label: item.label,
        data: item.data,
        backgroundColor: item.color,
        borderRadius: 6,
        maxBarThickness: 28,
      })),
    }),
    [labels, series],
  )

  const options = useMemo(() => {
    const muted = readThemeColor("--muted", "142 160 170")
    const border = readThemeColor("--border", "44 60 70")
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context: TooltipItem<"bar">) => {
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
          ticks: { color: muted, font: { size: 10 }, maxTicksLimit: 8, autoSkip: true },
        },
        y: {
          grid: { color: border },
          ticks: {
            color: muted,
            callback: (value: number | string) =>
              formatCurrency(Number(value), false),
          },
        },
      },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveTheme])

  return (
    <div style={{ height }}>
      <Bar key={`bar-${effectiveTheme}`} data={data} options={options} />
    </div>
  )
}

export default memo(BarChart)
