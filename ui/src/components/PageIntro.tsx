import type { MouseEventHandler, ReactNode } from "react"
import { Link } from "react-router-dom"

type PageIntroProps = {
  title: ReactNode
  titleAccessory?: ReactNode
  titleAccessoryAlign?: "inline" | "end"
  actions?: ReactNode
  // Compact action clusters (icon buttons) share the title row on mobile
  // instead of the default full-width row beneath it.
  inlineActions?: boolean
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
  inlineActions = false,
  backHref,
  backLabel,
  backState,
  backReplace,
  backOnClick,
}: PageIntroProps) {
  return (
    <div className="page-intro space-y-2">
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

      <div
        className={
          inlineActions
            ? "flex flex-wrap items-center justify-between gap-x-3 gap-y-3.5"
            : "flex flex-wrap items-start justify-between gap-x-3 gap-y-3.5"
        }
      >
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

        {actions ? (
          <div
            className={
              inlineActions
                ? "ml-auto flex flex-wrap items-center justify-end gap-2.5"
                : "flex w-full flex-wrap items-center justify-end gap-2.5 desk:w-auto"
            }
          >
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default PageIntro
