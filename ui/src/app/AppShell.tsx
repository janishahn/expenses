import { Suspense, lazy, useEffect, useMemo, useState } from "react"
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
import { ListIcon } from "@phosphor-icons/react/List"
import { NewspaperIcon } from "@phosphor-icons/react/Newspaper"
import { PlusIcon } from "@phosphor-icons/react/Plus"
import { ShapesIcon } from "@phosphor-icons/react/Shapes"
import { SparkleIcon } from "@phosphor-icons/react/Sparkle"
import { TagIcon } from "@phosphor-icons/react/Tag"
import { TrendUpIcon } from "@phosphor-icons/react/TrendUp"
import { WalletIcon } from "@phosphor-icons/react/Wallet"
import { XIcon } from "@phosphor-icons/react/X"
import { NavLink, Outlet, useLocation } from "react-router-dom"
import ProductMark from "../components/ProductMark"
import ShellThemeQuickToggle from "../components/ShellThemeQuickToggle"
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
  setUtilityAction: (action: AppShellUtilityAction | null) => void
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
  const [addTransactionOpen, setAddTransactionOpen] = useState(false)
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
  const shellTitle = location.pathname === "/assistant" ? "Assistant" : null
  const activeUtilityAction = utilityAction ??
    (addTransactionAvailable
      ? {
          label: "Add transaction",
          onClick: () => setAddTransactionOpen(true),
        }
      : null)
  const UtilityActionIcon = activeUtilityAction?.icon ?? PlusIcon

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      setSidebarOpen(false)
      setAddTransactionOpen(false)
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  useEffect(() => {
    document.body.style.overflow = sidebarOpen || addTransactionOpen ? "hidden" : ""
    return () => {
      document.body.style.overflow = ""
    }
  }, [sidebarOpen, addTransactionOpen])

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
    <div data-testid="app-shell-root" className="min-h-app-screen flex bg-bg">
      <aside
        className={`app-sidebar ${sidebarOpen ? "app-sidebar-open" : ""}`}
        aria-label={isDesktop ? "Application navigation" : "Application menu"}
        aria-hidden={!isDesktop && !sidebarOpen}
      >
        <div className="app-sidebar-brand-row">
          <NavLink
            to={periodSearch ? `/${periodSearch}` : "/"}
            onClick={() => setSidebarOpen(false)}
            data-testid="app-shell-brand"
            className="app-sidebar-brand"
          >
            <ProductMark />
            <span>
              <strong>Expenses</strong>
              <small>Private ledger</small>
            </span>
          </NavLink>
          <button
            type="button"
            className="app-sidebar-close desk:hidden"
            aria-label="Close menu"
            onClick={() => setSidebarOpen(false)}
          >
            <XIcon aria-hidden="true" />
          </button>
        </div>

        {renderNavigation(() => setSidebarOpen(false))}

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
        tabIndex={sidebarOpen ? 0 : -1}
        onClick={() => setSidebarOpen(false)}
      />

      <div
        data-testid="app-shell-content"
        className="min-h-app-screen flex min-w-0 flex-1 flex-col desk:ml-sidebar"
      >
        <header data-testid="app-shell-header" className="app-mobile-header desk:hidden">
          {shellTitle ? (
            <>
              <NavLink
                to={periodSearch ? `/${periodSearch}` : "/"}
                aria-label="Expenses"
                className="flex shrink-0 items-center"
              >
                <ProductMark className="!h-9 !w-9 !rounded-[0.75rem] !p-2" />
              </NavLink>
              <h1 className="truncate font-head text-base font-semibold">
                {shellTitle}
              </h1>
            </>
          ) : (
            <NavLink
              to={periodSearch ? `/${periodSearch}` : "/"}
              className="flex min-w-0 items-center gap-2.5 font-semibold"
            >
              <ProductMark className="!h-9 !w-9 !rounded-[0.75rem] !p-2" />
              <span className="truncate">Expenses</span>
            </NavLink>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {activeUtilityAction ? (
              <button
                type="button"
                data-testid="app-shell-mobile-add-action"
                aria-label={activeUtilityAction.label}
                onClick={activeUtilityAction.onClick}
                className={
                  activeUtilityAction.presentation === "quiet"
                    ? "app-utility-icon transition-[background-color,color,scale] duration-150 ease-out hover:bg-surface-hi hover:text-text active:scale-[0.96]"
                    : "app-mobile-header-action transition-[filter,scale] duration-150 ease-out hover:brightness-105 active:scale-[0.96]"
                }
              >
                <UtilityActionIcon aria-hidden="true" />
                {activeUtilityAction.presentation !== "quiet" ? (
                  <span>{activeUtilityAction.label}</span>
                ) : null}
              </button>
            ) : null}
            {!location.pathname.startsWith("/admin") ? (
              <ShellThemeQuickToggle testId="shell-theme-quick-toggle" size="mobile" />
            ) : null}
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="app-utility-icon"
              aria-label="Open menu"
            >
              <ListIcon aria-hidden="true" />
            </button>
          </div>
        </header>

        <header data-testid="app-shell-utility" className="app-desktop-utility">
          {shellTitle ? (
            <h1 className="truncate font-head text-base font-semibold">
              {shellTitle}
            </h1>
          ) : null}
          <div className="ml-auto flex items-center gap-2.5">
            {!location.pathname.startsWith("/admin") ? (
              <ShellThemeQuickToggle testId="shell-theme-quick-toggle" />
            ) : null}
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
        </header>

        <main
          className="min-w-0 flex-1 px-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-4 desk:px-6 desk:pb-10 desk:pt-4"
        >
          <div className="page-enter mx-auto w-full max-w-[1540px]">
            <Outlet
              context={{
                openAddTransaction: () => setAddTransactionOpen(true),
                setUtilityAction,
              }}
            />
          </div>
        </main>
      </div>

      {addTransactionOpen ? (
        <Suspense fallback={null}>
          <AddTransactionSheet
            open={addTransactionOpen}
            onClose={() => setAddTransactionOpen(false)}
          />
        </Suspense>
      ) : null}
    </div>
  )
}

export default AppShell
