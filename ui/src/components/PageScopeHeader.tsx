import type { ComponentProps, ReactNode } from "react"
import { cn } from "../lib/utils"
import PageIntro from "./PageIntro"

type PageScopeHeaderProps = Omit<
  ComponentProps<typeof PageIntro>,
  "actions" | "inlineActions"
> & {
  controls: ReactNode
  titleActions?: ReactNode
  controlsTestId?: string
  className?: string
}

export default function PageScopeHeader({
  controls,
  titleActions,
  controlsTestId,
  className,
  ...introProps
}: PageScopeHeaderProps) {
  return (
    <div
      className={cn(
        "grid min-w-0 gap-x-3 gap-y-2.5 min-[1200px]:grid-cols-[minmax(0,1fr)_auto] min-[1200px]:items-start",
        className,
      )}
      data-page-scope-header
    >
      <div className="min-w-0 min-[1200px]:col-start-1 min-[1200px]:row-start-1">
        <PageIntro
          {...introProps}
          actions={titleActions}
        />
      </div>
      <div
        className="min-w-0 min-[1200px]:col-start-2 min-[1200px]:row-start-1 min-[1200px]:justify-self-end"
        data-testid={controlsTestId}
      >
        {controls}
      </div>
    </div>
  )
}
