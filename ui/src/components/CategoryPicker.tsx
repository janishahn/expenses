import type { ReactElement } from "react"
import type { CategorySummary } from "../app/api-types"
import { CategoryGlyph } from "./ui/CategoryGlyph"
import { Combobox, type ComboboxOption } from "./ui/Combobox"

// Combobox values are numbers; 0 stands for Uncategorized.
const NONE = 0

// Picks one category, with glyphs; `allowNone` offers Uncategorized first.
export function CategoryPicker({
  trigger,
  categories,
  selectedId,
  onSelect,
  allowNone = false,
  grouped = false,
  label = "Category",
  align,
}: {
  trigger: ReactElement
  categories: CategorySummary[]
  // Undefined when nothing is chosen yet, as in bulk edits.
  selectedId: number | null | undefined
  onSelect: (categoryId: number | null) => void
  allowNone?: boolean
  // Groups options under Expense and Income headings.
  grouped?: boolean
  label?: string
  align?: "start" | "end"
}) {
  // The server files a missing category under its "Uncategorized" category, so with
  // allowNone that category is the Uncategorized option rather than a second one.
  const isUncategorized = (category: CategorySummary) => category.name.toLowerCase() === "uncategorized"
  const listed = allowNone ? categories.filter((entry) => !isUncategorized(entry)) : categories
  // Grouped lists show expense categories first, then income, each in their own order.
  const ordered = grouped
    ? [...listed.filter((entry) => entry.type !== "income"), ...listed.filter((entry) => entry.type === "income")]
    : listed
  const options: ComboboxOption<number>[] = [
    ...(allowNone ? [{ value: NONE, label: "Uncategorized" }] : []),
    ...ordered.map((category) => ({
      value: category.id,
      label: category.name,
      leading: <CategoryGlyph categoryId={category.id} icon={category.icon} name={category.name} />,
      group: grouped ? (category.type === "income" ? "Income" : "Expense") : undefined,
    })),
  ]
  const selectsNone =
    selectedId === null || (allowNone && categories.some((entry) => entry.id === selectedId && isUncategorized(entry)))
  const selected = selectedId === undefined ? [] : selectsNone ? (allowNone ? [NONE] : []) : [selectedId]
  return (
    <Combobox
      trigger={trigger}
      label={label}
      options={options}
      selected={selected}
      onSelect={(value) => onSelect(value === NONE ? null : value)}
      align={align}
    />
  )
}
