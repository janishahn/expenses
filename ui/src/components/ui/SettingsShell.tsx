import { useEffect, useLayoutEffect, useRef, type FormEvent, type ReactNode } from "react"
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
  page,
  actions,
  peek,
  children,
}: {
  // "Settings" or "Admin"; the header shows it on mobile and the section name on desktop.
  title: string
  groups: SettingsGroup[]
  current: string
  // A page inside the current section, such as the legacy import under Maintenance.
  page?: string
  actions?: ReactNode
  // Sections whose rows open a peek, such as Logs, pass it here: null while it is closed.
  peek?: ReactNode
  children: ReactNode
}) {
  const isDesktop = useIsDesktop()
  const chipsRef = useRef<HTMLElement>(null)
  // The mobile chip row scrolls sideways; the current section's chip stays in view.
  useLayoutEffect(() => {
    const chips = chipsRef.current
    const chip = chips?.querySelector<HTMLElement>("[aria-current='page']")
    if (!chips || !chip) return
    if (chip.offsetLeft < chips.scrollLeft || chip.offsetLeft + chip.offsetWidth > chips.scrollLeft + chips.clientWidth) {
      chips.scrollLeft = chip.offsetLeft - 8
    }
  }, [current, isDesktop])
  const sidebar = useFrameSidebar()
  const { setOverridden } = sidebar
  useEffect(() => {
    if (!isDesktop) return
    setOverridden(true)
    return () => setOverridden(false)
  }, [isDesktop, setOverridden])

  const section = groups.flatMap((group) => group.sections).find((entry) => entry.key === current)
  const currentLabel = section?.label ?? title
  const parents = page && section ? [{ label: section.label, to: section.to }] : undefined
  const body =
    peek === undefined ? (
      <div className={s.sbody}>{children}</div>
    ) : (
      <div className={clsx(s.split, s.settingsSplit)}>
        <div className={clsx(s.splitMain, s.splitScroll)}>
          <div className={s.sbody}>{children}</div>
        </div>
        {peek}
      </div>
    )

  if (isDesktop) {
    return (
      <Panel title={page ?? currentLabel} parents={parents} actions={actions} layout="fill" peekOpen={Boolean(peek)}>
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
        {peek === undefined ? <div className={s.content}>{body}</div> : body}
      </Panel>
    )
  }
  return (
    <Panel title={page ?? title} parents={parents} actions={actions} layout="fill" peekOpen={Boolean(peek)}>
      <div className={s.settings}>
        <nav ref={chipsRef} aria-label={`${title} sections`} className={s.snav}>
          <SectionLinks groups={groups} current={current} />
        </nav>
        {body}
      </div>
    </Panel>
  )
}

// One setting: its label on the left, the control or value on the right. `stack`
// puts the value under the label for long values such as status text or a token.
export function SettingRow({
  label,
  detail,
  stack = false,
  children,
}: {
  label: ReactNode
  // Secondary facts after the label, such as when a token was last used.
  detail?: ReactNode
  stack?: boolean
  children?: ReactNode
}) {
  return (
    <div className={clsx(s.srow, stack && s.srowStack)}>
      <div className={s.srowLabel}>
        {label}
        {detail != null ? <span className={s.faint}> · {detail}</span> : null}
      </div>
      {children != null ? <div className={s.srowValue}>{children}</div> : null}
    </div>
  )
}

// A server section before the admin password is entered: one small form card in place of the section.
export function LockedCard({
  title,
  onSubmit,
  actions,
  children,
}: {
  title: string
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  // Cancel and the submit button, right-aligned.
  actions: ReactNode
  children: ReactNode
}) {
  return (
    <form className={clsx(s.card, s.locked)} onSubmit={onSubmit}>
      <h2 className={s.lockedTitle}>{title}</h2>
      {children}
      <div className={s.lockedActions}>{actions}</div>
    </form>
  )
}
