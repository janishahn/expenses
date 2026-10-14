import { useId, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react"
import clsx from "clsx"
import { usePrivacy } from "../../app/privacy"
import type { ChartFocus } from "./ChartCard"
import { pointerAt, type PointerAt } from "./chart-pointer"
import s from "./kit.module.css"

// Chart bodies drawn inside a ChartCard. Marks under the pointer or a hovered legend
// entry keep full opacity; the others dim to 22 %.

const W = 600

function dimmed(focus: ChartFocus | undefined, key: string): boolean {
  return Boolean(focus?.key) && focus?.key !== key
}

// Round steps of about (hi − lo) / count; a smaller step when the round one leaves fewer than two ticks.
function niceTicks(lo: number, hi: number, count: number): number[] {
  const raw = (hi - lo) / count
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const steps = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).filter((value) => value <= raw * 2)
  const ticksFor = (step: number) => {
    const ticks: number[] = []
    for (let value = Math.ceil(lo / step) * step; value <= hi; value += step) ticks.push(value)
    return ticks
  }
  const preferred = steps.findIndex((value) => value >= raw)
  return (
    steps
      .slice(0, preferred < 0 ? steps.length : preferred + 1)
      .reverse()
      .map(ticksFor)
      .find((ticks) => ticks.length >= 2) ?? ticksFor(steps[0])
  )
}

// Splits a series at missing values so gaps stay gaps.
function runs(values: Array<number | null>): number[][] {
  const out: number[][] = []
  let run: number[] = []
  values.forEach((value, index) => {
    if (value === null) {
      if (run.length) out.push(run)
      run = []
    } else run.push(index)
  })
  if (run.length) out.push(run)
  return out
}

// The floating box beside the pointer.
export function PointerTip({ at, children }: { at: PointerAt; children: ReactNode }) {
  return (
    <div
      className={s.pointerTip}
      style={{
        left: at.x,
        top: at.y,
        transform: at.flip ? "translate(calc(-100% - 14px), 14px)" : "translate(14px, 14px)",
      }}
    >
      {children}
    </div>
  )
}

export type LineSeries = {
  key: string
  values: Array<number | null>
  // Defaults to ink, the actual values.
  color?: string
  dash?: boolean
  width?: number
}

// A shaded area between two value lists, such as the forecast's 80 % range. `clip` keeps only the
// part above or below the lo line, such as where income is above or below expenses.
export type LineBand = { key: string; lo: Array<number | null>; hi: Array<number | null>; fill?: string; clip?: "above" | "below" }

