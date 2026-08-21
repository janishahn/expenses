import type { ComponentProps, ReactNode } from "react"
import { cn } from "../lib/utils"

type PageFilterBarProps = Omit<ComponentProps<"div">, "children"> & {
  period: ReactNode
  filters?: ReactNode
  className?: string
}

export default function PageFilterBar({
  period,
  filters,
  className,
  ...props
}: PageFilterBarProps) {
  return (
    <div
      className={cn(
        "page-filter-bar flex min-w-0 items-start gap-2",
        className,
      )}
      {...props}
    >
      <div className="min-w-0 flex-1">{period}</div>
      {filters ? <div className="shrink-0">{filters}</div> : null}
    </div>
  )
}
