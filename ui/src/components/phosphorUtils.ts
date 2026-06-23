import { icons as phosphorMeta } from "@phosphor-icons/core"
import type { Icon as PhosphorIcon } from "@phosphor-icons/react/dist/lib/types"

export type { PhosphorIcon }

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

export const ALL_PHOSPHOR_ICON_KEYS: string[] = phosphorMeta
  .map((entry) => entry.name)
  .sort()

export const ICON_SEARCH_TEXT: Record<string, string> = Object.fromEntries(
  phosphorMeta.map((entry) => {
    const parts = [entry.name, ...entry.tags, ...entry.categories]
    return [entry.name, parts.join(" ").toLowerCase()]
  })
)

const knownIconKeySet = new Set(ALL_PHOSPHOR_ICON_KEYS)
const loadedDynamicIcons = new Map<string, PhosphorIcon | null>()
const inFlightLoads = new Map<string, Promise<PhosphorIcon | null>>()
const inferredLegacyAliases = new Map<string, string | null>()

const phosphorCsrModules = import.meta.glob([
  "/node_modules/@phosphor-icons/react/dist/csr/*.es.js",
  "/node_modules/@phosphor-icons/react/dist/csr/*.js",
  "/node_modules/@phosphor-icons/react/dist/csr/*.mjs",
]) as Record<string, () => Promise<unknown>>

if (import.meta.env.DEV && Object.keys(phosphorCsrModules).length === 0) {
  console.warn(
    "No Phosphor CSR icon modules found. Check @phosphor-icons/react install and dist/csr layout."
  )
}

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

function inferAliasFromMetadata(iconKey: string): string | null {
  const cached = inferredLegacyAliases.get(iconKey)
  if (cached !== undefined) {
    return cached
  }
  const keyParts = iconKey
    .toLowerCase()
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
  if (!keyParts.length) {
    inferredLegacyAliases.set(iconKey, null)
    return null
  }
  const matches: string[] = []
  for (const candidateKey of ALL_PHOSPHOR_ICON_KEYS) {
    const searchText = ICON_SEARCH_TEXT[candidateKey]
    if (keyParts.every((part) => searchText.includes(part))) {
      matches.push(candidateKey)
      if (matches.length > 1) {
        inferredLegacyAliases.set(iconKey, null)
        return null
      }
    }
  }
  const resolved = matches[0] ?? null
  inferredLegacyAliases.set(iconKey, resolved)
  return resolved
}

export function resolvePhosphorIconKey(iconKey: string | null): string | null {
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
  return inferAliasFromMetadata(iconKey)
}

export function isValidPhosphorIconKey(iconKey: string | null): boolean {
  return resolvePhosphorIconKey(iconKey) !== null
}

function kebabToPascal(kebab: string): string {
  return kebab
    .split("-")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join("")
}

function resolveCsrModuleLoader(pascalName: string): (() => Promise<unknown>) | null {
  const suffixes = [".es.js", ".js", ".mjs"]
  for (const suffix of suffixes) {
    const modulePath = `/node_modules/@phosphor-icons/react/dist/csr/${pascalName}${suffix}`
    const loader = phosphorCsrModules[modulePath]
    if (loader) {
      return loader
    }
  }
  return null
}

export function loadCsrIcon(iconKey: string): Promise<PhosphorIcon | null> {
  const resolvedIconKey = resolvePhosphorIconKey(iconKey)
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

  const pascalName = kebabToPascal(resolvedIconKey)
  const loader = resolveCsrModuleLoader(pascalName)
  if (!loader) {
    cacheDynamicIcon(resolvedIconKey, null)
    return Promise.resolve(null)
  }

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
