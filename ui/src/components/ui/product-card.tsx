import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Link } from "react-router-dom"

import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

const appCardVariants = cva("", {
  variants: {
    tone: {
      default: "surface-card",
      soft: "surface-card-soft",
    },
  },
  defaultVariants: {
    tone: "default",
  },
})

type AppCardProps = React.ComponentProps<typeof Card> & VariantProps<typeof appCardVariants>
type AppCardLinkProps = React.ComponentProps<typeof Link> &
  VariantProps<typeof appCardVariants>

function AppCard({ tone = "default", className, ...props }: AppCardProps) {
  return (
    <Card
      variant="unstyled"
      className={cn(appCardVariants({ tone }), className)}
      {...props}
    />
  )
}

const AppCardLink = React.forwardRef<HTMLAnchorElement, AppCardLinkProps>(
  ({ tone = "default", className, ...props }, ref) => (
    <Link
      ref={ref}
      className={cn(appCardVariants({ tone }), className)}
      {...props}
    />
  )
)
AppCardLink.displayName = "AppCardLink"

export { AppCard, AppCardLink }
