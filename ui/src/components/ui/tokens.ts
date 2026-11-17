// Category hues are assigned by id so a category keeps its color everywhere.
export function categoryColor(categoryId: number | null | undefined): string {
  if (categoryId == null) return "var(--cat-other)"
  return `var(--cat-${(Math.abs(categoryId) % 8) + 1})`
}

// Colors for categories shown side by side in a chart or legend, in displayed order. A category whose hue
// matches the one before it takes the next hue, so neighbours stay apart. iOS applies the same rule.
export function neighbourCategoryColors(categoryIds: ReadonlyArray<number | null | undefined>): string[] {
  let previous: number | null = null
  return categoryIds.map((categoryId) => {
    if (categoryId == null) {
      previous = null
      return "var(--cat-other)"
    }
    let index = Math.abs(categoryId) % 8
    if (index === previous) index = (index + 1) % 8
    previous = index
    return `var(--cat-${index + 1})`
  })
}
