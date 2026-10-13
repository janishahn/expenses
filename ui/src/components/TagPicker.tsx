import type { ReactElement } from "react"
import { Combobox } from "./ui/Combobox"

function includesName(names: string[], name: string): boolean {
  const lower = name.toLowerCase()
  return names.some((entry) => entry.toLowerCase() === lower)
}

// Toggles existing tag names on a record; new tags are created on the Tags page. Assigned
// tags that are no longer offered (archived) stay listed so they can be removed.
export function TagPicker({
  trigger,
  options,
  selected,
  onChange,
  label = "Tags",
  align,
}: {
  trigger: ReactElement
  // Names of the active tags offered for new assignments.
  options: string[]
  selected: string[]
  onChange: (next: string[]) => void
  label?: string
  align?: "start" | "end"
}) {
  const names = [...options, ...selected.filter((name) => !includesName(options, name))]
  return (
    <Combobox
      trigger={trigger}
      label={label}
      multiple
      options={names.map((name) => ({ value: name, label: name }))}
      selected={names.filter((name) => includesName(selected, name))}
      onSelect={(name) =>
        onChange(
          includesName(selected, name)
            ? selected.filter((entry) => entry.toLowerCase() !== name.toLowerCase())
            : [...selected, name]
        )
      }
      align={align}
    />
  )
}
