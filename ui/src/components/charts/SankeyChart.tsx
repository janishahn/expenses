import { memo, useMemo } from "react"
import { Chart } from "react-chartjs-2"
import { readThemeColor } from "./chartSetup"
import { formatCurrency } from "../../app/format"
import type { FlowLink, FlowNode } from "./flowGrouping"
import { useThemePreference } from "../../theme/useThemePreference"

type SankeyChartProps = {
  nodes: FlowNode[]
  links: FlowLink[]
  onCategoryClick?: (categoryId: number) => void
}

type SankeyDatum = {
  from: string
  to: string
  flow: number
}

type SankeyTooltipContext = {
  raw?: unknown
}

type SankeyColorContext = {
  dataset?: {
    data?: unknown[]
  }
  dataIndex?: number
}

function nodeColor(
  nodeType: string,
  palette: { positive: string; negative: string; neutral: string }
): string {
  if (nodeType === "income") return palette.positive
  if (nodeType === "expense") return palette.negative
  if (nodeType === "savings") return palette.positive
  if (nodeType === "deficit") return palette.negative
  if (nodeType === "group") return palette.neutral
  return palette.neutral
}

function toSankeyDatum(value: unknown): SankeyDatum | null {
  if (!value || typeof value !== "object") {
    return null
  }
  const raw = value as { from?: unknown; to?: unknown; flow?: unknown }
  if (
    typeof raw.from !== "string" ||
    typeof raw.to !== "string" ||
    typeof raw.flow !== "number"
  ) {
    return null
  }
  return {
    from: raw.from,
    to: raw.to,
    flow: raw.flow,
  }
}

function datumFromColorContext(context: SankeyColorContext): SankeyDatum | null {
  const index = context.dataIndex
  if (typeof index !== "number") {
    return null
  }
  const points = context.dataset?.data
  if (!points || index < 0 || index >= points.length) {
    return null
  }
  return toSankeyDatum(points[index])
}

function SankeyChart({ nodes, links, onCategoryClick }: SankeyChartProps) {
  const { effectiveTheme } = useThemePreference()

  const { chartData, options, minHeight } = useMemo(() => {
    const nodeMap = new Map(nodes.map((node) => [node.id, node]))
    const border = readThemeColor("--surface", "22 32 39")
    const text = readThemeColor("--text", "237 244 246")
    const nodePalette = {
      positive: readThemeColor("--semantic-green", "98 196 146"),
      negative: readThemeColor("--semantic-red", "224 114 102"),
      neutral: readThemeColor("--semantic-purple", "145 157 224"),
    }
    const totalFlow = links.reduce(
      (sum, link) => sum + Math.max(0, Number(link.amount_cents || 0)),
      0
    )

    const chartData = {
      datasets: [
        {
          labels: Object.fromEntries(nodes.map((node) => [node.id, node.label])),
          data: links.map((link) => ({
            from: link.from,
            to: link.to,
            flow: link.amount_cents,
          })),
          colorFrom: (context: SankeyColorContext) => {
            const point = datumFromColorContext(context)
            const source = point ? nodeMap.get(point.from) : null
            return nodeColor(source?.type || "", nodePalette)
          },
          colorTo: (context: SankeyColorContext) => {
            const point = datumFromColorContext(context)
            const target = point ? nodeMap.get(point.to) : null
            return nodeColor(target?.type || "", nodePalette)
          },
          colorMode: "from",
          borderColor: border,
          borderWidth: 1,
          nodeWidth: 14,
          nodePadding: 24,
          font: { size: 13, weight: "bold" as const },
          color: text,
        },
      ],
    }

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      parsing: {
        from: "from",
        to: "to",
        flow: "flow",
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context: SankeyTooltipContext) => {
              const point = toSankeyDatum(context.raw)
              if (!point) {
                return ""
              }
              const source = nodeMap.get(point.from)
              const target = nodeMap.get(point.to)
              const percentage =
                totalFlow > 0
                  ? `${((point.flow / totalFlow) * 100).toFixed(1)}%`
                  : "0.0%"
              return `${source?.label || point.from} -> ${target?.label || point.to}: ${formatCurrency(point.flow)} € (${percentage})`
            },
          },
        },
      },
      onClick: (_event: unknown, elements: unknown[]) => {
        if (!onCategoryClick || !elements.length) {
          return
        }
        const element = elements[0] as { index?: number }
        if (typeof element.index !== "number") {
          return
        }
        const link = links[element.index]
        if (!link) {
          return
        }
        const targetNode = nodeMap.get(link.to)
        if (targetNode?.type === "expense" && targetNode.category_id) {
          onCategoryClick(targetNode.category_id)
          return
        }
        const sourceNode = nodeMap.get(link.from)
        if (sourceNode?.type === "expense" && sourceNode.category_id) {
          onCategoryClick(sourceNode.category_id)
        }
      },
      scales: {
        x: { display: false },
        y: { display: false },
      },
    }

    const nodeCount = new Set([
      ...links.map((l) => l.from),
      ...links.map((l) => l.to),
    ]).size
    const minHeight = Math.max(300, nodeCount * 40)

    return { chartData, options, minHeight }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, links, onCategoryClick, effectiveTheme])

  if (!nodes.length || !links.length) {
    return (
      <p className="text-sm text-muted">
        Not enough data for flow view in this period.
      </p>
    )
  }

  const SankeyComponent = Chart as unknown as (props: {
    type: string
    data: unknown
    options: unknown
  }) => JSX.Element

  return (
    <div style={{ height: Math.min(minHeight, 700) }}>
      <SankeyComponent
        key={`sankey-${effectiveTheme}`}
        type="sankey"
        data={chartData}
        options={options}
      />
    </div>
  )
}

export default memo(SankeyChart)
