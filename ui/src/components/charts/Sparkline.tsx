import { memo } from "react"

type SparklineProps = {
  points?: string
  className?: string
}

function valuesToPolyline(raw: string): string {
  const values = raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value))
  if (!values.length) {
    return ""
  }
  const series = values.length === 1 ? [values[0], values[0]] : values
  const min = Math.min(...series)
  const max = Math.max(...series)
  const width = 100
  const height = 30
  const usableHeight = 26
  const step = width / (series.length - 1)
  return series
    .map((value, index) => {
      const x = index * step
      const y =
        max === min ? height / 2 : 2 + (1 - (value - min) / (max - min)) * usableHeight
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(" ")
}

function Sparkline({ points, className }: SparklineProps) {
  if (!points) {
    return <div className="h-8 w-20 rounded-full border border-border/80 bg-surface-hi/70" />
  }
  const polylinePoints = points.includes(" ") ? points : valuesToPolyline(points)

  return (
    <svg
      className={className ?? "h-8 w-20"}
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
    >
      <polyline
        points={polylinePoints}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

export default memo(Sparkline)
