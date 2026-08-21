import { XIcon } from "@phosphor-icons/react/X"
import { AppButton } from "./ui/product-button"

export type ActiveFilterChip = {
  key: string
  label: string
  onRemove: () => void
}

type ActiveFilterChipsProps = {
  filters: ActiveFilterChip[]
  onClear: () => void
  className?: string
}

export default function ActiveFilterChips({
  filters,
  onClear,
  className = "",
}: ActiveFilterChipsProps) {
  if (!filters.length) return null

  return (
    <div
      className={`flex min-w-0 flex-wrap items-center gap-1.5 ${className}`}
      aria-label="Active filters"
    >
      {filters.map((filter) => (
        <button
          key={filter.key}
          type="button"
          onClick={filter.onRemove}
          className="chip-action inline-flex max-w-full items-center rounded-full text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Remove ${filter.label}`}
        >
          <span className="chip inline-flex max-w-full items-center gap-1.5">
            <span className="truncate">{filter.label}</span>
            <XIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
          </span>
        </button>
      ))}
      {filters.length > 1 ? (
        <AppButton
          type="button"
          tone="inline"
          onClick={onClear}
          className="min-h-0 px-2 py-1 text-[11px]"
        >
          Clear all
        </AppButton>
      ) : null}
    </div>
  )
}
