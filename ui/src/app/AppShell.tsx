import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react"
import { FileTextIcon } from "@phosphor-icons/react/FileText"
import { SquaresFourIcon } from "@phosphor-icons/react/SquaresFour"
import { ChartLineIcon } from "@phosphor-icons/react/ChartLine"
import { ListBulletsIcon } from "@phosphor-icons/react/ListBullets"
import { ListIcon } from "@phosphor-icons/react/List"
import { NewspaperIcon } from "@phosphor-icons/react/Newspaper"
import { PlusIcon } from "@phosphor-icons/react/Plus"
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/ArrowsClockwise"
import { BankIcon } from "@phosphor-icons/react/Bank"
import { GearIcon } from "@phosphor-icons/react/Gear"
import { FingerprintIcon } from "@phosphor-icons/react/Fingerprint"
import { ShapesIcon } from "@phosphor-icons/react/Shapes"
import { SparkleIcon } from "@phosphor-icons/react/Sparkle"
import { TagIcon } from "@phosphor-icons/react/Tag"
import { TrendUpIcon } from "@phosphor-icons/react/TrendUp"
import { WalletIcon } from "@phosphor-icons/react/Wallet"
import { LightningIcon } from "@phosphor-icons/react/Lightning"
import { FlaskIcon } from "@phosphor-icons/react/Flask"
import { NavLink, Outlet, useLocation } from "react-router-dom"
import ShellThemeQuickToggle from "../components/ShellThemeQuickToggle"
import { Button } from "../components/ui/button"
import { useAuth } from "./auth"
const AddTransactionSheet = lazy(() => import("./AddTransactionSheet"))

const mainNav = [
  { to: "/", label: "Dashboard", icon: SquaresFourIcon, end: true },
  { to: "/transactions", label: "Transactions", icon: ListBulletsIcon },
  { to: "/insights", label: "Insights", icon: ChartLineIcon },
  { to: "/forecast", label: "Forecast", icon: TrendUpIcon },
  { to: "/budgets", label: "Budgets", icon: WalletIcon },
  { to: "/digest", label: "Digest", icon: NewspaperIcon },
]

const manageNav = [
  { to: "/recurring", label: "Recurring", icon: ArrowsClockwiseIcon },
  { to: "/templates", label: "Templates", icon: LightningIcon },
  { to: "/rules", label: "Rules", icon: SparkleIcon },
  { to: "/categories", label: "Categories", icon: ShapesIcon },
  { to: "/tags", label: "Tags", icon: TagIcon },
]

const toolsNavBase = [
  { to: "/scenarios", label: "What If", icon: FlaskIcon },
  { to: "/reconciliation", label: "Reconcile", icon: BankIcon },
  { to: "/reports/builder", label: "Reports", icon: FileTextIcon },
  { to: "/settings", label: "Settings", icon: GearIcon },
]

const adminNavItem = { to: "/admin", label: "Admin", icon: FingerprintIcon }

export type AppShellOutletContext = {
  openAddTransaction: () => void
}

