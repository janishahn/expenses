import { PlusIcon } from "@phosphor-icons/react/Plus"
import { Outlet, useOutletContext } from "react-router-dom"
import type { AppShellOutletContext } from "./AppShell"

// Hosts pages that still use the previous page components inside the new frame:
// a scrolling area with the page's utility action above it. Pages leave this
// layout as they move to the kit.
function LegacyLayout() {
  const context = useOutletContext<AppShellOutletContext>()
  const action = context.utilityAction
  const ActionIcon = action?.icon ?? PlusIcon
  return (
    <div className="min-h-0 flex-1 overflow-auto px-3 pb-6 pt-3 desk:px-6">
      <div className="app-content-frame">
        {action ? (
          <div
            data-testid="app-shell-utility"
            className="flex justify-end pb-2"
          >
            <button
              type="button"
              aria-label={action.label}
              onClick={action.onClick}
              className={action.presentation === "quiet" ? "app-utility-icon" : "app-utility-action"}
            >
              <ActionIcon aria-hidden="true" />
              {action.presentation !== "quiet" ? <span>{action.label}</span> : null}
            </button>
          </div>
        ) : null}
        <Outlet context={context} />
      </div>
    </div>
  )
}

export default LegacyLayout
