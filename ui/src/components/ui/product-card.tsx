import * as React from "react"

import { cn } from "@/lib/utils"

function AppCard({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn("surface-card", className)}
      {...props}
    />
  )
}

export { AppCard }
