import { useEffect, useMemo, useState, type ReactNode } from "react"
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown"
import { GearIcon } from "@phosphor-icons/react/Gear"
import { ListIcon } from "@phosphor-icons/react/List"
import { ShieldCheckIcon } from "@phosphor-icons/react/ShieldCheck"
import { SignOutIcon } from "@phosphor-icons/react/SignOut"
import { TrayIcon } from "@phosphor-icons/react/Tray"
import { TrendUpIcon } from "@phosphor-icons/react/TrendUp"
import { WalletIcon } from "@phosphor-icons/react/Wallet"
import { Link, useLocation } from "react-router-dom"
import clsx from "clsx"
import { ConfirmDialogHost } from "./Dialog"
import { FrameSidebarContext } from "./frame-context"
import { useBottomLayerActive } from "./layout-state"
import { GROUPS, PRIMARY, TABS, UNCATEGORIZED, isActive, type NavItem } from "./nav"
import { Menu, MenuItem, MenuLink, MenuSeparator } from "./Menu"
import { ToastHost } from "./Toast"
import { TooltipProvider } from "./Tooltip"
import s from "./kit.module.css"

// Text entry hides the mobile tab bar so the keyboard has the bottom edge to itself.
const TEXT_ENTRY =
  "input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=submit]), textarea, select, [contenteditable='true']"

function isTextEntry(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.matches(TEXT_ENTRY)
}

