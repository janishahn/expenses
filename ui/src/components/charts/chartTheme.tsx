/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState, type ReactNode } from "react"

export const CHART_ANIMATION_DURATION = 1275
export const CHART_BAR_ANIMATION_DURATION = 340
export const CHART_TOOLTIP_ANIMATION_DURATION = 340
export const CHART_GRID_COLOR = "rgb(var(--border) / 0.62)"

export const CHART_TICK_STYLE = {
  fill: "rgb(var(--muted))",
  fontFamily: "IBM Plex Mono",
  fontSize: 11,
  fontWeight: 500,
}

export const CHART_MONO_TICK_STYLE = CHART_TICK_STYLE

export type ChartTooltipRow = {
  label: string
  value: ReactNode
  color?: string
}

export function useChartAnimation(): boolean {
  const [active, setActive] = useState(
    () =>
      typeof window !== "undefined" &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  )

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setActive(!media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])

  return active
}

export function withAlpha(color: string, alpha: number): string {
  const normalized = color.trim()
  if (/^rgb\(/i.test(normalized) && normalized.endsWith(")")) {
    return `rgb(${normalized.slice(normalized.indexOf("(") + 1, -1).trim()} / ${alpha})`
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

export function LightChartTooltipCard({
  title,
  rows,
  footer,
}: {
  title?: ReactNode
  rows: ChartTooltipRow[]
  footer?: ReactNode
}) {
  return (
    <div
      role="tooltip"
      className="chart-tooltip-light"
    >
      {title ? <strong className="chart-tooltip-label">{title}</strong> : null}
      <span className="chart-tooltip-items">
        {rows.map((row) => (
          <span key={row.label} className="chart-tooltip-item">
            <i
              className="chart-tooltip-marker"
              style={{ backgroundColor: row.color ?? "transparent" }}
              aria-hidden="true"
            />
            <span className="chart-tooltip-name">{row.label}</span>
            <span className="chart-tooltip-value">{row.value}</span>
          </span>
        ))}
      </span>
      {footer ? (
        <span className="chart-tooltip-footer">
          {footer}
        </span>
      ) : null}
    </div>
  )
}

export function DarkChartTooltipCard({
  title,
  value,
  detail,
  testId,
}: {
  title?: ReactNode
  value: ReactNode
  detail?: ReactNode
  testId?: string
}) {
  return (
    <div
      role="tooltip"
      data-testid={testId}
      className="chart-tooltip-dark"
    >
      {title ? <span>{title}</span> : null}
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  )
}
