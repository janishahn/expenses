import { useEffect, type ReactNode } from "react"
import { createPortal } from "react-dom"
import type { Icon } from "@phosphor-icons/react"
import { CaretLeftIcon } from "@phosphor-icons/react/CaretLeft"
import { Link } from "react-router-dom"
import clsx from "clsx"
import { useFrameSidebar } from "./frame-context"
import { useIsDesktop } from "./layout-state"
import { Panel } from "./Panel"
import s from "./kit.module.css"

export type SettingsSection = { key: string; label: string; icon: Icon; to: string }
export type SettingsGroup = { label: string; sections: SettingsSection[] }

function SectionLinks({ groups, current }: { groups: SettingsGroup[]; current: string }) {
  return groups.map((group) => (
    <div key={group.label} role="group" aria-label={group.label}>
      <div className={s.snavGroup}>{group.label}</div>
      {group.sections.map((section) => (
        <Link
          key={section.key}
          to={section.to}
          className={s.nav}
          aria-current={section.key === current ? "page" : undefined}
        >
          <section.icon aria-hidden="true" />
          {section.label}
        </Link>
      ))}
    </div>
  ))
}

// Settings and Admin: a section list and one section at a time. On desktop the list
// replaces the sidebar under "Back to app"; on mobile it is a chip row under the header.
export function SettingsShell({
  title,
  groups,
  current,
  actions,
  children,
}: {
  // "Settings" or "Admin"; the header shows it on mobile and the section name on desktop.
  title: string
  groups: SettingsGroup[]
  current: string
  actions?: ReactNode
  children: ReactNode
}) {
  const isDesktop = useIsDesktop()
  const sidebar = useFrameSidebar()
  const { setOverridden } = sidebar
  useEffect(() => {
    if (!isDesktop) return
    setOverridden(true)
    return () => setOverridden(false)
  }, [isDesktop, setOverridden])

  const currentLabel =
    groups.flatMap((group) => group.sections).find((section) => section.key === current)?.label ?? title

  if (isDesktop) {
    return (
      <Panel title={currentLabel} actions={actions} layout="fill">
        {sidebar.element
          ? createPortal(
              <>
                <Link to="/" className={clsx(s.brand, s.brandBack)}>
                  <CaretLeftIcon aria-hidden="true" />
                  Back to app
                </Link>
                <nav aria-label={`${title} sections`} className={s.snav}>
                  <SectionLinks groups={groups} current={current} />
                </nav>
              </>,
              sidebar.element
            )
          : null}
        <div className={s.content}>
          <div className={s.sbody}>{children}</div>
        </div>
      </Panel>
    )
  }
  return (
    <Panel title={title} actions={actions} layout="fill">
      <div className={s.settings}>
        <nav aria-label={`${title} sections`} className={s.snav}>
          <SectionLinks groups={groups} current={current} />
        </nav>
        <div className={s.sbody}>{children}</div>
      </div>
    </Panel>
  )
}

// One setting: its label on the left, the control or value on the right. `stack`
// puts the value under the label for long values such as status text or a token.
export function SettingRow({
  label,
  stack = false,
  children,
}: {
  label: ReactNode
  stack?: boolean
  children?: ReactNode
}) {
  return (
    <div className={clsx(s.srow, stack && s.srowStack)}>
      <div className={s.srowLabel}>{label}</div>
      {children != null ? <div className={s.srowValue}>{children}</div> : null}
    </div>
  )
}
