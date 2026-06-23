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
} from "./categoryIconsCatalog"

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

function PickerIconGlyph({ iconKey, className }: { iconKey: string; className: string }) {
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
    return <CuratedIcon className={className} />
  }
  const iconComponent =
    dynamicIcon.iconKey === displayIconKey ? dynamicIcon.iconComponent : null
  if (iconComponent) {
    const Icon = iconComponent
    return <Icon className={className} />
  }
  return <CurrencyCircleDollarIcon className={className} />
}

export function IconPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (icon: string) => void
}) {
  const [mode, setMode] = useState<"quick" | "search">("quick")
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [resultLimit, setResultLimit] = useState(SEARCH_PAGE_SIZE)
  const [recentIcons, setRecentIcons] = useState<string[]>(() => readRecentIcons())

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedQuery(query)
    }, 120)
    return () => window.clearTimeout(timeoutId)
  }, [query])

  const normalizedQuery = debouncedQuery.trim().toLowerCase()
  const searchResults = useMemo(() => {
    if (!normalizedQuery) {
      return ALL_PHOSPHOR_ICON_KEYS
    }
    const queryParts = normalizedQuery.split(/\s+/).filter((part) => part.length > 0)
    return ALL_PHOSPHOR_ICON_KEYS.filter((iconKey) => {
      const haystack = ICON_SEARCH_TEXT[iconKey]
      if (iconKey.includes(normalizedQuery)) {
        return true
      }
      return queryParts.every((part) => haystack.includes(part))
    })
  }, [normalizedQuery])

  const visibleSearchResults = searchResults.slice(0, resultLimit)

  const applyIcon = (iconKey: string) => {
    const resolvedIconKey = resolvePhosphorIconKey(iconKey) ?? DEFAULT_CATEGORY_ICON_KEY
    onChange(resolvedIconKey)
    const next = [
      resolvedIconKey,
      ...recentIcons.filter((item) => item !== resolvedIconKey),
    ].slice(
      0,
      RECENT_ICONS_LIMIT
    )
    setRecentIcons(next)
    writeRecentIcons(next)
  }

  const quickIcons = Array.from(
    new Set([
      ...recentIcons.filter((iconKey) => {
        const resolvedIconKey = resolvePhosphorIconKey(iconKey)
        return resolvedIconKey ? Boolean(CURATED_CATEGORY_ICONS[resolvedIconKey]) : false
      }),
      ...Object.keys(CURATED_CATEGORY_ICONS),
    ])
  )
  const selectedIconKey =
    resolvePhosphorIconKey(value) ?? DEFAULT_CATEGORY_ICON_KEY

  useEffect(() => {
    if (value.length > 0 && !isValidPhosphorIconKey(value)) {
      onChange(DEFAULT_CATEGORY_ICON_KEY)
    }
  }, [onChange, value])

  return (
    <div className="space-y-2">
      <div className="ptabs">
        <button
          type="button"
          onClick={() => setMode("quick")}
          className={`ptab ${mode === "quick" ? "ptab-active" : ""}`}
        >
          Quick picks
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("search")
            setResultLimit(SEARCH_PAGE_SIZE)
          }}
          className={`ptab ${mode === "search" ? "ptab-active" : ""}`}
        >
          Search all
        </button>
      </div>

      <div className="rounded-lg border border-border bg-surface-hi/70 px-2.5 py-1.5 text-xs text-muted">
        Selected: <span className="font-semibold text-text">{selectedIconKey}</span>
      </div>

      {mode === "quick" ? (
        <div className="space-y-2">
          {recentIcons.length ? (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase text-muted">Recent</p>
              <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-6 md:grid-cols-8">
                {recentIcons.map((iconKey) => (
                  <button
                    key={`recent-${iconKey}`}
                    type="button"
                    onClick={() => applyIcon(iconKey)}
                    aria-label={`Pick icon ${iconKey}`}
                    className={`flex h-11 w-11 items-center justify-center rounded-md border transition ${
                      value === iconKey
                        ? "border-accent bg-accent-dim"
                        : "border-border/85 hover:bg-faint"
                    }`}
                  >
                    <PickerIconGlyph
                      iconKey={iconKey}
                      className={`h-4 w-4 ${value === iconKey ? "text-accent" : "text-muted"}`}
                    />
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-6 md:grid-cols-8">
            {quickIcons.map((iconKey) => (
              <button
                key={iconKey}
                type="button"
                onClick={() => applyIcon(iconKey)}
                aria-label={`Pick icon ${iconKey}`}
                className={`flex h-11 w-11 items-center justify-center rounded-md border transition ${
                  value === iconKey
                    ? "border-accent bg-accent-dim"
                    : "border-border/70 hover:bg-faint"
                }`}
              >
                <PickerIconGlyph
                  iconKey={iconKey}
                  className={`h-4 w-4 ${value === iconKey ? "text-accent" : "text-muted"}`}
                />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setResultLimit(SEARCH_PAGE_SIZE)
            }}
            className="w-full field"
            placeholder="Search icons (e.g. groceries, salary, transport)"
            aria-label="Search all icons"
          />
          <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-6 md:grid-cols-8">
            {visibleSearchResults.map((iconKey) => (
              <button
                key={iconKey}
                type="button"
                onClick={() => applyIcon(iconKey)}
                aria-label={`Pick icon ${iconKey}`}
                title={iconKey}
                className={`flex h-11 w-11 items-center justify-center rounded-md border transition ${
                  value === iconKey
                    ? "border-accent bg-accent-dim"
                    : "border-border/70 hover:bg-faint"
                }`}
              >
                <PickerIconGlyph
                  iconKey={iconKey}
                  className={`h-4 w-4 ${value === iconKey ? "text-accent" : "text-muted"}`}
                />
              </button>
            ))}
          </div>
          {searchResults.length > resultLimit ? (
            <button
              type="button"
              onClick={() => setResultLimit((prev) => prev + SEARCH_PAGE_SIZE)}
              className="btn-inline"
            >
              Load more icons
            </button>
          ) : null}
          {!searchResults.length ? (
            <p className="text-xs text-muted">No icons found for this query.</p>
          ) : null}
        </div>
      )}

    </div>
  )
}
