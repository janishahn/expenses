import { memo, useMemo } from "react"
import { Link } from "react-router-dom"
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts"
import { formatCurrency } from "../../app/format"
import {
  FinancialPanel,
  SectionHeading,
} from "../product/ProductSurfaces"
import { palette } from "./palette"
import {
  CHART_BAR_ANIMATION_DURATION,
  CHART_TOOLTIP_ANIMATION_DURATION,
  DarkChartTooltipCard,
  useChartAnimation,
} from "./chartTheme"

export type SpendingBandSegment = {
  category_id: number | null
  name: string
  icon: string | null
  amount_cents: number
}

export type SpendingBandMonth = {
  month: string
  balance_cents?: number | null
  total_cents: number
  segments: SpendingBandSegment[]
}

type SpendingBandsChartProps = {
  months: SpendingBandMonth[]
  incognito: boolean
  returnTo: string
  loading?: boolean
  unavailable?: boolean
}

const monthFormatter = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  year: "numeric",
})

function monthLabel(month: string): string {
  return monthFormatter.format(new Date(`${month}-01T00:00:00`))
}

function monthEnd(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number)
  const lastDay = new Date(Date.UTC(year, monthNumber, 0))
    .getUTCDate()
    .toString()
    .padStart(2, "0")
  return `${month}-${lastDay}`
}

function segmentKey(segment: SpendingBandSegment): string {
  return segment.category_id === null
    ? `uncategorized:${segment.name}`
    : `category:${segment.category_id}`
}

function SpendingBandTooltip({
  active,
  payload,
  incognito,
}: Partial<TooltipContentProps> & { incognito: boolean }) {
  if (!active || !payload?.length) return null
  const item = payload[0]
  if (typeof item.value !== "number") return null
  return (
    <DarkChartTooltipCard
      title={String(item.name ?? "")}
      value={
        <span className={incognito ? "kpi-hidden" : ""}>
          {formatCurrency(item.value)} €
        </span>
      }
      testId="spending-band-tooltip"
    />
  )
}

