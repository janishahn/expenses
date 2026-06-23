import { memo, useMemo } from "react"
import { Doughnut } from "react-chartjs-2"
import { readThemeColor } from "./chartSetup"
import { formatCurrency } from "../../app/format"
import { CategoryIcon } from "../CategoryIcon"
import { palette } from "./palette"
import { useThemePreference } from "../../theme/useThemePreference"
import { AppCard } from "../ui/product-card"

const DONUT_OPTIONS = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: "70%",
  plugins: { legend: { display: false } },
  animation: false as const,
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
  iconMap?: Record<string, string | null>
}

function DonutChart({
  title,
  breakdown,
  emptyMessage,
  selectedCategoryName = null,
  onToggleCategory,
  iconMap,
}: DonutChartProps) {
  const { effectiveTheme } = useThemePreference()
  const hasSelection = Boolean(selectedCategoryName)
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
    <AppCard className="min-w-0 w-full space-y-5 p-5">
      <h3 className="font-head text-lg font-bold text-text">{title}</h3>
      <div className="grid min-w-0 items-center gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="mx-auto w-full max-w-[220px]">
          <div className="rounded-full border border-border bg-surface-hi/60 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="relative aspect-square">
              <Doughnut
                key={`donut-${effectiveTheme}`}
                data={data}
                options={DONUT_OPTIONS}
              />
            </div>
          </div>
        </div>
        <div className="surface-list-shell min-w-0">
          <div className="divide-y divide-border/80">
            {breakdown.map((row, index) => {
              const isSelected = row.name === selectedCategoryName
              const dimClass =
                hasSelection && !isSelected ? "opacity-45" : ""
              const stateClass = isSelected ? "bg-faint/55" : ""
              const content = (
                <>
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    {iconMap && iconMap[row.name] !== undefined ? (
                      <CategoryIcon icon={iconMap[row.name]} />
                    ) : (
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: palette[index % palette.length] }}
                      />
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-medium text-text">{row.name}</p>
                      <p className="text-xs text-muted">
                        {row.percent.toFixed(1)}%
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-sm font-medium tabular-nums text-text">
                    {formatCurrency(row.amount_cents)} €
                  </span>
                </>
              )

              if (!onToggleCategory) {
                return (
                  <div
                    key={`${row.name}-${index}`}
                    className={`flex min-w-0 items-center justify-between gap-4 px-3 py-2.5 ${dimClass} ${stateClass}`}
                  >
                    {content}
                  </div>
                )
              }

              return (
                <button
                  key={`${row.name}-${index}`}
                  type="button"
                  onClick={() => onToggleCategory(row.name)}
                  className={`flex min-w-0 w-full cursor-pointer items-center justify-between gap-4 px-3 py-2.5 text-left transition-colors hover:bg-faint/65 focus-visible:bg-faint/70 ${dimClass} ${stateClass}`}
                  aria-pressed={isSelected}
                >
                  {content}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </AppCard>
  )
}

export default memo(DonutChart)
