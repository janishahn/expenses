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
  lineWidth?: number
  pointRadius?: number
}

type LineChartProps = {
  ariaLabel: string
  labels: string[]
  series: LineSeries[]
  height?: number
  tooltipComparisonLabel?: string
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

function LineChart({
  ariaLabel,
  labels,
  series,
  height = 240,
  tooltipComparisonLabel,
}: LineChartProps) {
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
          pointRadius: item.pointRadius ?? (labels.length === 1 ? 4 : 0),
          pointBackgroundColor: item.color,
          pointBorderColor: item.color,
          pointHitRadius: 16,
          pointHoverRadius: 5,
          pointHoverBorderWidth: 2,
          borderWidth: item.lineWidth ?? 2,
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
    const surface = readThemeColor("--surface-hi", "255 255 255")
    const text = readThemeColor("--text", "24 29 26")
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" as const },
      plugins: {
        legend: { display: false },
        tooltip: {
          position: "nearest" as const,
          backgroundColor: surface,
          titleColor: text,
          bodyColor: text,
          footerColor: muted,
          borderColor: border,
          borderWidth: 1,
          cornerRadius: 10,
          padding: 12,
          caretPadding: 10,
          displayColors: true,
          usePointStyle: true,
          boxWidth: 8,
          boxHeight: 8,
          titleFont: { family: "IBM Plex Mono", size: 11, weight: 600 as const },
          bodyFont: { family: "IBM Plex Mono", size: 11, weight: 500 as const },
          footerFont: { family: "IBM Plex Mono", size: 10, weight: 500 as const },
          callbacks: {
            title: (items: TooltipItem<"line">[]) => items[0]?.label ?? "",
            label: (context: TooltipItem<"line">) => {
              const label = context.dataset.label ?? ""
              const value = context.parsed.y ?? 0
              return `${label}: ${formatCurrency(value)} €`
            },
            footer: (items: TooltipItem<"line">[]) => {
              if (!tooltipComparisonLabel || items.length < 2) return ""
              const first = items[0].parsed.y ?? 0
              const second = items[1].parsed.y ?? 0
              const difference = second - first
              return `${tooltipComparisonLabel}: ${difference >= 0 ? "+" : ""}${formatCurrency(difference)} €`
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
    // Re-read CSS theme tokens when the resolved theme changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveTheme, tooltipComparisonLabel])

  return (
    <div style={{ height }}>
      <Line
        key={`line-${effectiveTheme}`}
        data={data}
        options={options}
        role="img"
        aria-label={ariaLabel}
      />
    </div>
  )
}

export default memo(LineChart)
