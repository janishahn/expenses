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

export function CategoryIcon({ icon }: { icon: string | null }) {
  const iconKey = icon && icon.length > 0 ? icon : DEFAULT_CATEGORY_ICON_KEY
  const CuratedIcon = CURATED_CATEGORY_ICONS[iconKey]
  return (
    <span
      data-testid="category-icon"
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-surface-hi/85 shadow-[inset_0_1px_0_rgb(var(--surface-highlight)_/_0.1),0_12px_24px_-20px_rgb(var(--bg)_/_0.62)] md:h-9 md:w-9"
    >
      {CuratedIcon ? (
        <CuratedIcon className="h-4 w-4 text-text/80 md:h-4 md:w-4" />
      ) : (
        <DynamicCategoryIcon
          iconKey={iconKey}
          className="h-4 w-4 text-text/80 md:h-4 md:w-4"
        />
      )}
    </span>
  )
}
