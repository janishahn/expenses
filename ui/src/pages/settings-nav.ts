import { ArrowsDownUpIcon } from "@phosphor-icons/react/ArrowsDownUp"
import { ChartBarIcon } from "@phosphor-icons/react/ChartBar"
import { ChatsIcon } from "@phosphor-icons/react/Chats"
import { CpuIcon } from "@phosphor-icons/react/Cpu"
import { FileMagnifyingGlassIcon } from "@phosphor-icons/react/FileMagnifyingGlass"
import { InfoIcon } from "@phosphor-icons/react/Info"
import { PaletteIcon } from "@phosphor-icons/react/Palette"
import { PulseIcon } from "@phosphor-icons/react/Pulse"
import { ScalesIcon } from "@phosphor-icons/react/Scales"
import { ShapesIcon } from "@phosphor-icons/react/Shapes"
import { UserIcon } from "@phosphor-icons/react/User"
import { WrenchIcon } from "@phosphor-icons/react/Wrench"
import { useAuth } from "../app/auth"
import type { SettingsGroup } from "../components/ui/SettingsShell"

export type SettingsSectionKey = "account" | "appearance" | "categorization" | "assistant" | "snapshots" | "data"
export type AdminSectionKey = "health" | "maintenance" | "ai" | "usage" | "logs" | "system"

export const SETTINGS_SECTIONS: SettingsSectionKey[] = ["account", "appearance", "categorization", "assistant", "snapshots", "data"]
export const ADMIN_SECTIONS: AdminSectionKey[] = ["health", "maintenance", "ai", "usage", "logs", "system"]

// Settings and Admin share one section list; the Server group is for admins only.
export function useSettingsGroups(): SettingsGroup[] {
  const { user, aiFeatures } = useAuth()
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
        ...(aiFeatures.includes("spending_chat")
          ? [{ key: "assistant" as const, label: "Assistant", icon: ChatsIcon, to: "/settings/assistant" }]
          : []),
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
        { key: "ai", label: "AI", icon: CpuIcon, to: "/admin/ai" },
        { key: "usage", label: "AI usage", icon: ChartBarIcon, to: "/admin/usage" },
        { key: "logs", label: "Logs", icon: FileMagnifyingGlassIcon, to: "/admin/logs" },
        { key: "system", label: "System", icon: InfoIcon, to: "/admin/system" },
      ],
    })
  }
  return groups
}