export function LineChart({
  labels,
  series,
  bands = [],
  height = 190,
  zero = false,
  mark,
  partial,
  idle,
  yAxis = false,
  formatY,
  xEvery = 1,
  focus,
  tooltip,
}: {
  labels: string[]
  series: LineSeries[]
  bands?: LineBand[]
  height?: number
  // Keeps zero in range and draws the zero line when values cross it.
  zero?: boolean
  // Today: a dotted vertical mark at this index.
  mark?: number
  // The first index with incomplete values, such as the month in progress: lines dash into it
  // and bands stop before it.
  partial?: number
  // The index whose points show while the pointer is elsewhere.
  idle?: number
  // Full-page analysis charts label the y-axis; dashboard and peek charts do not.
  yAxis?: boolean
  formatY?: (value: number) => string
  // Labels every nth point, counted from the mark.
  xEvery?: number
  focus?: ChartFocus
  tooltip: (index: number) => ReactNode
}) {
  const hidden = usePrivacy()
  const root = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ index: number; at: PointerAt } | null>(null)
  const clipId = useId()
  const H = height
  const n = labels.length
  const values = [...series.flatMap((entry) => entry.values), ...bands.flatMap((band) => [...band.lo, ...band.hi])].filter(
    (value): value is number => value !== null
  )
  if (!n || !values.length) return null
  let lo = Math.min(...values)
  let hi = Math.max(...values)
  if (zero) {
    lo = Math.min(lo, 0)
    hi = Math.max(hi, 0)
  }
  const pad = (hi - lo) * 0.08 || Math.max(Math.abs(hi) * 0.08, 1)
  lo -= pad
  hi += pad
  const x = (index: number) => (n > 1 ? 8 + (index / (n - 1)) * (W - 16) : W / 2)
  const y = (value: number) => 6 + (1 - (value - lo) / (hi - lo)) * (H - 12)
  const ticks = niceTicks(lo, hi, 3)
  const cut = partial ?? n

  const track = (event: PointerEvent<HTMLDivElement>) => {
    if (!root.current) return
    const box = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientX - box.left) / box.width
    const index = n > 1 ? Math.round(((ratio * W - 8) / (W - 16)) * (n - 1)) : 0
    setHover({ index: Math.max(0, Math.min(n - 1, index)), at: pointerAt(event, root.current) })
  }
  const active = hover?.index ?? idle
  // Thinned labels step from today's mark; the last point keeps one unless another sits close before it.
  const labelled = (index: number) => {
    const offset = (((index - (mark ?? 0)) % xEvery) + xEvery) % xEvery
    return offset === 0 || (index === n - 1 && offset >= xEvery / 2)
  }

  return (
    <div ref={root} className={clsx(s.chartWrap, yAxis && s.chartWrapY)}>
      {yAxis ? (
        <div className={s.yax} style={{ height: H }} aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} className={s.ylab} style={{ top: `${(y(tick) / H) * 100}%` }}>
              {hidden ? "••••" : formatY ? formatY(tick) : tick}
            </span>
          ))}
        </div>
      ) : null}
      <div className={s.plot} onPointerMove={track} onPointerDown={track} onPointerLeave={() => setHover(null)}>
        <svg className={s.chart} style={{ height: H }} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          {ticks.map((tick) => (
            <line key={tick} x1={0} x2={W} y1={y(tick)} y2={y(tick)} stroke="var(--grid)" vectorEffect="non-scaling-stroke" />
          ))}
          {zero && lo < 0 ? (
            <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--ink-3)" vectorEffect="non-scaling-stroke" />
          ) : null}
          {bands.map((band) =>
            runs(band.lo.map((value, index) => (value === null || band.hi[index] === null || index >= cut ? null : value))).map((run) => {
              const lo = run.map((index) => `${x(index)},${y(band.lo[index] as number)}`)
              const clip = `${clipId}${band.key}${run[0]}`
              const edge = band.clip === "above" ? 0 : H
              return (
                <g key={`${band.key}-${run[0]}`}>
                  {band.clip ? (
                    <clipPath id={clip}>
                      <polygon points={`${x(run[0])},${edge} ${lo.join(" ")} ${x(run[run.length - 1])},${edge}`} />
                    </clipPath>
                  ) : null}
                  <polygon
                    fill={band.fill ?? "var(--band)"}
                    clipPath={band.clip && `url(#${clip})`}
                    opacity={dimmed(focus, band.key) ? 0.22 : 1}
                    points={[...run.map((index) => `${x(index)},${y(band.hi[index] as number)}`), ...[...lo].reverse()].join(" ")}
                  />
                </g>
              )
            })
          )}
          {mark !== undefined ? (
            <line
              x1={x(mark)}
              x2={x(mark)}
              y1={0}
              y2={H}
              stroke="var(--ink-3)"
              strokeDasharray="2 3"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {series.map((entry) =>
            runs(entry.values)
              .flatMap((run) => [
                { run: run.filter((index) => index < cut), dash: entry.dash },
                { run: run.filter((index) => index >= cut - 1), dash: true },
              ])
              .filter(({ run }) => run.length > 1)
              .map(({ run, dash }) => (
                <polyline
                  key={`${entry.key}-${run[0]}`}
                  fill="none"
                  stroke={entry.color ?? "var(--ink)"}
                  strokeWidth={entry.width ?? 1.75}
                  strokeDasharray={dash ? "4 4" : undefined}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  opacity={dimmed(focus, entry.key) ? 0.22 : 1}
                  points={run.map((index) => `${x(index)},${y(entry.values[index] as number)}`).join(" ")}
                />
              ))
          )}
          {hover ? (
            <line
              x1={x(hover.index)}
              x2={x(hover.index)}
              y1={0}
              y2={H}
              stroke="var(--ink-3)"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </svg>
        {active !== undefined
          ? series.map((entry) => {
              const value = entry.values[active]
              return value === null || value === undefined ? null : (
                <span
                  key={entry.key}
                  className={s.dot}
                  style={{
                    left: `${(x(active) / W) * 100}%`,
                    top: `${(y(value) / H) * 100}%`,
                    background: entry.color ?? "var(--ink)",
                  }}
                />
              )
            })
          : null}
      </div>
      <div className={s.xlab} aria-hidden="true">
        {labels.map((label, index) =>
          labelled(index) ? (
            <span
              key={index}
              style={
                index === 0
                  ? { left: 0 }
                  : index === n - 1
                    ? { right: 0 }
                    : { left: `${(x(index) / W) * 100}%`, transform: "translateX(-50%)" }
              }
            >
              {label}
            </span>
          ) : null
        )}
      </div>
      {hover ? <PointerTip at={hover.at}>{tooltip(hover.index)}</PointerTip> : null}
    </div>
  )
}

export type BandSegment = { key: string; value: number; color: string }
export type StackedRow = { key: string; label: ReactNode; total: ReactNode; segments: BandSegment[] }

// One horizontal band per period, its segments scaled against the largest period.
export function StackedBands({
  rows,
  max,
  focus,
  tooltip,
  onSelect,
}: {
  rows: StackedRow[]
  max: number
  focus: ChartFocus
  tooltip: (row: StackedRow, segment: BandSegment) => ReactNode
  onSelect?: (row: StackedRow, segment: BandSegment) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ row: StackedRow; segment: BandSegment; at: PointerAt } | null>(null)
  return (
    <div
      ref={root}
      className={s.bands}
      onPointerLeave={() => {
        setHover(null)
        focus.set(null)
      }}
    >
      {rows.map((row) => (
        <div key={row.key} className={s.bandRow}>
          <span className={s.bandLabel}>{row.label}</span>
          <div className={s.track} aria-hidden="true">
            {row.segments.map((segment) => (
              <span
                key={segment.key}
                data-dim={dimmed(focus, segment.key) ? "" : undefined}
                style={{ width: `${(segment.value / max) * 100}%`, background: segment.color }}
                onPointerMove={(event) => {
                  if (!root.current) return
                  focus.set(segment.key)
                  setHover({ row, segment, at: pointerAt(event, root.current) })
                }}
                onClick={onSelect ? () => onSelect(row, segment) : undefined}
              />
            ))}
          </div>
          <span className={s.bandTotal}>{row.total}</span>
        </div>
      ))}
      {hover ? <PointerTip at={hover.at}>{tooltip(hover.row, hover.segment)}</PointerTip> : null}
    </div>
  )
}

export type DonutItem = { key: string; label: ReactNode; value: number; color: string; amount: ReactNode; share: string }

// A ring of shares with the total in the center, beside a list of amounts and percentages.
export function Donut({
  items,
  center,
  centerLabel,
  compact = false,
  focus,
  tooltip,
  onSelect,
}: {
  items: DonutItem[]
  center: ReactNode
  centerLabel?: ReactNode
  // A small ring beside the five largest shares, for phones; the card's table lists them all.
  compact?: boolean
  focus: ChartFocus
  tooltip: (item: DonutItem) => ReactNode
  onSelect?: (item: DonutItem) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ item: DonutItem; at: PointerAt } | null>(null)
  const total = items.reduce((sum, item) => sum + item.value, 0)
  const R = 70
  const L = 2 * Math.PI * R
  const lengths = items.map((item) => (total ? (item.value / total) * L : 0))
  const offsets = lengths.map((_, index) => lengths.slice(0, index).reduce((sum, length) => sum + length, 0))
  const leave = () => {
    setHover(null)
    focus.set(null)
  }
  return (
    <div ref={root} className={clsx(s.donutWrap, compact && s.donutCompact)}>
      <div className={s.donut} onPointerLeave={leave}>
        <svg width="180" height="180" viewBox="0 0 180 180" aria-hidden="true">
          {items.map((item, index) => (
              <circle
                key={item.key}
                r={R}
                cx={90}
                cy={90}
                fill="none"
                stroke={item.color}
                strokeWidth={22}
                strokeDasharray={`${Math.max(lengths[index] - 1.5, 0)} ${L}`}
                strokeDashoffset={-offsets[index]}
                data-dim={dimmed(focus, item.key) ? "" : undefined}
                onPointerMove={(event) => {
                  if (!root.current) return
                  focus.set(item.key)
                  setHover({ item, at: pointerAt(event, root.current) })
                }}
                onClick={onSelect ? () => onSelect(item) : undefined}
              />
          ))}
        </svg>
        <div className={s.donutCenter}>
          <div className={s.donutValue}>{center}</div>
          {centerLabel != null ? <div className={s.donutLabel}>{centerLabel}</div> : null}
        </div>
      </div>
      {compact ? (
        <div className={s.dlCompactWrap}>
          <ShareList items={items.slice(0, 5)} focus={focus} onLeave={leave} />
          {items.length > 5 ? <div className={s.dlMore}>{items.length - 5} more</div> : null}
        </div>
      ) : (
        <ShareList items={items} focus={focus} onLeave={leave} />
      )}
      {hover ? <PointerTip at={hover.at}>{tooltip(hover.item)}</PointerTip> : null}
    </div>
  )
}

// Each share's name, amount, and percentage; hovering one dims the others in the chart.
function ShareList({ items, focus, onLeave }: { items: DonutItem[]; focus: ChartFocus; onLeave: () => void }) {
  return (
    <div className={s.dl} role="list" onPointerLeave={onLeave}>
      {items.map((item) => {
        const dim = dimmed(focus, item.key) ? "" : undefined
        return (
          <div key={item.key} role="listitem" className={s.dlRow} onPointerEnter={() => focus.set(item.key)}>
            <span className={s.dlName} data-dim={dim}>
              <span aria-hidden="true" className={s.swatch} style={{ background: item.color }} />
              <span className={s.dlLabel}>{item.label}</span>
            </span>
            <span className={s.dlAmount} data-dim={dim}>
              {item.amount}
            </span>
            <span className={s.dlShare} data-dim={dim}>
              {item.share}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// One bar split into shares, such as a week's spending by category, above the list of amounts.
export function ShareBar({
  items,
  focus,
  tooltip,
  onSelect,
}: {
  items: DonutItem[]
  focus: ChartFocus
  tooltip: (item: DonutItem) => ReactNode
  onSelect?: (item: DonutItem) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ item: DonutItem; at: PointerAt } | null>(null)
  const total = items.reduce((sum, item) => sum + item.value, 0)
  const leave = () => {
    setHover(null)
    focus.set(null)
  }
  return (
    <div ref={root} className={s.shareBar}>
      <div className={clsx(s.track, s.trackTall)} aria-hidden="true" onPointerLeave={leave}>
        {items.map((item) => (
          <span
            key={item.key}
            data-dim={dimmed(focus, item.key) ? "" : undefined}
            style={{ width: `${total ? (item.value / total) * 100 : 0}%`, background: item.color }}
            onPointerMove={(event) => {
              if (!root.current) return
              focus.set(item.key)
              setHover({ item, at: pointerAt(event, root.current) })
            }}
            onClick={onSelect ? () => onSelect(item) : undefined}
          />
        ))}
      </div>
      <ShareList items={items} focus={focus} onLeave={leave} />
      {hover ? <PointerTip at={hover.at}>{tooltip(hover.item)}</PointerTip> : null}
    </div>
  )
}

// Spent against a limit: a neutral fill, the over tone past the limit, and an ink tick at today's even pace.
export function BudgetBar({ ratio, over = false, pace }: { ratio: number; over?: boolean; pace?: number | null }) {
  return (
    <span className={s.bt} aria-hidden="true">
      <span className={clsx(s.bf, over && s.bfOver)} style={{ width: `${Math.min(Math.max(ratio, 0), 1) * 100}%` }} />
      {pace != null ? <span className={s.pace} style={{ left: `${Math.min(Math.max(pace, 0), 1) * 100}%` }} /> : null}
    </span>
  )
}

// Cards side by side on desktop, stacked on mobile. Wide gives the first card 1.5 shares.
export function CardRow({ wide = false, children }: { wide?: boolean; children: ReactNode }) {
  return <div className={clsx(s.cardRow, wide && s.cardRowWide)}>{children}</div>
}

// Cards stacked in one column of a CardRow, such as a record's settings above its chart.
export function CardStack({ children }: { children: ReactNode }) {
  return <div className={s.cardStack}>{children}</div>
}

export type ColumnSeries = { key: string; values: number[]; color: string }

// Stacked columns per period on a y-axis, such as recurring and other spending by month.
// Series stack top to bottom in the given order.
export function ColumnChart({
  labels,
  shortLabels,
  series,
  height = 150,
  formatY,
  focus,
  tooltip,
}: {
  labels: string[]
  // One-letter labels for mobile widths.
  shortLabels?: string[]
  series: ColumnSeries[]
  height?: number
  formatY?: (value: number) => string
  focus?: ChartFocus
  tooltip: (index: number) => ReactNode
}) {
  const hidden = usePrivacy()
  const root = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ index: number; at: PointerAt } | null>(null)
  const totals = labels.map((_, index) => series.reduce((sum, entry) => sum + entry.values[index], 0))
  const top = Math.max(...totals, 0) * 1.06 || 1
  const ticks = niceTicks(0, top, 4)
  const columns = { "--n": labels.length } as CSSProperties
  return (
    <div ref={root} className={clsx(s.chartWrap, s.chartWrapY)} onPointerLeave={() => setHover(null)}>
      <div className={s.yax} style={{ height }} aria-hidden="true">
        {ticks.map((tick) => (
          <span key={tick} className={s.ylab} style={{ top: `${(1 - tick / top) * 100}%` }}>
            {hidden ? "••••" : formatY ? formatY(tick) : tick}
          </span>
        ))}
      </div>
      <div className={s.plot} style={{ height }} aria-hidden="true">
        {ticks.map((tick) => (
          <i key={tick} className={s.gridline} style={{ bottom: `${(tick / top) * 100}%` }} />
        ))}
        <div className={s.cols} style={columns}>
          {labels.map((_, index) => (
            <div
              key={index}
              onPointerMove={(event) => {
                if (root.current) setHover({ index, at: pointerAt(event, root.current) })
              }}
            >
              {series.map((entry) => (
                <span
                  key={entry.key}
                  data-dim={dimmed(focus, entry.key) ? "" : undefined}
                  style={{ height: `${(entry.values[index] / top) * 100}%`, background: entry.color }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className={s.colLabels} style={columns} aria-hidden="true">
        {labels.map((label, index) => (
          <span key={index} data-short={shortLabels?.[index]}>
            {label}
          </span>
        ))}
      </div>
      {hover ? <PointerTip at={hover.at}>{tooltip(hover.index)}</PointerTip> : null}
    </div>
  )
}

// Averages per weekday, Monday first; `marked` days (the weekend) use the second tone.
export function WeekdayBars({
  values,
  labels,
  marked,
  heading,
  summary,
  tooltip,
}: {
  values: number[]
  labels: string[]
  marked: number[]
  heading: ReactNode
  summary: ReactNode
  tooltip: (index: number) => ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ index: number; at: PointerAt } | null>(null)
  const max = Math.max(...values, 0) || 1
  return (
    <div ref={root} className={s.chartWrap} onPointerLeave={() => setHover(null)}>
      <div className={s.wkdHead}>
        <span className={s.muted}>{heading}</span>
        <span className={s.sp} />
        <span>{summary}</span>
      </div>
      <div className={s.wkd} aria-hidden="true">
        {values.map((value, index) => (
          <div
            key={labels[index] + index}
            onPointerMove={(event) => {
              if (root.current) setHover({ index, at: pointerAt(event, root.current) })
            }}
          >
            <span className={clsx(marked.includes(index) && s.wkdMarked)} style={{ height: `${(value / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className={s.wkdLabels} aria-hidden="true">
        {labels.map((label, index) => (
          <span key={label + index}>{label}</span>
        ))}
      </div>
      {hover ? <PointerTip at={hover.at}>{tooltip(hover.index)}</PointerTip> : null}
    </div>
  )
}

// A wide chart with a narrow companion beside it on desktop, below it on mobile.
export function ChartWithAside({ chart, aside }: { chart: ReactNode; aside: ReactNode }) {
  return (
    <div className={s.chartAside}>
      <div>{chart}</div>
      {aside}
    </div>
  )
}
