import { useEffect, useState } from "react"
import { CurrencyCircleDollarIcon } from "@phosphor-icons/react/CurrencyCircleDollar"
import type { Icon as PhosphorIcon } from "@phosphor-icons/react/dist/lib/types"
import {
  CURATED_CATEGORY_ICONS,
  DEFAULT_CATEGORY_ICON_KEY,
} from "./categoryIconsCatalog"

function DynamicCategoryIcon({
  iconKey,
  className,
}: {
  iconKey: string
  className: string
}) {
  const [loadedIcon, setLoadedIcon] = useState<{
    iconKey: string
    iconComponent: PhosphorIcon | null
  }>({ iconKey, iconComponent: null })

  useEffect(() => {
    let isActive = true
    import("./phosphorRuntime").then(
      ({ loadRuntimeCsrIcon }) => {
        loadRuntimeCsrIcon(iconKey).then((result) => {
          if (isActive) {
            setLoadedIcon({ iconKey, iconComponent: result })
          }
        })
      },
      () => {
        if (isActive) {
          setLoadedIcon({ iconKey, iconComponent: null })
        }
      }
    )
    return () => {
      isActive = false
    }
  }, [iconKey])

  const iconComponent =
    loadedIcon.iconKey === iconKey ? loadedIcon.iconComponent : null

  if (!iconComponent) {
    return <CurrencyCircleDollarIcon className={className} />
  }
  const Icon = iconComponent
  return <Icon className={className} />
}

const signalTones = ["blue", "green", "red", "yellow", "purple", "coral"] as const

const categoryIconHints: Array<[RegExp, string]> = [
  [/uncategorized/, "receipt"],
  [/restaurant|dining|takeaway|brunch/, "fork-knife"],
  [/coffee|cafe/, "coffee"],
  [/housing|rent|home/, "house"],
  [/grocer|food|supermarket/, "shopping-cart"],
  [/transport|transit|bus|train/, "bus"],
  [/travel|flight|holiday|vacation/, "airplane"],
  [/subscription|streaming|membership/, "credit-card"],
  [/health|medical|doctor|pharmacy/, "stethoscope"],
  [/shopping|retail|clothing/, "shopping-cart"],
  [/entertainment|cinema|movie|film/, "film-strip"],
  [/utilit|electric|energy/, "lightning"],
  [/salary|freelance|work/, "briefcase"],
  [/income|interest|investment/, "trend-up"],
  [/education|school|tuition/, "graduation-cap"],
  [/child|baby/, "baby"],
  [/pet|animal/, "dog"],
  [/overall|saving|reserve/, "piggy-bank"],
]

const categoryFallbackIcons = [
  "package",
  "gift",
  "palette",
  "book",
  "globe",
  "receipt",
] as const

export function CategoryIcon({
  icon,
  label,
  className = "",
}: {
  icon: string | null
  label?: string | null
  className?: string
}) {
  const normalizedLabel = label?.trim().toLowerCase() ?? ""
  const labelHash = Array.from(normalizedLabel).reduce(
    (total, character) => total + character.codePointAt(0)!,
    0
  )
  const inferredIcon = normalizedLabel
    ? categoryIconHints.find(([pattern]) => pattern.test(normalizedLabel))?.[1]
    : undefined
  const iconKey = icon && icon.length > 0 && (
    icon !== DEFAULT_CATEGORY_ICON_KEY || !normalizedLabel
  )
    ? icon
    : inferredIcon ?? (
      normalizedLabel
        ? categoryFallbackIcons[labelHash % categoryFallbackIcons.length]
        : DEFAULT_CATEGORY_ICON_KEY
    )
  const CuratedIcon = CURATED_CATEGORY_ICONS[iconKey]
  const toneKey = normalizedLabel ? `${iconKey}:${normalizedLabel}` : iconKey
  const toneIndex = Array.from(toneKey).reduce(
    (total, character) => total + character.codePointAt(0)!,
    0
  ) % signalTones.length
  return (
    <span
      data-testid="category-icon"
      data-category-icon={iconKey}
      data-signal-tone={signalTones[toneIndex]}
      className={`category-icon-tile ${className}`.trim()}
    >
      {CuratedIcon ? (
        <CuratedIcon className="h-4 w-4" />
      ) : (
        <DynamicCategoryIcon
          iconKey={iconKey}
          className="h-4 w-4"
        />
      )}
    </span>
  )
}
