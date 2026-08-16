import { memo, useMemo } from "react"
import {
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts"
import {
  CHART_ANIMATION_DURATION,
  useChartAnimation,
} from "./chartTheme"

type SparklineProps = {
  points?: string
  className?: string
}

function Sparkline({ points, className }: SparklineProps) {
  const animationActive = useChartAnimation()
  const data = useMemo(() => {
    const raw = (points ?? "").trim()
    const coordinatePairs = raw.split(/\s+/).map((pair) => pair.split(","))
    const usesCoordinates =
      coordinatePairs.length > 1 &&
      coordinatePairs.every(
        ([x, y, ...rest]) =>
          rest.length === 0 &&
          x?.trim() !== "" &&
          y?.trim() !== "" &&
          Number.isFinite(Number(x)) &&
          Number.isFinite(Number(y)),
      )
    const values = usesCoordinates
      ? coordinatePairs.map(([, y]) => -Number(y))
      : raw
        ? raw
            .split(",")
            .map((part) => Number(part.trim()))
            .filter((value) => Number.isFinite(value))
        : []
    const series = values.length === 1 ? [values[0], values[0]] : values
    return series.map((value, index) => ({ index, value }))
  }, [points])

  if (!data.length) {
    return <div className="h-8 w-20 rounded-full border border-border/80 bg-surface-hi/70" />
  }

  return (
    <div className={className ?? "h-8 w-20"} aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 2, right: 1, bottom: 2, left: 1 }}
          accessibilityLayer={false}
        >
          <XAxis dataKey="index" hide />
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Line
            dataKey="value"
            type="monotone"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={false}
            activeDot={false}
            isAnimationActive={animationActive}
            animationDuration={CHART_ANIMATION_DURATION}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export default memo(Sparkline)