function AppShell() {
  const location = useLocation()
  const { user } = useAuth()
  const toolsNav = user?.is_admin ? [...toolsNavBase, adminNavItem] : toolsNavBase
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [addTransactionOpen, setAddTransactionOpen] = useState(false)
  const [mobileFieldFocused, setMobileFieldFocused] = useState(false)
  const [isDesktop, setIsDesktop] = useState(() =>
    window.matchMedia("(min-width: 861px)").matches
  )
  const [sidebarScrollActive, setSidebarScrollActive] = useState(false)
  const sidebarScrollTimeoutRef = useRef<number | null>(null)

  const periodSearch = useMemo(() => {
    const input = new URLSearchParams(location.search)
    const output = new URLSearchParams()
    const period = input.get("period")
    const start = input.get("start")
    const end = input.get("end")
    if (period) output.set("period", period)
    if (start) output.set("start", start)
    if (end) output.set("end", end)
    const query = output.toString()
    return query ? `?${query}` : ""
  }, [location.search])

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
    document.body.style.overflow =
      sidebarOpen || addTransactionOpen ? "hidden" : ""
    return () => {
      document.body.style.overflow = ""
    }
  }, [sidebarOpen, addTransactionOpen])

  useEffect(() => {
    const media = window.matchMedia("(min-width: 861px)")
    const syncDesktop = () => setIsDesktop(media.matches)
    syncDesktop()
    media.addEventListener("change", syncDesktop)
    return () => media.removeEventListener("change", syncDesktop)
  }, [])

  useEffect(() => {
    function syncFocusedField(target: EventTarget | Element | null) {
      if (isDesktop) {
        setMobileFieldFocused(false)
        return
      }
      const element = target instanceof Element ? target : null
      setMobileFieldFocused(
        Boolean(
          element &&
            document.contains(element) &&
            element.closest("input, textarea, select, [contenteditable='true']")
        )
      )
    }

    function onFocusIn(event: FocusEvent) {
      syncFocusedField(event.target)
    }

    function onFocusOut() {
      window.setTimeout(() => syncFocusedField(document.activeElement), 0)
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        window.setTimeout(() => syncFocusedField(document.activeElement), 0)
      }
    }

    document.addEventListener("focusin", onFocusIn)
    document.addEventListener("focusout", onFocusOut)
    document.addEventListener("keydown", onKeyDown)
    syncFocusedField(document.activeElement)

    return () => {
      document.removeEventListener("focusin", onFocusIn)
      document.removeEventListener("focusout", onFocusOut)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [isDesktop])

  useEffect(() => {
    return () => {
      if (sidebarScrollTimeoutRef.current !== null) {
        window.clearTimeout(sidebarScrollTimeoutRef.current)
      }
    }
  }, [])

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `group relative flex items-center gap-[10px] rounded-full px-3.5 py-2.5 text-[13.5px] font-semibold transition ${
      isActive
        ? "bg-surface-hi text-text shadow-[var(--shadow-soft)]"
        : "text-muted hover:bg-faint/80 hover:text-text"
    }`
  const shellRailClass = "h-[64px] shrink-0 border-b border-border/80"
  const showShellThemeQuickToggle = !location.pathname.startsWith("/admin")

  const navIndicator = (isActive: boolean) =>
    isActive ? (
      <span className="absolute left-2 h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_18px_rgb(var(--accent)_/_0.55)]" />
    ) : null

  const handleSidebarScroll = () => {
    setSidebarScrollActive(true)
    if (sidebarScrollTimeoutRef.current !== null) {
      window.clearTimeout(sidebarScrollTimeoutRef.current)
    }
    sidebarScrollTimeoutRef.current = window.setTimeout(() => {
      setSidebarScrollActive(false)
      sidebarScrollTimeoutRef.current = null
    }, 720)
  }

  return (
    <div data-testid="app-shell-root" className="min-h-app-screen flex">
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-sidebar flex-col overflow-x-hidden border-r border-border/80 bg-surface/90 backdrop-blur-xl shadow-[var(--shadow-raised)] transition-transform duration-[280ms] ease-[cubic-bezier(.4,0,.2,1)] desk:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <NavLink
          to={periodSearch ? `/${periodSearch}` : "/"}
          onClick={() => setSidebarOpen(false)}
          data-testid="app-shell-brand"
          className={`flex select-none items-center gap-3 px-5 font-head text-[17px] font-extrabold tracking-[-0.04em] ${shellRailClass}`}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-accent text-[13px] font-bold text-bg shadow-[var(--shadow-accent)]">
            E
          </span>
          <span>Expenses</span>
        </NavLink>

        <nav
          onScroll={handleSidebarScroll}
          className={`sidebar-nav-scroll flex flex-1 flex-col gap-1 overflow-y-auto px-3 pt-3 pb-3 desk:pb-1 ${
            sidebarScrollActive ? "sidebar-nav-scroll-active" : ""
          }`}
        >
          <p className="px-3 pb-[5px] pt-[14px] text-[10px] font-bold uppercase tracking-[1.3px] text-muted">
            Main
          </p>
          {mainNav.map((item) => (
            <NavLink
              key={item.to}
              to={periodSearch ? `${item.to}${periodSearch}` : item.to}
              end={item.end}
              onClick={() => setSidebarOpen(false)}
              className={navLinkClass}
            >
              {({ isActive }) => (
                <>
                  {navIndicator(isActive)}
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </>
              )}
            </NavLink>
          ))}

          <p className="px-3 pb-[5px] pt-[14px] text-[10px] font-bold uppercase tracking-[1.3px] text-muted">
            Manage
          </p>
          {manageNav.map((item) => (
            <NavLink
              key={item.to}
              to={periodSearch ? `${item.to}${periodSearch}` : item.to}
              onClick={() => setSidebarOpen(false)}
              className={navLinkClass}
            >
              {({ isActive }) => (
                <>
                  {navIndicator(isActive)}
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </>
              )}
            </NavLink>
          ))}

          <p className="px-3 pb-[5px] pt-[14px] text-[10px] font-bold uppercase tracking-[1.3px] text-muted">
            Tools
          </p>
          {toolsNav.map((item) => (
            <NavLink
              key={item.to}
              to={periodSearch ? `${item.to}${periodSearch}` : item.to}
              onClick={() => setSidebarOpen(false)}
              className={navLinkClass}
            >
              {({ isActive }) => (
                <>
                  {navIndicator(isActive)}
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </>
              )}
            </NavLink>
          ))}

        </nav>
      </aside>

      {sidebarOpen && (
        <Button
          type="button"
          variant="unstyled"
          size="legacy"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-y-0 right-0 left-sidebar z-40 bg-bg/64 backdrop-blur-[2px] desk:hidden"
          aria-label="Close sidebar"
        />
      )}

      <div
        data-testid="app-shell-content"
        className="min-h-app-screen flex min-w-0 flex-1 flex-col desk:ml-sidebar"
      >
        <header
          data-testid="app-shell-header"
          className={`sticky top-0 z-30 flex items-center bg-bg/82 px-5 backdrop-blur-xl desk:hidden ${shellRailClass}`}
        >
          <Button
            type="button"
            variant="unstyled"
            size="legacy"
            onClick={() => setSidebarOpen(true)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border/80 bg-surface/80 text-muted shadow-[var(--shadow-soft)] desk:hidden"
            aria-label="Open sidebar"
          >
            <ListIcon className="h-5 w-5" />
          </Button>
          {showShellThemeQuickToggle && !isDesktop ? (
            <ShellThemeQuickToggle
              testId="shell-theme-quick-toggle"
              size="mobile"
              className="ml-auto desk:hidden"
            />
          ) : null}
        </header>

        <main
          className={`flex-1 min-w-0 px-5 pt-6 desk:px-7 desk:pt-7 ${
            isDesktop ? "pb-9" : "pb-[calc(4.75rem+env(safe-area-inset-bottom,0px))]"
          }`}
        >
          <div className="page-enter">
            <Outlet context={{ openAddTransaction: () => setAddTransactionOpen(true) }} />
          </div>
        </main>
      </div>

      {!isDesktop && !sidebarOpen && !addTransactionOpen && !mobileFieldFocused ? (
        <Button
          type="button"
          variant="unstyled"
          size="legacy"
          data-testid="app-shell-mobile-add-fab"
          aria-label="Add"
          onClick={() => setAddTransactionOpen(true)}
          className="fixed right-5 bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-accent text-bg shadow-[var(--shadow-accent)] transition active:scale-[0.98]"
        >
          <PlusIcon className="h-6 w-6" />
        </Button>
      ) : null}

      {addTransactionOpen && (
        <Suspense fallback={null}>
          <AddTransactionSheet
            open={addTransactionOpen}
            onClose={() => setAddTransactionOpen(false)}
          />
        </Suspense>
      )}
    </div>
  )
}

export default AppShell
