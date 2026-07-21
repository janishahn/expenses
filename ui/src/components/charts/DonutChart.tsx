import { memo, useMemo } from "react"
import type { ChartOptions } from "chart.js"
import { Doughnut } from "react-chartjs-2"
import { readThemeColor } from "./chartSetup"
import { formatCurrency } from "../../app/format"
import { palette } from "./palette"
import { useThemePreference } from "../../theme/useThemePreference"
import { AppCard } from "../ui/product-card"

const DONUT_OPTIONS: ChartOptions<"doughnut"> = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: "70%",
  plugins: {
    legend: { display: false },
    tooltip: {
      displayColors: false,
      callbacks: {
        title: () => [],
        label: ({ formattedValue }) => `${formattedValue}%`,
      },
    },
  },
  animation: false,
}

export type BreakdownItem = {
  name: string
  amount_cents: number
  percent: number
}

type DonutChartProps = {
  title: string
  breakdown: BreakdownItem[]
  emptyMessage: string
  selectedCategoryName?: string | null
  onToggleCategory?: (categoryName: string) => void
}

function DonutChart({
  title,
  breakdown,
  emptyMessage,
  selectedCategoryName = null,
  onToggleCategory,
}: DonutChartProps) {
  const { effectiveTheme } = useThemePreference()
  const hasSelection = Boolean(selectedCategoryName)
  const accessibleLabel = `${title}. ${breakdown
    .map((row) => `${row.name} ${row.percent.toFixed(1)} percent`)
    .join(", ")}`
  const data = useMemo(() => {
    const surface = readThemeColor("--surface", "12 12 12")
    return {
      labels: breakdown.map((row) => row.name),
      datasets: [
        {
          data: breakdown.map((row) => row.percent),
          backgroundColor: breakdown.map((row, index) => {
            const baseColor = palette[index % palette.length]
            if (!hasSelection || row.name === selectedCategoryName) return baseColor
            return `${baseColor}40`
          }),
          borderWidth: 2,
          borderColor: surface,
          hoverBorderWidth: 2,
        },
      ],
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breakdown, hasSelection, selectedCategoryName, effectiveTheme])

  if (!breakdown.length) {
    return (
      <AppCard className="p-6 text-center">
        <p className="font-head text-lg font-bold text-text">{emptyMessage}</p>
        <p className="text-sm text-muted">Add transactions to see insights.</p>
      </AppCard>
    )
  }

  return (
    <AppCard className="donut-figure min-w-0 w-full space-y-3 p-4">
      <h3 className="font-head text-base font-bold text-text">{title}</h3>
      <div className="donut-figure-grid">
        <div className="mx-auto w-full max-w-[7rem]">
          <div className="rounded-full bg-surface-hi/60 p-1.5">
            <div className="relative aspect-square">
              <Doughnut
                key={`donut-${effectiveTheme}`}
                data={data}
                options={DONUT_OPTIONS}
                role="img"
                aria-label={accessibleLabel}
              />
            </div>
          </div>
        </div>
        <div data-testid="donut-legend" className="donut-legend min-w-0">
          {breakdown.map((row, index) => {
            const isSelected = row.name === selectedCategoryName
            const dimClass = hasSelection && !isSelected ? "opacity-45" : ""
            const stateClass = isSelected ? "bg-faint" : "bg-surface-hi/65"
            const content = (
              <>
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: palette[index % palette.length] }}
                />
                <span className="min-w-0 truncate text-sm font-medium text-text">
                  {row.name}
                </span>
                <span className="justify-self-end font-mono text-xs tabular-nums text-muted">
                  {formatCurrency(row.amount_cents)} €
                </span>
              </>
            )
            const className = `grid min-h-11 min-w-0 grid-cols-[0.625rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2.5 py-1.5 ${dimClass} ${stateClass}`

            if (!onToggleCategory) {
              return (
                <div key={`${row.name}-${index}`} className={className}>
                  {content}
                </div>
              )
            }

            return (
              <button
                key={`${row.name}-${index}`}
                type="button"
                onClick={() => onToggleCategory(row.name)}
                className={`${className} cursor-pointer text-left transition-[background-color,opacity] hover:bg-faint/65 focus-visible:bg-faint/70`}
                aria-label={`${row.name}, ${formatCurrency(row.amount_cents)} euros, ${row.percent.toFixed(1)} percent`}
                aria-pressed={isSelected}
              >
                {content}
              </button>
            )
          })}
        </div>
      </div>
    </AppCard>
  )
}

export default memo(DonutChart)
