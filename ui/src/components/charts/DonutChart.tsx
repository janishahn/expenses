import { memo, useMemo } from "react"
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
} from "recharts"
import { formatCurrency } from "../../app/format"
import { AppCard } from "../ui/product-card"
import {
  CHART_ANIMATION_DURATION,
  CHART_TOOLTIP_ANIMATION_DURATION,
  DarkChartTooltipCard,
  useChartAnimation,
} from "./chartTheme"
import { palette } from "./palette"

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

function DonutTooltip({ active, payload }: Partial<TooltipContentProps>) {
  if (!active || !payload?.length) return null
  const item = payload[0]?.payload as BreakdownItem | undefined
  return item ? <DarkChartTooltipCard value={`${item.percent.toFixed(1)}%`} /> : null
}

function DonutChart({
  title,
  breakdown,
  emptyMessage,
  selectedCategoryName = null,
  onToggleCategory,
}: DonutChartProps) {
  const animationActive = useChartAnimation()
  const hasSelection = Boolean(selectedCategoryName)
  const accessibleLabel = `${title}. ${breakdown
    .map((row) => `${row.name} ${row.percent.toFixed(1)} percent`)
    .join(", ")}`
  const data = useMemo(
    () =>
      breakdown.map((row, index) => {
        const baseColor = palette[index % palette.length]
        return {
          ...row,
          fill:
            !hasSelection || row.name === selectedCategoryName
              ? baseColor
              : `${baseColor}40`,
        }
      }),
    [breakdown, hasSelection, selectedCategoryName],
  )

  if (!breakdown.length) {
    return (
      <AppCard className="p-6 text-center">
        <p className="font-head text-lg font-bold text-text">{emptyMessage}</p>
      </AppCard>
    )
  }

  return (
    <AppCard className="donut-figure min-w-0 w-full space-y-3 p-4">
      <h3 className="font-head text-base font-bold text-text">{title}</h3>
      <div className="donut-figure-grid">
        <div className="mx-auto w-full max-w-[7rem]">
          <div className="rounded-full bg-surface-hi/60 p-1.5">
            <div
              className="relative aspect-square"
              role="img"
              aria-label={accessibleLabel}
            >
              <ResponsiveContainer width="100%" height="100%">
                <PieChart accessibilityLayer={false}>
                  <Pie
                    data={data}
                    dataKey="percent"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius="70%"
                    outerRadius="100%"
                    startAngle={90}
                    endAngle={-270}
                    cornerRadius={4}
                    stroke="rgb(var(--surface))"
                    strokeWidth={2}
                    isAnimationActive={animationActive}
                    animationDuration={CHART_ANIMATION_DURATION}
                  >
                    {data.map((row) => (
                      <Cell key={row.name} fill={row.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    cursor={false}
                    isAnimationActive={animationActive}
                    animationDuration={CHART_TOOLTIP_ANIMATION_DURATION}
                    allowEscapeViewBox={{ x: true, y: true }}
                    position={{ x: 15, y: 42 }}
                    content={<DonutTooltip />}
                  />
                </PieChart>
              </ResponsiveContainer>
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
