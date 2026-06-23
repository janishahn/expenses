import { useEffect, useState } from "react"
import type { MouseEventHandler, ReactNode } from "react"
import { Link, useLocation } from "react-router-dom"
import ShellThemeQuickToggle from "./ShellThemeQuickToggle"

type PageIntroProps = {
  title: ReactNode
  titleAccessory?: ReactNode
  titleAccessoryAlign?: "inline" | "end"
  actions?: ReactNode
  backHref?: string
  backLabel?: ReactNode
  backState?: unknown
  backReplace?: boolean
  backOnClick?: MouseEventHandler<HTMLAnchorElement>
}

function PageIntro({
  title,
  titleAccessory,
  titleAccessoryAlign = "inline",
  actions,
  backHref,
  backLabel,
  backState,
  backReplace,
  backOnClick,
}: PageIntroProps) {
  const location = useLocation()
  const [isDesktop, setIsDesktop] = useState(() =>
    window.matchMedia("(min-width: 861px)").matches
  )
  const showDesktopThemeQuickToggle =
    isDesktop && !location.pathname.startsWith("/admin")

  useEffect(() => {
    const media = window.matchMedia("(min-width: 861px)")
    const syncDesktop = () => setIsDesktop(media.matches)
    syncDesktop()
    media.addEventListener("change", syncDesktop)
    return () => media.removeEventListener("change", syncDesktop)
  }, [])

  return (
    <div className="space-y-2.5">
      {backHref && backLabel ? (
        <Link
          to={backHref}
          state={backState}
          replace={backReplace}
          onClick={backOnClick}
          className="page-breadcrumb"
        >
          {backLabel}
        </Link>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-3.5">
        <div
          className={
            titleAccessoryAlign === "end" ? "min-w-0 flex-1" : "min-w-0"
          }
        >
          <div
            className={
              titleAccessoryAlign === "end"
                ? "flex w-full items-center justify-between gap-3"
                : "flex flex-wrap items-center gap-3"
            }
          >
            <h1 className="page-title">{title}</h1>
            {titleAccessory}
          </div>
        </div>

        {actions || showDesktopThemeQuickToggle ? (
          <div className="flex w-full flex-wrap items-center gap-2.5 desk:w-auto desk:justify-end">
            {actions}
            {showDesktopThemeQuickToggle ? (
              <ShellThemeQuickToggle testId="shell-theme-quick-toggle" />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default PageIntro