// The window: sidebar and inset page panel on desktop; panel and tab bar on mobile.
export function AppFrame({
  isAdmin,
  llmEnabled,
  uncategorizedCount,
  onSignOut,
  children,
}: {
  isAdmin: boolean
  llmEnabled: boolean
  uncategorizedCount: number
  onSignOut: () => void
  children: ReactNode
}) {
  const { pathname, search } = useLocation()
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [sidebarElement, setSidebarElement] = useState<HTMLElement | null>(null)
  const [sidebarOverridden, setSidebarOverridden] = useState(false)
  const [typing, setTyping] = useState(false)
  const bottomLayer = useBottomLayerActive() || typing

  useEffect(() => {
    // A press that moves focus waits until it ends, so the tab bar never
    // appears or disappears under the pointer before the click lands.
    let pressing = false
    const onFocusIn = (event: FocusEvent) => {
      if (!pressing) setTyping(isTextEntry(event.target))
    }
    const onFocusOut = (event: FocusEvent) => {
      if (!pressing) setTyping(isTextEntry(event.relatedTarget))
    }
    const onPointerDown = () => {
      pressing = true
    }
    const onPointerUp = () => {
      pressing = false
      window.setTimeout(() => setTyping(isTextEntry(document.activeElement)), 0)
    }
    document.addEventListener("focusin", onFocusIn)
    document.addEventListener("focusout", onFocusOut)
    document.addEventListener("pointerdown", onPointerDown, true)
    document.addEventListener("pointerup", onPointerUp, true)
    document.addEventListener("pointercancel", onPointerUp, true)
    return () => {
      document.removeEventListener("focusin", onFocusIn)
      document.removeEventListener("focusout", onFocusOut)
      document.removeEventListener("pointerdown", onPointerDown, true)
      document.removeEventListener("pointerup", onPointerUp, true)
      document.removeEventListener("pointercancel", onPointerUp, true)
    }
  }, [])

  // The period travels with navigation so every page opens on the same range.
  const periodSearch = useMemo(() => {
    const input = new URLSearchParams(search)
    const output = new URLSearchParams()
    for (const key of ["period", "start", "end"]) {
      const value = input.get(key)
      if (value) output.set(key, value)
    }
    const query = output.toString()
    return query ? `?${query}` : ""
  }, [search])
  const href = (to: string) => `${to}${periodSearch}`

  const groups = GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.llm || llmEnabled),
  }))
  const toggleGroup = (label: string) =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })

  const navLink = (item: NavItem, extra?: ReactNode) => (
    <Link
      key={item.to}
      to={href(item.to)}
      className={s.nav}
      aria-current={isActive(item.to, pathname) ? "page" : undefined}
    >
      <item.icon aria-hidden="true" />
      {item.label}
      {extra}
    </Link>
  )

  const sidebarContext = useMemo(
    () => ({ element: sidebarElement, setOverridden: setSidebarOverridden }),
    [sidebarElement]
  )

  return (
    <TooltipProvider>
      <FrameSidebarContext.Provider value={sidebarContext}>
        <div className={s.frame} data-testid="app-shell-root" data-bottom-layer={bottomLayer ? "" : undefined}>
          <div className={s.stage}>
            <aside ref={setSidebarElement} className={s.sidebar} aria-label="Application navigation">
              {sidebarOverridden ? null : (
                <>
                  <Menu
                    label="Expenses"
                    align="start"
                    trigger={
                      <button type="button" className={s.brand}>
                        <WalletIcon aria-hidden="true" />
                        Expenses
                        <CaretDownIcon aria-hidden="true" />
                      </button>
                    }
                  >
                    <MenuLink to="/settings" icon={GearIcon}>
                      Settings
                    </MenuLink>
                    {isAdmin ? (
                      <MenuLink to="/admin" icon={ShieldCheckIcon}>
                        Admin
                      </MenuLink>
                    ) : null}
                    <MenuSeparator />
                    <MenuItem icon={SignOutIcon} onSelect={onSignOut}>
                      Sign out
                    </MenuItem>
                  </Menu>
                  <nav aria-label="Primary">
                    {PRIMARY.map((item) =>
                      item.to === "/transactions" ? (
                        <div key={item.to}>
                          {navLink(item)}
                          {uncategorizedCount > 0 ? (
                            <Link
                              to={href(UNCATEGORIZED)}
                              className={clsx(s.nav, s.navSub)}
                              aria-current={pathname.startsWith(UNCATEGORIZED) ? "page" : undefined}
                            >
                              Uncategorized
                              <span className={s.count}>{uncategorizedCount}</span>
                            </Link>
                          ) : null}
                        </div>
                      ) : (
                        navLink(item)
                      )
                    )}
                    {groups.map((group) => {
                      const open = !collapsed.has(group.label)
                      return (
                        <div key={group.label}>
                          <button
                            type="button"
                            className={s.navGroup}
                            aria-expanded={open}
                            onClick={() => toggleGroup(group.label)}
                          >
                            {group.label}
                            <CaretDownIcon aria-hidden="true" />
                          </button>
                          {open ? group.items.map((item) => navLink(item)) : null}
                        </div>
                      )
                    })}
                  </nav>
                </>
              )}
            </aside>
            <main className={s.panel}>{children}</main>
          </div>
          <nav className={s.tabbar} aria-label="Tabs">
            {TABS.map((item) => (
              <Link
                key={item.to}
                to={href(item.to)}
                className={s.tabItem}
                aria-current={isActive(item.to, pathname) ? "page" : undefined}
              >
                <item.icon aria-hidden="true" />
                {item.label}
              </Link>
            ))}
            <Menu
              label="More"
              trigger={
                <button type="button" className={s.tabItem}>
                  <ListIcon aria-hidden="true" />
                  More
                </button>
              }
            >
              <MenuLink to={href("/forecast")} icon={TrendUpIcon}>
                Forecast
              </MenuLink>
              {uncategorizedCount > 0 ? (
                <MenuLink to={href(UNCATEGORIZED)} icon={TrayIcon}>
                  Uncategorized
                </MenuLink>
              ) : null}
              {groups.flatMap((group) =>
                group.items.map((item) => (
                  <MenuLink key={item.to} to={href(item.to)} icon={item.icon}>
                    {item.label}
                  </MenuLink>
                ))
              )}
              <MenuSeparator />
              <MenuLink to="/settings" icon={GearIcon}>
                Settings
              </MenuLink>
              {isAdmin ? (
                <MenuLink to="/admin" icon={ShieldCheckIcon}>
                  Admin
                </MenuLink>
              ) : null}
              <MenuItem icon={SignOutIcon} onSelect={onSignOut}>
                Sign out
              </MenuItem>
            </Menu>
          </nav>
          <ToastHost />
          <ConfirmDialogHost />
        </div>
      </FrameSidebarContext.Provider>
    </TooltipProvider>
  )
}