function SpendingBandsChart({
  months,
  incognito,
  returnTo,
  loading = false,
  unavailable = false,
}: SpendingBandsChartProps) {
  const animationActive = useChartAnimation()
  const maxTotal = Math.max(0, ...months.map((month) => month.total_cents))
  const segmentColors = useMemo(() => {
    const colors = new Map<string, string>()
    for (const month of months) {
      for (const segment of month.segments) {
        const key = segmentKey(segment)
        if (!colors.has(key)) {
          colors.set(key, palette[colors.size % palette.length])
        }
      }
    }
    return colors
  }, [months])
  const categories = useMemo(() => {
    const totals = new Map<
      string,
      { segment: SpendingBandSegment; amountCents: number }
    >()
    for (const month of months) {
      for (const segment of month.segments) {
        const key = segmentKey(segment)
        const existing = totals.get(key)
        totals.set(key, {
          segment,
          amountCents: (existing?.amountCents ?? 0) + segment.amount_cents,
        })
      }
    }
    return [...totals.values()].sort(
      (left, right) => right.amountCents - left.amountCents,
    )
  }, [months])
  const visibleCategories = categories.slice(0, 7)
  const displayedMonths = [...months].reverse()

  return (
    <FinancialPanel
      role="chart"
      data-testid="dashboard-spending-bands"
      className="flex min-h-0 flex-col"
    >
      <SectionHeading className="px-4 py-3.5 md:px-[1.125rem]">
        <h2 className="font-head text-base font-bold text-text md:text-lg">
          Where the money goes
        </h2>
      </SectionHeading>

      <div className="flex min-h-0 flex-1 flex-col px-4 py-3.5 md:px-[1.125rem]">
        {loading ? (
          <div className="flex flex-1 items-center rounded-lg bg-surface-hi/60 px-4 py-6 text-sm text-muted">
            Loading six-month spending history…
          </div>
        ) : unavailable ? (
          <div className="flex flex-1 items-center rounded-lg bg-surface-hi/60 px-4 py-6 text-sm text-muted">
            Six-month spending history is unavailable right now.
          </div>
        ) : maxTotal === 0 ? (
          <div className="flex flex-1 items-center rounded-lg bg-surface-hi/60 px-4 py-6 text-sm text-muted">
            No spending was recorded in the last six months.
          </div>
        ) : (
          <>
            <div
              className="grid min-h-0 flex-1 grid-rows-6 gap-1.5"
              aria-label="Six-month spending bands"
            >
              {displayedMonths.map((month) => {
                const search = new URLSearchParams({
                  period: "custom",
                  start: `${month.month}-01`,
                  end: monthEnd(month.month),
                  type: "expense",
                })
                const details = month.segments
                  .map(
                    (segment) =>
                      `${segment.name} ${formatCurrency(segment.amount_cents)} euros`,
                  )
                  .join(", ")
                const accessibleLabel = incognito
                  ? `View expense transactions for ${monthLabel(month.month)}`
                  : `View expense transactions for ${monthLabel(month.month)}. Total ${formatCurrency(month.total_cents)} euros${details ? `. ${details}` : ""}`

                const chartRow: Record<string, string | number> = {
                  month: month.month,
                }
                month.segments.forEach((segment) => {
                  chartRow[segmentKey(segment)] = segment.amount_cents
                })

                return (
                  <div
                    key={month.month}
                    className="grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2 py-0.5"
                  >
                    <Link
                      to={`/transactions?${search.toString()}`}
                      state={{ returnTo }}
                      data-testid="dashboard-spending-band-month"
                      aria-label={accessibleLabel}
                      className="flex min-h-11 min-w-0 flex-col justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring desk:min-h-0"
                    >
                      <span className="block text-xs font-semibold text-text">
                        {monthLabel(month.month).split(" ")[0]}
                      </span>
                      <span
                        className={`block truncate font-mono text-[10px] tabular-nums text-muted ${incognito ? "kpi-hidden" : ""}`}
                      >
                        {formatCurrency(month.total_cents, false)} €
                      </span>
                    </Link>
                    <span
                      className="relative block h-6 rounded-[6px] bg-faint/70"
                    >
                      <span
                        aria-hidden="true"
                        className="absolute inset-0"
                      >
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            layout="vertical"
                            data={[chartRow]}
                            margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                            accessibilityLayer={false}
                          >
                            <XAxis type="number" domain={[0, maxTotal]} hide />
                            <YAxis type="category" dataKey="month" hide />
                            {month.segments.map((segment, index) => {
                              const only = month.segments.length === 1
                              const first = index === 0
                              const last = index === month.segments.length - 1
                              return (
                                <Bar
                                  key={segmentKey(segment)}
                                  dataKey={segmentKey(segment)}
                                  name={segment.name}
                                  stackId="spending"
                                  fill={segmentColors.get(segmentKey(segment))}
                                  barSize={24}
                                  radius={
                                    only
                                      ? [6, 6, 6, 6]
                                      : first
                                        ? [6, 0, 0, 6]
                                        : last
                                          ? [0, 6, 6, 0]
                                          : [0, 0, 0, 0]
                                  }
                                  isAnimationActive={animationActive}
                                  animationDuration={CHART_BAR_ANIMATION_DURATION}
                                >
                                  <Cell className="spending-band-segment" />
                                </Bar>
                              )
                            })}
                            <Tooltip
                              shared={false}
                              cursor={false}
                              isAnimationActive={animationActive}
                              animationDuration={CHART_TOOLTIP_ANIMATION_DURATION}
                              allowEscapeViewBox={{ x: true, y: true }}
                              wrapperStyle={{ zIndex: 20 }}
                              content={
                                <SpendingBandTooltip incognito={incognito} />
                              }
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      </span>
                    </span>
                  </div>
                )
              })}
            </div>

            <div className="mt-2 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 text-[10px] text-muted">
              <span />
              <span className="flex justify-between font-mono tabular-nums">
                <span>0</span>
                <span>{formatCurrency(maxTotal / 2, false)} €</span>
                <span>{formatCurrency(maxTotal, false)} €</span>
              </span>
            </div>

            <div
              data-testid="dashboard-spending-band-legend"
              className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-3"
            >
              {visibleCategories.map(({ segment }) => (
                <span
                  key={segmentKey(segment)}
                  className="inline-flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-muted"
                >
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                    style={{ backgroundColor: segmentColors.get(segmentKey(segment)) }}
                  />
                  <span className="max-w-28 truncate">{segment.name}</span>
                </span>
              ))}
              {categories.length > visibleCategories.length ? (
                <span className="text-[11px] text-muted">
                  +{categories.length - visibleCategories.length} more
                </span>
              ) : null}
            </div>
          </>
        )}
      </div>

      {!loading && !unavailable ? (
        <div className="sr-only">
          <table>
            <caption>Expense totals by month and category</caption>
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Total</th>
                {categories.map(({ segment }) => (
                  <th key={segmentKey(segment)} scope="col">
                    {segment.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayedMonths.map((month) => (
                <tr key={month.month}>
                  <th scope="row">{monthLabel(month.month)}</th>
                  <td>
                    {incognito ? "Hidden" : `${formatCurrency(month.total_cents)} €`}
                  </td>
                  {categories.map(({ segment }) => {
                    const amount = month.segments.find(
                      (candidate) => segmentKey(candidate) === segmentKey(segment),
                    )?.amount_cents
                    return (
                      <td key={segmentKey(segment)}>
                        {incognito ? "Hidden" : `${formatCurrency(amount ?? 0)} €`}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </FinancialPanel>
  )
}

export default memo(SpendingBandsChart)
