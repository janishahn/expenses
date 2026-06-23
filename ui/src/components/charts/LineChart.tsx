import { memo, useMemo } from "react"
import { Line } from "react-chartjs-2"
import type { TooltipItem } from "chart.js"
import { readThemeColor } from "./chartSetup"
import { formatCurrency } from "../../app/format"
import { useThemePreference } from "../../theme/useThemePreference"

type LineSeries = {
  label: string
  data: number[]
  color: string
  fill?: boolean | number
  fillColor?: string
  dashed?: boolean
}

type LineChartProps = {
  labels: string[]
  series: LineSeries[]
  height?: number
}

function withAlpha(color: string, alpha: number): string {
  const normalized = color.trim()
  const rgbMatch = normalized.match(/^rgb\(\s*([^)]+?)\s*\)$/i)
  if (rgbMatch) {
    return `rgb(${rgbMatch[1]} / ${alpha})`
  }

  const hexMatch = normalized.match(/^#([0-9a-f]{6}|[0-9a-f]{3})$/i)
  if (hexMatch) {
    const hex = hexMatch[1]
    const expanded =
      hex.length === 3
        ? hex
            .split("")
            .map((value) => value + value)
            .join("")
        : hex
    const alphaHex = Math.round(alpha * 255)
      .toString(16)
      .padStart(2, "0")
    return `#${expanded}${alphaHex}`
  }

  return normalized
}

function LineChart({ labels, series, height = 240 }: LineChartProps) {
  const { effectiveTheme } = useThemePreference()
  const data = useMemo(
    () => ({
      labels,
      datasets: series.map((item) => {
        const fillTarget =
          typeof item.fill === "number"
            ? item.fill
            : item.fill
              ? "start"
              : false
        return {
          label: item.label,
          data: item.data,
          borderColor: item.color,
          backgroundColor:
            fillTarget !== false
              ? item.fillColor || withAlpha(item.color, 0.2)
              : item.color,
          pointRadius: 0,
          borderWidth: 2,
          tension: 0.35,
          fill: fillTarget,
          borderDash: item.dashed ? [6, 4] : undefined,
        }
      }),
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
            label: (context: TooltipItem<"line">) => {
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
      <Line key={`line-${effectiveTheme}`} data={data} options={options} />
    </div>
  )
}

export default memo(LineChart)
