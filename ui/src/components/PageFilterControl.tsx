import {
  forwardRef,
  useId,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react"
import { FunnelSimpleIcon } from "@phosphor-icons/react/FunnelSimple"
import { XIcon } from "@phosphor-icons/react/X"
import { Popover as PopoverPrimitive } from "radix-ui"
import { cn } from "../lib/utils"
import { AppButton } from "./ui/product-button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "./ui/sheet"

type PageFilterControlProps = {
  title: string
  activeCount: number
  isDesktop: boolean
  onOpen: () => void
  onClear: () => void
  onApply: () => void
  children: ReactNode
}

type FilterTriggerProps = Omit<ComponentProps<typeof AppButton>, "children"> & {
  activeCount: number
  compact: boolean
  open: boolean
}

const FilterTrigger = forwardRef<HTMLButtonElement, FilterTriggerProps>(
  function FilterTrigger(
    { activeCount, compact, open, className, ...props },
    ref,
  ) {
    const accessibleLabel = activeCount
      ? `Filters, ${activeCount} active`
      : "Filters"

    return (
      <AppButton
        ref={ref}
        type="button"
        tone="ghost"
        aria-label={accessibleLabel}
        aria-expanded={open}
        className={cn(
          compact
            ? "page-filter-trigger page-filter-trigger-compact relative shrink-0 p-0 text-text"
            : "page-filter-trigger gap-2 px-3.5 text-text",
          className,
        )}
        {...props}
      >
        <FunnelSimpleIcon
          data-icon={compact ? undefined : "inline-start"}
          className="h-4 w-4"
          aria-hidden="true"
        />
        {!compact ? <span>Filters</span> : null}
        {activeCount ? (
          <span
            className={
              compact
                ? "absolute -right-1 -top-1 grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-full bg-accent px-1 font-mono text-[10px] leading-none text-[rgb(var(--accent-contrast))]"
                : "grid min-h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 font-mono text-[10px] leading-none text-[rgb(var(--accent-contrast))]"
            }
            aria-hidden="true"
          >
            {activeCount}
          </span>
        ) : null}
      </AppButton>
    )
  },
)

function FilterBody({
  title,
  titleId,
  onClear,
  onCancel,
  onApply,
  children,
}: {
  title: string
  titleId: string
  onClear: () => void
  onCancel: () => void
  onApply: () => void
  children: ReactNode
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 id={titleId} className="font-head text-lg font-bold tracking-tight">
          {title}
        </h2>
        <AppButton
          type="button"
          tone="ghost"
          className="h-11 w-11 shrink-0 p-0 text-muted"
          onClick={onCancel}
          aria-label="Close filters"
        >
          <XIcon className="h-4 w-4" aria-hidden="true" />
        </AppButton>
      </div>
      <div className="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto px-5 py-4">
        {children}
      </div>
      <div className="flex shrink-0 gap-2 border-t border-border px-5 py-4">
        <AppButton type="button" tone="ghost" onClick={onClear}>
          Clear
        </AppButton>
        <AppButton type="button" tone="ghost" onClick={onCancel}>
          Cancel
        </AppButton>
        <AppButton type="button" onClick={onApply} className="flex-1">
          Apply
        </AppButton>
      </div>
    </>
  )
}

export default function PageFilterControl({
  title,
  activeCount,
  isDesktop,
  onOpen,
  onClear,
  onApply,
  children,
}: PageFilterControlProps) {
  const [open, setOpen] = useState(false)
  const titleId = useId()

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) onOpen()
    setOpen(nextOpen)
  }
  const apply = () => {
    onApply()
    setOpen(false)
  }

  if (isDesktop) {
    return (
      <PopoverPrimitive.Root modal={false} open={open} onOpenChange={handleOpenChange}>
        <PopoverPrimitive.Trigger asChild>
          <FilterTrigger activeCount={activeCount} compact={false} open={open} />
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            role="dialog"
            data-testid="page-filter-panel"
            align="start"
            sideOffset={8}
            collisionPadding={12}
            aria-labelledby={titleId}
            className="filter-popover z-50 flex w-[22rem] flex-col overflow-hidden rounded-2xl border border-border bg-surface text-text shadow-[var(--shadow-raised)] outline-none"
          >
            <FilterBody
              title={title}
              titleId={titleId}
              onClear={onClear}
              onCancel={() => setOpen(false)}
              onApply={apply}
            >
              {children}
            </FilterBody>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    )
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <FilterTrigger
        activeCount={activeCount}
        compact
        open={open}
        onClick={() => handleOpenChange(true)}
      />
      <SheetContent side="bottom" className="max-h-[88vh]" aria-label={title}>
        <SheetHeader className="sr-only">
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <FilterBody
          title={title}
          titleId={titleId}
          onClear={onClear}
          onCancel={() => setOpen(false)}
          onApply={apply}
        >
          {children}
        </FilterBody>
      </SheetContent>
    </Sheet>
  )
}
