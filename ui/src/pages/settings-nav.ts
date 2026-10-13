import { ArrowsDownUpIcon } from "@phosphor-icons/react/ArrowsDownUp"
import { ChartBarIcon } from "@phosphor-icons/react/ChartBar"
import { FileMagnifyingGlassIcon } from "@phosphor-icons/react/FileMagnifyingGlass"
import { InfoIcon } from "@phosphor-icons/react/Info"
import { PaletteIcon } from "@phosphor-icons/react/Palette"
import { PulseIcon } from "@phosphor-icons/react/Pulse"
import { ScalesIcon } from "@phosphor-icons/react/Scales"
import { ShapesIcon } from "@phosphor-icons/react/Shapes"
import { SparkleIcon } from "@phosphor-icons/react/Sparkle"
import { UserIcon } from "@phosphor-icons/react/User"
import { WrenchIcon } from "@phosphor-icons/react/Wrench"
import { useAuth } from "../app/auth"
import type { SettingsGroup } from "../components/ui/SettingsShell"

export type SettingsSectionKey = "account" | "appearance" | "categorization" | "ai" | "snapshots" | "data"
export type AdminSectionKey = "health" | "maintenance" | "usage" | "logs" | "system"

export const SETTINGS_SECTIONS: SettingsSectionKey[] = ["account", "appearance", "categorization", "ai", "snapshots", "data"]
export const ADMIN_SECTIONS: AdminSectionKey[] = ["health", "maintenance", "usage", "logs", "system"]

// Settings and Admin share one section list; the Server group is for admins only.
export function useSettingsGroups(): SettingsGroup[] {
  const { user, llmEnabled } = useAuth()
  const groups: SettingsGroup[] = [
    {
      label: "Account",
      sections: [
        { key: "account", label: "Account", icon: UserIcon, to: "/settings" },
        { key: "appearance", label: "Appearance", icon: PaletteIcon, to: "/settings/appearance" },
      ],
    },
    {
      label: "Data",
      sections: [
        { key: "categorization", label: "Categorization", icon: ShapesIcon, to: "/settings/categorization" },
        { key: "ai", label: "AI", icon: SparkleIcon, to: "/settings/ai" },
        { key: "snapshots", label: "Balance snapshots", icon: ScalesIcon, to: "/settings/snapshots" },
        { key: "data", label: "Import and export", icon: ArrowsDownUpIcon, to: "/settings/data" },
      ],
    },
  ]
  if (user?.is_admin) {
    groups.push({
      label: "Server",
      sections: [
        { key: "health", label: "Health", icon: PulseIcon, to: "/admin" },
        { key: "maintenance", label: "Maintenance", icon: WrenchIcon, to: "/admin/maintenance" },
        ...(llmEnabled ? [{ key: "usage", label: "Assistant usage", icon: ChartBarIcon, to: "/admin/usage" }] : []),
        { key: "logs", label: "Logs", icon: FileMagnifyingGlassIcon, to: "/admin/logs" },
        { key: "system", label: "System", icon: InfoIcon, to: "/admin/system" },
      ],
    })
  }
  return groups
}
