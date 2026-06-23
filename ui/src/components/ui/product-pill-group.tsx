import * as React from "react"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"

function AppPillGroup({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroup>) {
  return (
    <ToggleGroup
      spacing={1}
      variant="outline"
      className={cn("pill-group", className)}
      {...props}
    />
  )
}

function AppPillItem({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupItem>) {
  return (
    <ToggleGroupItem
      className={cn("pill-button data-[state=on]:pill-button-active", className)}
      {...props}
    />
  )
}

export { AppPillGroup, AppPillItem }
