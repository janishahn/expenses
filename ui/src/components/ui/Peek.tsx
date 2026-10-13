import { useEffect, type ReactNode } from "react"
import { ArrowsOutSimpleIcon } from "@phosphor-icons/react/ArrowsOutSimple"
import { CaretLeftIcon } from "@phosphor-icons/react/CaretLeft"
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight"
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree"
import { XIcon } from "@phosphor-icons/react/X"
import { useNavigate } from "react-router-dom"
import clsx from "clsx"
import { IconButton } from "./Button"
import { Menu } from "./Menu"
import s from "./kit.module.css"

// The list and its docked peek, side by side. On mobile the peek replaces the list.
export function PeekLayout({ main, peek }: { main: ReactNode; peek: ReactNode }) {
  return (
    <div className={s.split}>
      <div className={s.splitMain}>{main}</div>
      {peek}
    </div>
  )
}

function floatingLayerOpen(): boolean {
  return Boolean(
    document.querySelector("[data-radix-popper-content-wrapper], [role='dialog'][data-state='open'], [role='alertdialog']")
  )
}

export function Peek({
  parent,
  title,
  onClose,
  fullViewTo,
  fullViewState,
  menu,
  footer,
  children,
}: {
  // The list's name, shown in the breadcrumb and on the mobile back button.
  parent: string
  title: string
  onClose: () => void
  fullViewTo?: string
  // Router state for the full view, such as where its breadcrumb returns to.
  fullViewState?: unknown
  menu?: ReactNode
  footer?: ReactNode
  children: ReactNode
}) {
  const navigate = useNavigate()
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Esc first closes menus, pickers, and dialogs; only then the peek.
      if (event.key !== "Escape" || floatingLayerOpen()) return
      onClose()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [onClose])

  return (
    <aside className={s.peek} aria-label={title}>
      <div className={s.pkBar}>
        <span className={s.pkCrumb}>
          <span>{parent}</span>
          <CaretRightIcon aria-hidden="true" />
          <b>{title}</b>
        </span>
        <button type="button" className={s.pkBack} onClick={onClose}>
          <CaretLeftIcon aria-hidden="true" />
          {parent}
        </button>
        <span className={s.sp} />
        {fullViewTo ? (
          <IconButton
            icon={ArrowsOutSimpleIcon}
            label="Open full view"
            onClick={() => navigate(fullViewTo, { state: fullViewState })}
            className={s.hideMobile}
          />
        ) : null}
        {menu ? (
          <Menu label="More actions" trigger={<IconButton icon={DotsThreeIcon} label="More actions" />}>
            {menu}
          </Menu>
        ) : null}
        <IconButton icon={XIcon} label="Close" onClick={onClose} className={s.hideMobile} />
      </div>
      <div className={s.pkBody}>{children}</div>
      {footer ? <div className={s.pkFoot}>{footer}</div> : null}
    </aside>
  )
}

// A titled section inside a peek or full view; `action` sits at the right (Upload, a link to the full list).
export function PeekSection({
  title,
  action,
  children,
}: {
  title: ReactNode
  action?: ReactNode
  children?: ReactNode
}) {
  return (
    <section>
      <div className={s.pkSec}>
        <h3>{title}</h3>
        <span className={s.sp} />
        {action}
      </div>
      {children}
    </section>
  )
}

// Under the headline amount: its cadence, limit, or usual amount, in ink-2.
export function PeekSubline({ children }: { children: ReactNode }) {
  return <div className={s.pkSub}>{children}</div>
}

// The peek's content at page width: a main column and a side column (320px; 360px for
// transactions, which keep location and receipts there).
export function FullView({
  main,
  side,
  transaction = false,
}: {
  main: ReactNode
  side?: ReactNode
  transaction?: boolean
}) {
  return (
    <div className={clsx(s.full, transaction && s.fullTx)}>
      <div className={clsx(s.card, s.fullMain)}>{main}</div>
      {side ? <div className={clsx(s.card, s.fullSide)}>{side}</div> : null}
    </div>
  )
}
