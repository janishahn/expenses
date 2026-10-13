// Category hues are assigned by id so a category keeps its color everywhere.
export function categoryColor(categoryId: number | null | undefined): string {
  if (categoryId == null) return "var(--cat-other)"
  return `var(--cat-${(Math.abs(categoryId) % 8) + 1})`
}
