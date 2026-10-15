import type { Icon } from "@phosphor-icons/react"
import { CalendarDotsIcon } from "@phosphor-icons/react/CalendarDots"
import { ChartLineIcon } from "@phosphor-icons/react/ChartLine"
import { ChecksIcon } from "@phosphor-icons/react/Checks"
import { FileTextIcon } from "@phosphor-icons/react/FileText"
import { FlaskIcon } from "@phosphor-icons/react/Flask"
import { LayoutIcon } from "@phosphor-icons/react/Layout"
import { ListBulletsIcon } from "@phosphor-icons/react/ListBullets"
import { MagicWandIcon } from "@phosphor-icons/react/MagicWand"
import { RepeatIcon } from "@phosphor-icons/react/Repeat"
import { ShapesIcon } from "@phosphor-icons/react/Shapes"
import { SparkleIcon } from "@phosphor-icons/react/Sparkle"
import { SquaresFourIcon } from "@phosphor-icons/react/SquaresFour"
import { TagIcon } from "@phosphor-icons/react/Tag"
import { TargetIcon } from "@phosphor-icons/react/Target"
import { TrendUpIcon } from "@phosphor-icons/react/TrendUp"

export type NavItem = { to: string; label: string; icon: Icon; llm?: boolean }

export const PRIMARY: NavItem[] = [
  { to: "/", label: "Dashboard", icon: SquaresFourIcon },
  { to: "/transactions", label: "Transactions", icon: ListBulletsIcon },
  { to: "/budgets", label: "Budgets", icon: TargetIcon },
  { to: "/insights", label: "Insights", icon: ChartLineIcon },
  { to: "/forecast", label: "Forecast", icon: TrendUpIcon },
]
export const UNCATEGORIZED = "/transactions/inbox"
export const GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Manage",
    items: [
      { to: "/recurring", label: "Recurring", icon: RepeatIcon },
      { to: "/templates", label: "Templates", icon: LayoutIcon },
      { to: "/rules", label: "Rules", icon: MagicWandIcon },
      { to: "/categories", label: "Categories", icon: ShapesIcon },
      { to: "/tags", label: "Tags", icon: TagIcon },
    ],
  },
  {
    label: "Tools",
    items: [
      { to: "/scenarios", label: "What If", icon: FlaskIcon },
      { to: "/reconciliation", label: "Reconcile", icon: ChecksIcon },
      { to: "/reports/builder", label: "Reports", icon: FileTextIcon },
      { to: "/digest", label: "Digest", icon: CalendarDotsIcon },
      { to: "/assistant", label: "Assistant", icon: SparkleIcon, llm: true },
    ],
  },
]
export const TABS = PRIMARY.slice(0, 4)

export function isActive(to: string, pathname: string): boolean {
  if (to === "/") return pathname === "/"
  if (to === "/transactions" && pathname.startsWith(UNCATEGORIZED)) return false
  const base = to === "/reports/builder" ? "/reports" : to
  return pathname === base || pathname.startsWith(`${base}/`)
}

// The navigation label of the page at a path, for a page that failed before it could show its title.
export function navLabel(pathname: string): string | undefined {
  if (pathname.startsWith(UNCATEGORIZED)) return "Uncategorized"
  if (pathname.startsWith("/transactions/deleted")) return "Trash"
  if (pathname.startsWith("/settings")) return "Settings"
  if (pathname.startsWith("/admin")) return "Admin"
  return [...PRIMARY, ...GROUPS.flatMap((group) => group.items)].find((item) => isActive(item.to, pathname))?.label
}
