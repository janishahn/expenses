import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/ArrowsClockwise"
import { BankIcon } from "@phosphor-icons/react/Bank"
import { ChartLineIcon } from "@phosphor-icons/react/ChartLine"
import { ChatCircleDotsIcon } from "@phosphor-icons/react/ChatCircleDots"
import { FileTextIcon } from "@phosphor-icons/react/FileText"
import { FingerprintIcon } from "@phosphor-icons/react/Fingerprint"
import { FlaskIcon } from "@phosphor-icons/react/Flask"
import { GearIcon } from "@phosphor-icons/react/Gear"
import { HouseIcon } from "@phosphor-icons/react/House"
import { LightningIcon } from "@phosphor-icons/react/Lightning"
import { ListBulletsIcon } from "@phosphor-icons/react/ListBullets"
import { NewspaperIcon } from "@phosphor-icons/react/Newspaper"
import { PlusIcon } from "@phosphor-icons/react/Plus"
import { ShapesIcon } from "@phosphor-icons/react/Shapes"
import { SparkleIcon } from "@phosphor-icons/react/Sparkle"
import { TagIcon } from "@phosphor-icons/react/Tag"
import { TrendUpIcon } from "@phosphor-icons/react/TrendUp"
import { WalletIcon } from "@phosphor-icons/react/Wallet"
import { XIcon } from "@phosphor-icons/react/X"
import { NavLink, Outlet, useLocation } from "react-router-dom"
import ConfirmDialogHost from "../components/ConfirmDialogHost"
import ProductMark from "../components/ProductMark"
import { useAuth } from "./auth"

const AddTransactionSheet = lazy(() => import("./AddTransactionSheet"))

type NavigationItem = {
  to: string
  label: string
  icon: typeof HouseIcon
  end?: boolean
  llm?: boolean
  admin?: boolean
}

const navigationGroups: Array<{ label: string; items: NavigationItem[] }> = [
  {
    label: "Overview",
    items: [
      { to: "/", label: "Dashboard", icon: HouseIcon, end: true },
      { to: "/transactions", label: "Transactions", icon: ListBulletsIcon },
      { to: "/budgets", label: "Budgets", icon: WalletIcon },
      { to: "/forecast", label: "Forecast", icon: TrendUpIcon },
    ],
  },
  {
    label: "Understand",
    items: [
      { to: "/insights", label: "Insights", icon: ChartLineIcon },
      { to: "/digest", label: "Digest", icon: NewspaperIcon },
      { to: "/assistant", label: "Assistant", icon: ChatCircleDotsIcon, llm: true },
    ],
  },
  {
    label: "Manage",
    items: [
      { to: "/recurring", label: "Recurring", icon: ArrowsClockwiseIcon },
      { to: "/templates", label: "Templates", icon: LightningIcon },
      { to: "/rules", label: "Rules", icon: SparkleIcon },
      { to: "/categories", label: "Categories", icon: ShapesIcon },
      { to: "/tags", label: "Tags", icon: TagIcon },
    ],
  },
  {
    label: "System",
    items: [
      { to: "/scenarios", label: "What If", icon: FlaskIcon },
      { to: "/reconciliation", label: "Reconcile", icon: BankIcon },
      { to: "/reports/builder", label: "Reports", icon: FileTextIcon },
      { to: "/settings", label: "Settings", icon: GearIcon },
      { to: "/admin", label: "Admin", icon: FingerprintIcon, admin: true },
    ],
  },
]

export type AppShellOutletContext = {
  openAddTransaction: () => void
  openMobileNavigation: (trigger: HTMLButtonElement) => void
  setUtilityAction: (action: AppShellUtilityAction | null) => void
  utilityAction: AppShellUtilityAction | null
}

export type AppShellUtilityAction = {
  label: string
  onClick: () => void
  icon?: typeof PlusIcon
  presentation?: "primary" | "quiet"
}

