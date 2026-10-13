import { useEffect, useMemo, useState } from "react"
import { CurrencyCircleDollarIcon } from "@phosphor-icons/react/CurrencyCircleDollar"
import {
  ALL_PHOSPHOR_ICON_KEYS,
  ICON_SEARCH_TEXT,
  loadCsrIcon,
  resolvePhosphorIconKey,
  isValidPhosphorIconKey,
  type PhosphorIcon,
} from "./phosphorUtils"
import {
  CURATED_CATEGORY_ICONS,
  DEFAULT_CATEGORY_ICON_KEY,
  iconLabel,
} from "./categoryIconsCatalog"
import { Button } from "./ui/Button"
import { EmptyState } from "./ui/EmptyState"
import { IconChoice, IconGrid } from "./ui/IconGrid"
import { TextField } from "./ui/TextField"

const RECENT_ICONS_STORAGE_KEY = "ew.recentCategoryIcons.v2"
const RECENT_ICONS_LIMIT = 12
const SEARCH_PAGE_SIZE = 48

function readRecentIcons(): string[] {
  const raw = window.localStorage.getItem(RECENT_ICONS_STORAGE_KEY)
  if (!raw) {
    return []
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    const recent = parsed.filter(
      (item): item is string =>
        typeof item === "string" && isValidPhosphorIconKey(item)
    )
    return recent.slice(0, RECENT_ICONS_LIMIT)
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof DOMException) {
      return []
    }
    throw error
  }
}

function writeRecentIcons(icons: string[]): void {
  try {
    window.localStorage.setItem(RECENT_ICONS_STORAGE_KEY, JSON.stringify(icons))
  } catch (error) {
    if (error instanceof DOMException) {
      return
    }
    throw error
  }
}

function PickerIconGlyph({ iconKey }: { iconKey: string }) {
  const resolvedIconKey = resolvePhosphorIconKey(iconKey)
  const displayIconKey = resolvedIconKey ?? DEFAULT_CATEGORY_ICON_KEY
  const curatedIcon = CURATED_CATEGORY_ICONS[displayIconKey]
  const isCurated = curatedIcon !== undefined
  const [dynamicIcon, setDynamicIcon] = useState<{
    iconKey: string
    iconComponent: PhosphorIcon | null
  }>({ iconKey: displayIconKey, iconComponent: null })

  useEffect(() => {
    if (isCurated) {
      return
    }
    let isActive = true
    loadCsrIcon(displayIconKey).then(
      (icon) => {
        if (isActive) {
          setDynamicIcon({ iconKey: displayIconKey, iconComponent: icon ?? null })
        }
      },
    )
    return () => {
      isActive = false
    }
  }, [displayIconKey, isCurated])

  if (curatedIcon) {
    const CuratedIcon = curatedIcon
    return <CuratedIcon aria-hidden="true" />
  }
  const iconComponent =
    dynamicIcon.iconKey === displayIconKey ? dynamicIcon.iconComponent : null
  if (iconComponent) {
    const Icon = iconComponent
    return <Icon aria-hidden="true" />
  }
  return <CurrencyCircleDollarIcon aria-hidden="true" />
}

// Loaded on demand: searching every Phosphor icon needs the full icon metadata.
// An empty search shows recent picks, then the curated category icons.
export default function IconPicker({ value, onPick }: { value: string | null; onPick: (iconKey: string) => void }) {
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [resultLimit, setResultLimit] = useState(SEARCH_PAGE_SIZE)
  const [recentIcons] = useState<string[]>(() => readRecentIcons())

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedQuery(query), 120)
    return () => window.clearTimeout(timeoutId)
  }, [query])

  const normalizedQuery = debouncedQuery.trim().toLowerCase()
  const searchResults = useMemo(() => {
    if (!normalizedQuery) return []
    const queryParts = normalizedQuery.split(/\s+/).filter((part) => part.length > 0)
    return ALL_PHOSPHOR_ICON_KEYS.filter(
      (iconKey) => iconKey.includes(normalizedQuery) || queryParts.every((part) => ICON_SEARCH_TEXT[iconKey].includes(part))
    )
  }, [normalizedQuery])

  const pick = (iconKey: string) => {
    const resolvedIconKey = resolvePhosphorIconKey(iconKey) ?? DEFAULT_CATEGORY_ICON_KEY
    writeRecentIcons([resolvedIconKey, ...recentIcons.filter((item) => item !== resolvedIconKey)].slice(0, RECENT_ICONS_LIMIT))
    onPick(resolvedIconKey)
  }

  const selectedIconKey = resolvePhosphorIconKey(value)
  const icons = normalizedQuery
    ? searchResults.slice(0, resultLimit)
    : Array.from(new Set([...recentIcons, ...Object.keys(CURATED_CATEGORY_ICONS)]))

  return (
    <>
      <TextField
        autoFocus
        type="search"
        aria-label="Search icons"
        placeholder="Search icons"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setResultLimit(SEARCH_PAGE_SIZE)
        }}
      />
      {icons.length ? (
        <IconGrid label={normalizedQuery ? "Matching icons" : "Suggested icons"}>
          {icons.map((iconKey) => (
            <IconChoice
              key={iconKey}
              label={iconLabel(iconKey)}
              selected={iconKey === selectedIconKey}
              onSelect={() => pick(iconKey)}
            >
              <PickerIconGlyph iconKey={iconKey} />
            </IconChoice>
          ))}
        </IconGrid>
      ) : (
        <EmptyState inline>No icons found.</EmptyState>
      )}
      {normalizedQuery && searchResults.length > resultLimit ? (
        <Button variant="ghost" size="small" onClick={() => setResultLimit((previous) => previous + SEARCH_PAGE_SIZE)}>
          More icons
        </Button>
      ) : null}
    </>
  )
}
