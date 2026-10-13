import { CheckboxField } from "./ui/Checkbox"
import { SegmentedControl } from "./ui/SegmentedControl"

export type TagMode = "include" | "exclude"

// Only include or exclude the ticked tags. Used inside a Filter popover or sheet.
export function TagFilterOptions({
  tags,
  mode,
  ids,
  onChange,
}: {
  tags: Array<{ id: number; name: string }>
  mode: TagMode
  ids: number[]
  onChange: (mode: TagMode, ids: number[]) => void
}) {
  return (
    <>
      <SegmentedControl
        label="Tag filter mode"
        fullWidth
        value={mode}
        options={[
          { value: "include", label: "Only include" },
          { value: "exclude", label: "Exclude" },
        ]}
        onChange={(next) => onChange(next, ids)}
      />
      {tags.map((tag) => (
        <CheckboxField
          key={tag.id}
          checked={ids.includes(tag.id)}
          onCheckedChange={(checked) =>
            onChange(mode, checked ? [...ids, tag.id] : ids.filter((id) => id !== tag.id))
          }
        >
          {tag.name}
        </CheckboxField>
      ))}
    </>
  )
}
