import type { MouseEventHandler, ReactNode } from "react"
import { ArrowLeftIcon } from "@phosphor-icons/react/ArrowLeft"
import { ListIcon } from "@phosphor-icons/react/List"
import { PlusIcon } from "@phosphor-icons/react/Plus"
import { Link, useOutletContext } from "react-router-dom"
import type { AppShellOutletContext } from "../app/AppShell"

type PageIntroProps = {
  title: ReactNode
  description?: ReactNode
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
  description,
  titleAccessory,
  titleAccessoryAlign = "inline",
  actions,
  backHref,
  backLabel,
  backState,
  backReplace,
  backOnClick,
}: PageIntroProps) {
  const { openMobileNavigation, utilityAction } =
    useOutletContext<AppShellOutletContext>()
  const quietAction = utilityAction?.presentation === "quiet" ? utilityAction : null
  const QuietActionIcon = quietAction?.icon ?? PlusIcon
  const backAriaLabel =
    typeof backLabel === "string" ? backLabel.replace(/^←\s*/, "") : "Back"

  return (
    <div className="page-intro space-y-2">
      {backHref && backLabel ? (
        <Link
          to={backHref}
          state={backState}
          replace={backReplace}
          onClick={backOnClick}
          className="page-breadcrumb hidden desk:inline-flex"
        >
          {backLabel}
        </Link>
      ) : null}

      <div
        className="flex flex-wrap items-start justify-between gap-x-3 gap-y-3.5"
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
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              {backHref ? (
                <Link
                  to={backHref}
                  state={backState}
                  replace={backReplace}
                  onClick={backOnClick}
                  className="app-mobile-page-nav desk:hidden"
                  aria-label={backAriaLabel}
                >
                  <ArrowLeftIcon weight="bold" aria-hidden="true" />
                </Link>
              ) : (
                <button
                  type="button"
                  className="app-mobile-page-nav desk:hidden"
                  aria-label="Open menu"
                  onClick={(event) => openMobileNavigation(event.currentTarget)}
                >
                  <ListIcon weight="bold" aria-hidden="true" />
                </button>
              )}
              <h1 className="page-title">{title}</h1>
              {titleAccessoryAlign === "inline" ? titleAccessory : null}
            </div>
            {titleAccessoryAlign === "end" ? titleAccessory : null}
            {quietAction ? (
              <button
                type="button"
                data-testid="app-shell-mobile-quiet-action"
                className="app-mobile-page-nav ml-auto desk:hidden"
                aria-label={quietAction.label}
                onClick={quietAction.onClick}
              >
                <QuietActionIcon weight="bold" aria-hidden="true" />
              </button>
            ) : null}
          </div>
          {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
        </div>

        {actions ? (
          <div
            className="flex w-full flex-wrap items-center justify-end gap-2.5 desk:w-auto"
          >
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default PageIntro
