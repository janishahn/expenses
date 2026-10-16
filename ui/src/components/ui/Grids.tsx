import { useCallback, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react"
import clsx from "clsx"
import { pointerAt, type PointerAt } from "./chart-pointer"
import { PointerTip } from "./Charts"
import s from "./kit.module.css"

// Month-by-row grids and the day calendar, drawn inside a ChartCard whose table holds
// the exact values. Cells under the pointer show a tooltip; selectable cells open
// the records behind them.

type Hover<T> = { item: T; at: PointerAt } | null

// `track` stays the same function, so a grid can keep its cells while only the
// tooltip follows the pointer.
function useHover<T>() {
  const root = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<Hover<T>>(null)
  const track = useCallback(
    (item: T) => (event: PointerEvent<HTMLElement>) => {
      if (root.current) setHover({ item, at: pointerAt(event, root.current) })
    },
    []
  )
  return { root, hover, track, clear: () => setHover(null) }
}

function MonthHeads({ months, shortMonths }: { months: string[]; shortMonths?: string[] }) {
  return (
    <>
      {months.map((month, index) => (
        <span key={index} className={s.hmHead} data-short={shortMonths?.[index]}>
          {month}
        </span>
      ))}
    </>
  )
}

export type MonthGridRow = {
  key: string
  label: ReactNode
  values: number[]
  color: string
  total: ReactNode
  // The latest full month against the row's average, or a dash for irregular rows.
  change?: ReactNode
}

// One row per category or tag, one cell per month, shaded from the row's lowest to its
// highest month. The last month is in progress: outlined and left out of the scale.
export function MonthGrid({
  months,
  shortMonths,
  rows,
  totalLabel,
  changeLabel,
  tooltip,
  onSelect,
}: {
  months: string[]
  shortMonths?: string[]
  rows: MonthGridRow[]
  totalLabel: string
  changeLabel?: string
  tooltip: (row: MonthGridRow, index: number) => ReactNode
  onSelect?: (row: MonthGridRow, index: number) => void
}) {
  const { root, hover, track, clear } = useHover<{ row: MonthGridRow; index: number }>()
  const cells = useMemo(() => {
    const last = months.length - 1
    return (
      <div
        className={clsx(s.hm, changeLabel && s.hmChanges)}
        style={{ "--n": months.length } as CSSProperties}
        aria-hidden="true"
      >
        <span />
        <MonthHeads months={months} shortMonths={shortMonths} />
        <span className={clsx(s.hmHead, s.hmRight)}>{totalLabel}</span>
        {changeLabel ? <span className={clsx(s.hmHead, s.hmRight, s.hmChange)}>{changeLabel}</span> : null}
        {rows.map((row) => {
          const full = row.values.slice(0, last)
          const lo = Math.min(...full)
          const hi = Math.max(...full)
          const shade = (value: number) =>
            hi > lo ? Math.round(10 + 65 * Math.min(1, Math.max(0, (value - lo) / (hi - lo)))) : 16
          return (
            <div key={row.key} className={s.hmRow}>
              <span className={s.hmName}>{row.label}</span>
              {row.values.map((value, index) => (
                <span
                  key={index}
                  className={clsx(s.hmCell, !value && s.hmZero, index === last && s.hmNow)}
                  style={value ? { background: `color-mix(in srgb, ${row.color} ${shade(value)}%, var(--sheet))` } : undefined}
                  data-clickable={onSelect ? "" : undefined}
                  onPointerMove={track({ row, index })}
                  onClick={onSelect ? () => onSelect(row, index) : undefined}
                />
              ))}
              <span className={s.hmTotal}>{row.total}</span>
              {changeLabel ? <span className={clsx(s.hmTotal, s.hmChange, s.muted)}>{row.change}</span> : null}
            </div>
          )
        })}
      </div>
    )
  }, [months, shortMonths, rows, totalLabel, changeLabel, onSelect, track])
  return (
    <div ref={root} className={s.chartWrap} onPointerLeave={clear}>
      {cells}
      <div className={s.scale} aria-hidden="true">
        <span>Lowest</span>
        {[10, 26, 42, 58, 75].map((share) => (
          <i key={share} style={{ background: `color-mix(in srgb, var(--ink-2) ${share}%, var(--sheet))` }} />
        ))}
        <span>Highest month in each row</span>
        <i className={s.hmNow} />
        <span>In progress</span>
      </div>
      {hover ? <PointerTip at={hover.at}>{tooltip(hover.item.row, hover.item.index)}</PointerTip> : null}
    </div>
  )
}

export type BudgetGridCell = { state: "within" | "over" | "none"; current: boolean }
export type BudgetGridRow = { key: string; label: ReactNode; cells: BudgetGridCell[]; total: ReactNode }

// One row per budget, one mark per month: within, over, or no budget yet.
export function BudgetGrid({
  months,
  shortMonths,
  rows,
  totalLabel,
  tooltip,
  onSelect,
}: {
  months: string[]
  shortMonths?: string[]
  rows: BudgetGridRow[]
  totalLabel: string
  tooltip: (row: BudgetGridRow, index: number) => ReactNode
  onSelect?: (row: BudgetGridRow, index: number) => void
}) {
  const { root, hover, track, clear } = useHover<{ row: BudgetGridRow; index: number }>()
  const cells = useMemo(
    () => (
      <div className={clsx(s.hm, s.hmBudget)} style={{ "--n": months.length } as CSSProperties} aria-hidden="true">
        <span />
        <MonthHeads months={months} shortMonths={shortMonths} />
        <span className={clsx(s.hmHead, s.hmRight)}>{totalLabel}</span>
        {rows.map((row) => (
          <div key={row.key} className={s.hmRow}>
            <span className={s.hmName}>{row.label}</span>
            {row.cells.map((cell, index) => (
              <span
                key={index}
                className={clsx(s.bc, cell.state === "over" && s.bcOver, cell.state === "none" && s.bcNone, cell.current && s.hmNow)}
                data-clickable={onSelect && cell.state !== "none" ? "" : undefined}
                onPointerMove={track({ row, index })}
                onClick={onSelect && cell.state !== "none" ? () => onSelect(row, index) : undefined}
              />
            ))}
            <span className={s.hmTotal}>{row.total}</span>
          </div>
        ))}
      </div>
    ),
    [months, shortMonths, rows, totalLabel, onSelect, track]
  )
  return (
    <div ref={root} className={s.chartWrap} onPointerLeave={clear}>
      {cells}
      <div className={s.scale} aria-hidden="true">
        <i className={s.bc} />
        <span>Within</span>
        <i className={clsx(s.bc, s.bcOver)} />
        <span>Over</span>
        <i className={clsx(s.bc, s.hmNow)} />
        <span>In progress</span>
        <i className={clsx(s.bc, s.bcNone)} />
        <span>No budget</span>
      </div>
      {hover ? <PointerTip at={hover.at}>{tooltip(hover.item.row, hover.item.index)}</PointerTip> : null}
    </div>
  )
}

export type CalendarLevel = 0 | 1 | 2 | 3 | 4

const WEEKDAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", ""]
const LEVEL_CLASS = [s.calL0, s.calL1, s.calL2, s.calL3, s.calL4]

// Each week fills in after the one before it, top to bottom.
function entranceDelay(index: number): CSSProperties {
  const week = Math.floor(index / 7)
  const day = index % 7
  return { "--d": `${250 + week * 65 + day * 22}ms`, "--t": `${2.6 + week * 0.37}s` } as CSSProperties
}

// Days in week columns, Monday first, each in one of five ink levels; null days lie ahead.
// Narrow screens scroll the weeks and start at the latest one.
export function DayCalendar({
  days,
  months,
  scale,
  legend,
  today,
  entrance = false,
  twinkle,
  tooltip,
  onSelect,
}: {
  // Column by column: seven days per week.
  days: Array<CalendarLevel | null>
  // Month names over the week where each month starts.
  months?: Array<{ week: number; label: string }>
  // Names of the five levels, shown as the legend.
  scale?: string[]
  // The two ends of a legend without level names, such as "Less" and "More".
  legend?: [string, string]
  // The outlined day.
  today?: number
  // The 404 page only: shaded days fill in week by week once; `twinkle` days then fade in and out.
  entrance?: boolean
  twinkle?: number[]
  tooltip?: (index: number) => ReactNode
  onSelect?: (index: number) => void
}) {
  const { root, hover, track, clear } = useHover<number>()
  const hasTooltip = Boolean(tooltip)
  const cells = useMemo(() => {
    const weeks = { "--weeks": Math.ceil(days.length / 7) } as CSSProperties
    return (
      <div className={s.calWrap} aria-hidden="true">
        <div className={s.calDays}>
          <span />
          {WEEKDAY_LABELS.map((label, index) => (
            <span key={index}>{label}</span>
          ))}
        </div>
        <div className={s.calScroll}>
          <div className={s.calIn} style={weeks}>
            <div className={s.calMonths}>
              {months?.map((month) => (
                <span key={`${month.week}-${month.label}`} style={{ gridColumn: `${month.week + 1} / span 4` }}>
                  {month.label}
                </span>
              ))}
            </div>
            <div className={s.cal}>
              {days.map((level, index) =>
                level === null ? (
                  <i key={index} className={s.calCell} />
                ) : (
                  <i
                    key={index}
                    className={clsx(
                      s.calCell,
                      LEVEL_CLASS[level],
                      entrance && level > 0 && s.calEnter,
                      twinkle?.includes(index) && s.calTwinkle,
                      today === index && s.calToday
                    )}
                    style={entrance && level > 0 ? entranceDelay(index) : undefined}
                    data-clickable={onSelect ? "" : undefined}
                    onPointerMove={hasTooltip ? track(index) : undefined}
                    onClick={onSelect ? () => onSelect(index) : undefined}
                  />
                )
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }, [days, months, today, entrance, twinkle, hasTooltip, onSelect, track])
  return (
    <div ref={root} className={s.chartWrap} onPointerLeave={clear}>
      {cells}
      {legend ? (
        <div className={s.calLegend} aria-hidden="true">
          {legend[0]}
          {LEVEL_CLASS.map((levelClass) => (
            <i key={levelClass} className={levelClass} />
          ))}
          {legend[1]}
        </div>
      ) : null}
      {scale ? (
        <div className={s.scale} aria-hidden="true">
          {scale.map((label, index) => (
            <span key={label} className={s.scaleItem}>
              <i className={LEVEL_CLASS[index]} />
              {label}
            </span>
          ))}
        </div>
      ) : null}
      {hover && tooltip ? <PointerTip at={hover.at}>{tooltip(hover.item)}</PointerTip> : null}
    </div>
  )
}
