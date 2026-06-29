import * as React from "react"

import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

const inputToneClass =
  "field w-full rounded-lg border border-border bg-surface-hi px-3.5 py-2.5 text-base text-text shadow-[inset_0_1px_0_rgb(var(--surface-highlight)_/_0.06),0_1px_0_rgb(255_255_255_/_0.02)] hover:border-border-hi focus-visible:border-accent focus-visible:ring-0 focus-visible:shadow-[inset_0_1px_0_rgb(var(--surface-highlight)_/_0.08),var(--ring-focus)] md:text-[0.95rem]"

function AppFieldLabel({ className, ...props }: React.ComponentProps<"label">) {
  return <label className={cn("form-label", className)} {...props} />
}

const AppInput = React.forwardRef<HTMLInputElement, React.ComponentProps<typeof Input>>(
  ({ className, ...props }, ref) => (
    <Input ref={ref} className={cn(inputToneClass, className)} {...props} />
  )
)
AppInput.displayName = "AppInput"

const AppNativeSelect = React.forwardRef<
  HTMLSelectElement,
  React.ComponentPropsWithoutRef<"select">
>(({ className, ...props }, ref) => (
  <select ref={ref} className={cn(inputToneClass, className)} {...props} />
))
AppNativeSelect.displayName = "AppNativeSelect"

const AppTextarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<typeof Textarea>
>(({ className, ...props }, ref) => (
  <Textarea ref={ref} className={cn(inputToneClass, "min-h-[7.5rem] resize-y rounded-xl", className)} {...props} />
))
AppTextarea.displayName = "AppTextarea"

function AppSwitch({
  className,
  ...props
}: React.ComponentProps<typeof Switch>) {
  return (
    <Switch
      size="sm"
      className={cn(
        "data-[state=checked]:border-accent/40 data-[state=checked]:bg-accent/20 data-[state=unchecked]:border-border data-[state=unchecked]:bg-surface-hi/80 data-[state=checked]:[&_[data-slot=switch-thumb]]:bg-accent data-[state=unchecked]:[&_[data-slot=switch-thumb]]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function AppCheckbox({
  className,
  ...props
}: React.ComponentProps<typeof Checkbox>) {
  return <Checkbox className={cn("control-check", className)} {...props} />
}

export { AppCheckbox, AppFieldLabel, AppInput, AppNativeSelect, AppSwitch, AppTextarea }
