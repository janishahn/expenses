import SegmentedControl from "./SegmentedControl"
import { AppCheckbox } from "./ui/product-fields"

export type TagFilterMode = "include" | "exclude"

type TagOption = { id: number; name: string }

type TagFilterPickerProps = {
  tags: TagOption[]
  mode: TagFilterMode
  selectedIds: number[]
  onModeChange: (mode: TagFilterMode, ids: number[]) => void
  onChange: (ids: number[], mode: TagFilterMode) => void
  className?: string
}

function toggleTag(selectedIds: number[], tagId: number, checked: boolean): number[] {
  if (checked) {
    return Array.from(new Set([...selectedIds, tagId])).sort((left, right) => left - right)
  }
  return selectedIds.filter((id) => id !== tagId)
}

export default function TagFilterPicker({
  tags,
  mode,
  selectedIds,
  onModeChange,
  onChange,
  className,
}: TagFilterPickerProps) {
  return (
    <fieldset className={className}>
      <legend className="mb-2 text-xs font-semibold text-muted">Tags</legend>
      <div className="mb-3">
        <SegmentedControl
          value={mode}
          ariaLabel="Tag filter mode"
          equalWidth
          className="w-full [&_.segmented-control-button]:min-h-9 [&_.segmented-control-button]:px-2.5"
          items={[
            { value: "include", label: "Only include" },
            { value: "exclude", label: "Exclude" },
          ]}
          onValueChange={(value) => onModeChange(value, selectedIds)}
        />
      </div>
      {tags.length ? (
        <div className="max-h-52 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-surface-hi">
          {tags.map((tag) => (
            <label
              key={tag.id}
              className="flex min-h-11 cursor-pointer items-center gap-3 px-3 text-sm text-text"
            >
              <AppCheckbox
                checked={selectedIds.includes(tag.id)}
                onCheckedChange={(checked) =>
                  onChange(toggleTag(selectedIds, tag.id, checked === true), mode)
                }
              />
              <span className="min-w-0 flex-1 truncate">{tag.name}</span>
            </label>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-border bg-surface-hi px-3 py-3 text-sm text-muted">
          No tags available
        </p>
      )}
    </fieldset>
  )
}
