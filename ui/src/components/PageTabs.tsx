import type { ReactNode } from "react"
import { Tabs as TabsPrimitive } from "radix-ui"
import { cn } from "../lib/utils"

type PageTabItem = {
  value: string
  label: ReactNode
}

type PageTabsProps = {
  value: string
  items: ReadonlyArray<PageTabItem>
  onValueChange: (value: string) => void
  ariaLabel: string
  className?: string
  children: ReactNode
}

function PageTabs({
  value,
  items,
  onValueChange,
  ariaLabel,
  className,
  children,
}: PageTabsProps) {
  return (
    <TabsPrimitive.Root
      value={value}
      onValueChange={onValueChange}
      className={className}
    >
      <TabsPrimitive.List
        aria-label={ariaLabel}
        className="flex min-w-0 gap-5 border-b border-border"
      >
        {items.map((item) => (
          <TabsPrimitive.Trigger
            key={item.value}
            value={item.value}
            className="relative inline-flex min-h-11 items-center justify-center whitespace-nowrap px-0.5 text-sm font-semibold text-muted outline-none transition-colors after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:origin-center after:scale-x-0 after:rounded-full after:bg-accent after:transition-transform hover:text-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg data-[state=active]:text-text data-[state=active]:after:scale-x-100"
          >
            {item.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {children}
    </TabsPrimitive.Root>
  )
}

type PageTabPanelProps = {
  value: string
  className?: string
  children: ReactNode
}

function PageTabPanel({ value, className, children }: PageTabPanelProps) {
  return (
    <TabsPrimitive.Content value={value} className={cn("outline-none", className)}>
      {children}
    </TabsPrimitive.Content>
  )
}

export { PageTabPanel, PageTabs }
