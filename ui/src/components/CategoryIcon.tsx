import { useEffect, useState } from "react"
import { CurrencyCircleDollarIcon } from "@phosphor-icons/react/CurrencyCircleDollar"
import type { Icon as PhosphorIcon } from "@phosphor-icons/react/dist/lib/types"
import {
  CURATED_CATEGORY_ICONS,
  DEFAULT_CATEGORY_ICON_KEY,
} from "./categoryIconsCatalog"

function DynamicCategoryIcon({ iconKey }: { iconKey: string }) {
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
    return <CurrencyCircleDollarIcon />
  }
  const Icon = iconComponent
  return <Icon />
}

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

function resolveCategoryIconKey(icon: string | null, label?: string | null): string {
  const normalizedLabel = label?.trim().toLowerCase() ?? ""
  const labelHash = Array.from(normalizedLabel).reduce(
    (total, character) => total + character.codePointAt(0)!,
    0
  )
  const inferredIcon = normalizedLabel
    ? categoryIconHints.find(([pattern]) => pattern.test(normalizedLabel))?.[1]
    : undefined
  return icon && icon.length > 0 && (
    icon !== DEFAULT_CATEGORY_ICON_KEY || !normalizedLabel
  )
    ? icon
    : inferredIcon ?? (
      normalizedLabel
        ? categoryFallbackIcons[labelHash % categoryFallbackIcons.length]
        : DEFAULT_CATEGORY_ICON_KEY
    )
}

export function CategoryIconSvg({ icon, label }: { icon: string | null; label?: string | null }) {
  const iconKey = resolveCategoryIconKey(icon, label)
  const CuratedIcon = CURATED_CATEGORY_ICONS[iconKey]
  if (CuratedIcon) return <CuratedIcon aria-hidden="true" />
  return <DynamicCategoryIcon iconKey={iconKey} />
}
