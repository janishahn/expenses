import type { Icon as PhosphorIcon } from "@phosphor-icons/react/dist/lib/types"

const DYNAMIC_ICON_CACHE_LIMIT = 120

const LEGACY_LUCIDE_ICON_ALIASES: Record<string, string> = {
  home: "house",
  music: "music-notes",
  zap: "lightning",
  plane: "airplane",
  utensils: "fork-knife",
  shirt: "t-shirt",
  dumbbell: "barbell",
  film: "film-strip",
  "gamepad-2": "game-controller",
  wifi: "wifi-high",
  smartphone: "device-mobile",
  banknote: "money",
  "trending-up": "trend-up",
  building: "buildings",
  fuel: "gas-pump",
  "circle-dollar-sign": "currency-circle-dollar",
  menu: "list",
}

const loadedDynamicIcons = new Map<string, PhosphorIcon | null>()
const inFlightLoads = new Map<string, Promise<PhosphorIcon | null>>()

const phosphorCsrModules = import.meta.glob([
  "/node_modules/@phosphor-icons/react/dist/csr/*.es.js",
  "/node_modules/@phosphor-icons/react/dist/csr/*.js",
  "/node_modules/@phosphor-icons/react/dist/csr/*.mjs",
]) as Record<string, () => Promise<unknown>>

function pascalToKebab(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase()
}

function kebabToPascal(value: string): string {
  return value
    .split("-")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join("")
}

const csrModuleByIconKey = new Map<string, () => Promise<unknown>>()
for (const [modulePath, loader] of Object.entries(phosphorCsrModules)) {
  const match = modulePath.match(/\/([^/]+?)\.(?:es\.)?m?js$/)
  if (!match) {
    continue
  }
  const iconKey = pascalToKebab(match[1])
  if (!csrModuleByIconKey.has(iconKey)) {
    csrModuleByIconKey.set(iconKey, loader)
  }
}
const knownIconKeySet = new Set(csrModuleByIconKey.keys())

function cacheDynamicIcon(iconKey: string, iconComponent: PhosphorIcon | null): void {
  loadedDynamicIcons.set(iconKey, iconComponent)
  if (loadedDynamicIcons.size <= DYNAMIC_ICON_CACHE_LIMIT) {
    return
  }
  const oldestKey = loadedDynamicIcons.keys().next().value
  if (oldestKey !== undefined) {
    loadedDynamicIcons.delete(oldestKey)
  }
}

function resolveRuntimePhosphorIconKey(iconKey: string | null): string | null {
  if (!iconKey) {
    return null
  }
  if (knownIconKeySet.has(iconKey)) {
    return iconKey
  }
  const aliased = LEGACY_LUCIDE_ICON_ALIASES[iconKey]
  if (aliased && knownIconKeySet.has(aliased)) {
    return aliased
  }
  return null
}

export function loadRuntimeCsrIcon(iconKey: string): Promise<PhosphorIcon | null> {
  const resolvedIconKey = resolveRuntimePhosphorIconKey(iconKey)
  if (!resolvedIconKey) {
    return Promise.resolve(null)
  }
  if (loadedDynamicIcons.has(resolvedIconKey)) {
    return Promise.resolve(loadedDynamicIcons.get(resolvedIconKey) ?? null)
  }
  const pendingLoad = inFlightLoads.get(resolvedIconKey)
  if (pendingLoad) {
    return pendingLoad
  }

  const loader = csrModuleByIconKey.get(resolvedIconKey)
  if (!loader) {
    cacheDynamicIcon(resolvedIconKey, null)
    return Promise.resolve(null)
  }

  const pascalName = kebabToPascal(resolvedIconKey)
  const loadPromise = loader().then(
    (mod) => {
      const icon = (mod as Record<string, PhosphorIcon | undefined>)[
        `${pascalName}Icon`
      ]
      const resolved = icon ?? null
      cacheDynamicIcon(resolvedIconKey, resolved)
      return resolved
    },
    () => {
      cacheDynamicIcon(resolvedIconKey, null)
      return null
    }
  )

  inFlightLoads.set(resolvedIconKey, loadPromise)
  loadPromise.finally(() => {
    inFlightLoads.delete(resolvedIconKey)
  })
  return loadPromise
}
