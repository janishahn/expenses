import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const appButtonVariants = cva("", {
  variants: {
    tone: {
      primary: "btn-primary",
      ghost: "btn-ghost",
      danger: "btn-danger",
      inline: "btn-inline",
      inlineDanger: "btn-inline-danger",
    },
  },
  defaultVariants: {
    tone: "primary",
  },
})

type AppButtonProps = Omit<React.ComponentProps<typeof Button>, "variant" | "size"> &
  VariantProps<typeof appButtonVariants>

const AppButton = React.forwardRef<HTMLButtonElement, AppButtonProps>(
  ({ tone = "primary", className, ...props }, ref) => (
    <Button
      ref={ref}
      variant="unstyled"
      size="legacy"
      className={cn(appButtonVariants({ tone }), className)}
      {...props}
    />
  )
)
AppButton.displayName = "AppButton"

export { AppButton }