function AppShell() {
  const location = useLocation()
  const { user, llmEnabled } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const sidebarRef = useRef<HTMLElement | null>(null)
  const shellContentRef = useRef<HTMLDivElement | null>(null)
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [sidebarCloseCount, setSidebarCloseCount] = useState(0)
  const [addTransactionOpen, setAddTransactionOpen] = useState(false)
  // Stays mounted after the first open so the dialog's exit animation can
  // play; Radix only animates content that is still in the tree on close.
  const [addTransactionMounted, setAddTransactionMounted] = useState(false)
  const openAddTransaction = () => {
    setAddTransactionMounted(true)
    setAddTransactionOpen(true)
  }
  const [utilityAction, setUtilityAction] = useState<AppShellUtilityAction | null>(null)
  const [isDesktop, setIsDesktop] = useState(() =>
    window.matchMedia("(min-width: 861px)").matches
  )

  const periodSearch = useMemo(() => {
    const input = new URLSearchParams(location.search)
    const output = new URLSearchParams()
    for (const key of ["period", "start", "end"]) {
      const value = input.get(key)
      if (value) output.set(key, value)
    }
    const query = output.toString()
    return query ? `?${query}` : ""
  }, [location.search])

  const visibleGroups = useMemo(
    () =>
      navigationGroups.map((group) => ({
        ...group,
        items: group.items.filter(
          (item) => (!item.llm || llmEnabled) && (!item.admin || user?.is_admin)
        ),
      })),
    [llmEnabled, user?.is_admin]
  )

  const addTransactionAvailable =
    location.pathname === "/" || location.pathname === "/transactions"
  const activeUtilityAction = utilityAction ??
    (addTransactionAvailable
      ? {
          label: "Add transaction",
          onClick: openAddTransaction,
        }
      : null)
  const UtilityActionIcon = activeUtilityAction?.icon ?? PlusIcon
  const mobileFabAction =
    activeUtilityAction?.presentation === "quiet" ? null : activeUtilityAction

  const closeSidebar = useCallback(() => {
    setSidebarOpen(false)
    setSidebarCloseCount((count) => count + 1)
  }, [])

  const openMobileNavigation = useCallback((trigger: HTMLButtonElement) => {
    menuTriggerRef.current = trigger
    setSidebarOpen(true)
  }, [])

  useEffect(() => {
    if (sidebarOpen || sidebarCloseCount === 0) return
    const animationFrame = requestAnimationFrame(() => menuTriggerRef.current?.focus())
    return () => cancelAnimationFrame(animationFrame)
  }, [sidebarCloseCount, sidebarOpen])

  useEffect(() => {
    if (isDesktop || !sidebarOpen) return
    const sidebar = sidebarRef.current
    const shellContent = shellContentRef.current
    if (!sidebar || !shellContent) return

    shellContent.inert = true
    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const getFocusable = () =>
      Array.from(sidebar.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (element) => !element.hidden
      )
    const focusFirst = () => {
      if (
        sidebar.getAttribute("aria-hidden") === "false" &&
        !sidebar.contains(document.activeElement)
      ) {
        getFocusable()[0]?.focus()
      }
    }
    const focusTimer = window.setTimeout(focusFirst, 300)

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        closeSidebar()
        return
      }
      if (event.key !== "Tab") return
      const focusable = getFocusable()
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener("keydown", handleKeyDown)
      shellContent.inert = false
    }
  }, [closeSidebar, isDesktop, sidebarOpen])

  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? "hidden" : ""
    return () => {
      document.body.style.overflow = ""
    }
  }, [sidebarOpen])

  useEffect(() => {
    const media = window.matchMedia("(min-width: 861px)")
    const syncDesktop = () => {
      setIsDesktop(media.matches)
      if (media.matches) setSidebarOpen(false)
    }
    syncDesktop()
    media.addEventListener("change", syncDesktop)
    return () => media.removeEventListener("change", syncDesktop)
  }, [])

  const renderNavigation = (onNavigate: () => void) => (
    <nav className="sidebar-nav-scroll app-sidebar-nav" aria-label="Primary">
      {visibleGroups.map((group) => (
        <div key={group.label} className="app-sidebar-group-wrap">
          <p className="app-sidebar-group">{group.label}</p>
          <div className="space-y-0.5">
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={periodSearch ? `${item.to}${periodSearch}` : item.to}
                end={item.end}
                onClick={onNavigate}
                className={({ isActive }) =>
                  `app-sidebar-link ${isActive ? "app-sidebar-link-active" : ""}`
                }
              >
                <item.icon aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  )

  return (
    <div data-testid="app-shell-root" className="app-shell-root min-h-app-screen flex bg-bg">
      <aside
        ref={sidebarRef}
        className={`app-sidebar ${sidebarOpen ? "app-sidebar-open" : ""}`}
        aria-label={isDesktop ? "Application navigation" : "Application menu"}
        aria-hidden={!isDesktop && !sidebarOpen}
      >
        <div className="app-sidebar-brand-row">
          <NavLink
            to={periodSearch ? `/${periodSearch}` : "/"}
            onClick={closeSidebar}
            data-testid="app-shell-brand"
            className="app-sidebar-brand"
          >
            <ProductMark />
            <span>
              <strong>Expenses</strong>
            </span>
          </NavLink>
          <button
            type="button"
            className="app-sidebar-close desk:hidden"
            aria-label="Close menu"
            onClick={closeSidebar}
          >
            <XIcon aria-hidden="true" />
          </button>
        </div>

        {renderNavigation(closeSidebar)}

        <div className="app-sidebar-user">
          <span>{user?.username?.slice(0, 1).toUpperCase() ?? "E"}</span>
          <div>
            <strong>{user?.username ?? "Account"}</strong>
            <small>{user?.is_admin ? "Administrator" : "Household member"}</small>
          </div>
        </div>
      </aside>

      <button
        type="button"
        className={`app-mobile-menu-backdrop desk:hidden ${
          sidebarOpen ? "app-mobile-menu-backdrop-open" : ""
        }`}
        aria-label="Dismiss menu"
        aria-hidden={!sidebarOpen}
        tabIndex={-1}
        onClick={closeSidebar}
      />

      <div
        ref={shellContentRef}
        data-testid="app-shell-content"
        className="min-h-app-screen flex min-w-0 flex-1 flex-col desk:ml-sidebar"
      >
        <header data-testid="app-shell-utility" className="app-desktop-utility">
          <div className="app-content-frame app-desktop-utility-inner">
            <div className="ml-auto flex items-center gap-2.5">
              {activeUtilityAction ? (
                <button
                  type="button"
                  aria-label={activeUtilityAction.label}
                  onClick={activeUtilityAction.onClick}
                  className={
                    activeUtilityAction.presentation === "quiet"
                      ? "app-utility-icon transition-[background-color,color,scale] duration-150 ease-out hover:bg-surface-hi hover:text-text active:scale-[0.96]"
                      : "app-utility-action transition-[filter,scale] duration-150 ease-out hover:brightness-105 active:scale-[0.96]"
                  }
                >
                  <UtilityActionIcon aria-hidden="true" />
                  {activeUtilityAction.presentation !== "quiet" ? (
                    <span>{activeUtilityAction.label}</span>
                  ) : null}
                </button>
              ) : null}
            </div>
          </div>
        </header>

        <main
          className={`min-w-0 flex-1 px-3 pt-4 desk:px-6 desk:pb-10 desk:pt-4 ${
            mobileFabAction
              ? "pb-[calc(5.75rem+env(safe-area-inset-bottom,0px))]"
              : "pb-[calc(1rem+env(safe-area-inset-bottom,0px))]"
          }`}
        >
          <div className="app-content-frame page-enter">
            <Outlet
              context={{
                openAddTransaction,
                openMobileNavigation,
                setUtilityAction,
                utilityAction: activeUtilityAction,
              }}
            />
          </div>
        </main>

        {mobileFabAction ? (
          <button
            type="button"
            data-testid="app-shell-mobile-add-action"
            aria-label={mobileFabAction.label}
            onClick={mobileFabAction.onClick}
            className="app-mobile-fab desk:hidden"
          >
            <UtilityActionIcon aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {addTransactionMounted ? (
        <Suspense fallback={null}>
          <AddTransactionSheet
            open={addTransactionOpen}
            onClose={() => setAddTransactionOpen(false)}
          />
        </Suspense>
      ) : null}
      <ConfirmDialogHost />
    </div>
  )
}

export default AppShell
