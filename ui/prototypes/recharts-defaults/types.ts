export type PrototypePage =
  | "dashboard"
  | "insights"
  | "forecast"
  | "scenarios"
  | "budgets"
  | "tags"
  | "recurring"
  | "admin"

export type PrototypeMode = "literal" | "native" | "motion"

export type VariantProps = {
  page: PrototypePage
  onPageChange: (page: PrototypePage) => void
}

export const PROTOTYPE_PAGES: Array<{
  id: PrototypePage
  label: string
  shortLabel: string
}> = [
  { id: "dashboard", label: "Dashboard", shortLabel: "Home" },
  { id: "insights", label: "Insights", shortLabel: "Insights" },
  { id: "forecast", label: "Forecast", shortLabel: "Forecast" },
  { id: "scenarios", label: "What If", shortLabel: "What If" },
  { id: "budgets", label: "Budgets", shortLabel: "Budgets" },
  { id: "tags", label: "Tag detail", shortLabel: "Tags" },
  { id: "recurring", label: "Recurring audit", shortLabel: "Recurring" },
  { id: "admin", label: "Admin health", shortLabel: "Admin" },
]
