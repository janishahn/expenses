import type { ComponentProps, ElementType, ReactNode } from "react"
import { cn } from "../../lib/utils"

type FinancialPanelProps<T extends ElementType> = {
  as?: T
  role?: "panel" | "hero" | "chart" | "ledger" | "inspector" | "message"
  className?: string
  children?: ReactNode
} & Omit<ComponentProps<T>, "as" | "role" | "className" | "children">

function FinancialPanel<T extends ElementType = "section">({
  as,
  role = "panel",
  className,
  ...props
}: FinancialPanelProps<T>) {
  const Component = as ?? "section"
  return (
    <Component
      data-financial-surface={role}
      className={cn("financial-panel", `financial-panel-${role}`, className)}
      {...props}
    />
  )
}

type MetricLaneProps = ComponentProps<"article"> & {
  tone?: "income" | "expense" | "plan" | "warning" | "neutral"
}

function MetricLane({ tone = "neutral", className, ...props }: MetricLaneProps) {
  return (
    <article
      data-metric-tone={tone}
      className={cn("metric-lane", `metric-lane-${tone}`, className)}
      {...props}
    />
  )
}

function WorkspaceToolbar({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("workspace-toolbar", className)} {...props} />
}

function SectionHeading({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("product-section-heading", className)} {...props} />
}

export { FinancialPanel, MetricLane, SectionHeading, WorkspaceToolbar }
