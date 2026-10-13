import { useId, useState, type ReactNode } from "react"
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree"
import clsx from "clsx"
import { IconButton } from "./Button"
import { EmptyState } from "./EmptyState"
import { Menu, MenuItem } from "./Menu"
import s from "./kit.module.css"
import { Link } from "react-router-dom"

export type LegendEntry = {
  key: string
  label: ReactNode
  color: string
  // How the series is drawn: a filled mark, a solid or dashed line, or a shaded area.
  mark?: "box" | "line" | "dash" | "area"
}

// The series or category under the pointer. Charts dim every other mark to 22 %.
export type ChartFocus = { key: string | null; set: (key: string | null) => void }

const markClass = { box: undefined, line: s.swatchLine, dash: s.swatchDash, area: s.swatchArea }

export function Swatch({ color, mark = "box" }: { color: string; mark?: LegendEntry["mark"] }) {
  return (
    <span
      aria-hidden="true"
      className={clsx(s.swatch, markClass[mark])}
      style={mark === "dash" ? { color } : { background: color }}
    />
  )
}

// Every chart: a header (title, meta, range control, ⋯), the chart, then its legend.
// "Show as table" swaps the chart for its table, the nonvisual equivalent.
export function ChartCard({
  title,
  meta,
  controls,
  menu,
  table,
  legend,
  empty,
  children,
}: {
  title: ReactNode
  // The headline figure after the title, such as "likely 31.690 € in Apr".
  meta?: ReactNode
  // The range segmented control.
  controls?: ReactNode
  // Items after "Show as table": Open in Insights, Hide from dashboard, chart toggles.
  menu?: ReactNode
  table: ReactNode
  legend?: LegendEntry[]
  // One line shown instead of the chart when there is nothing to plot.
  empty?: ReactNode
  children: (focus: ChartFocus) => ReactNode
}) {
  const titleId = useId()
  const [asTable, setAsTable] = useState(false)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const focus = { key: focusKey, set: setFocusKey }
  return (
    <section className={s.card} aria-labelledby={titleId}>
      <div className={s.ch}>
        <h2 id={titleId}>{title}</h2>
        {meta != null ? <span className={s.meta}>{meta}</span> : null}
        <span className={s.sp} />
        {controls}
        <Menu label="Chart options" trigger={<IconButton icon={DotsThreeIcon} label="Chart options" />}>
          <MenuItem checked={asTable} onSelect={() => setAsTable(!asTable)}>
            Show as table
          </MenuItem>
          {menu}
        </Menu>
      </div>
      <div className={s.cbody}>
        {empty != null ? (
          <EmptyState inline>{empty}</EmptyState>
        ) : asTable ? (
          <div className={s.tableScroll}>{table}</div>
        ) : (
          <>
            <div className={s.chartBody}>{children(focus)}</div>
            {legend?.length ? (
              <div className={s.legend}>
                {legend.map((entry) => (
                  <span
                    key={entry.key}
                    className={s.legendItem}
                    data-dim={focusKey !== null && focusKey !== entry.key ? "" : undefined}
                    onPointerEnter={() => setFocusKey(entry.key)}
                    onPointerLeave={() => setFocusKey(null)}
                  >
                    <Swatch color={entry.color} mark={entry.mark} />
                    {entry.label}
                  </span>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  )
}

// The exact values behind a chart. The first column names the row; the rest are right-aligned.
// A table value that opens the records behind it: the keyboard path to a chart's drill-down.
export function TableLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className={s.tableLink}>
      {children}
    </Link>
  )
}

export function ChartTable({
  label,
  columns,
  rows,
}: {
  label: string
  columns: string[]
  rows: Array<{ key: string; cells: ReactNode[] }>
}) {
  return (
    <table className={s.dataTable} aria-label={label}>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            {row.cells.map((cell, index) =>
              index === 0 ? (
                <th key={index} scope="row">
                  {cell}
                </th>
              ) : (
                <td key={index}>{cell}</td>
              )
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// The floating box with a chart's exact values. Chart internals pass it as the
// Recharts tooltip content, with position animation off.
export function ChartTooltip({
  title,
  rows,
}: {
  title?: ReactNode
  rows: Array<{ key: string; label: ReactNode; value: ReactNode; color?: string; mark?: LegendEntry["mark"] }>
}) {
  return (
    <div className={clsx(s.floatLayer, s.tip, s.chartTip)}>
      {title != null ? <div className={s.chartTipTitle}>{title}</div> : null}
      {rows.map((row) => (
        <div key={row.key} className={s.chartTipRow}>
          {row.color ? <Swatch color={row.color} mark={row.mark} /> : null}
          <span>{row.label}</span>
          <b>{row.value}</b>
        </div>
      ))}
    </div>
  )
}
