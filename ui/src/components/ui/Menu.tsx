import { createContext, useContext, useState, type ReactElement, type ReactNode } from "react"
import { DropdownMenu } from "radix-ui"
import type { Icon } from "@phosphor-icons/react"
import { CheckIcon } from "@phosphor-icons/react/Check"
import { Link } from "react-router-dom"
import clsx from "clsx"
import { BottomSheet } from "./BottomSheet"
import { useIsDesktop } from "./layout-state"
import s from "./kit.module.css"

type MenuMode = { sheet: boolean; close: () => void }
const MenuModeContext = createContext<MenuMode>({ sheet: false, close: () => {} })

// Desktop: a dropdown from the trigger. Mobile: the same items in a bottom sheet.
export function Menu({
  trigger,
  label,
  align = "end",
  children,
}: {
  trigger: ReactElement
  // Accessible name of the sheet on mobile.
  label: string
  align?: "start" | "end"
  children: ReactNode
}) {
  const isDesktop = useIsDesktop()
  const [open, setOpen] = useState(false)
  if (!isDesktop) {
    return (
      <BottomSheet open={open} onOpenChange={setOpen} title={label} trigger={trigger}>
        <MenuModeContext.Provider value={{ sheet: true, close: () => setOpen(false) }}>
          {children}
        </MenuModeContext.Provider>
      </BottomSheet>
    )
  }
  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={4}
          collisionPadding={8}
          className={clsx(s.floatLayer, s.menu)}
          // Radix can ignore Esc for a few hundred milliseconds after the menu opens on a busy page,
          // so the focused menu closes itself. Stopping the event keeps an open peek open.
          onKeyDown={(event) => {
            if (event.key !== "Escape") return
            event.stopPropagation()
            setOpen(false)
          }}
        >
          <MenuModeContext.Provider value={{ sheet: false, close: () => setOpen(false) }}>
            {children}
          </MenuModeContext.Provider>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

type MenuItemProps = {
  icon?: Icon
  children: ReactNode
  onSelect?: () => void
  danger?: boolean
  disabled?: boolean
  // Right-aligned secondary text, such as a count or shortcut.
  end?: ReactNode
  // Present for toggles and single-choice lists; shows a check when true.
  checked?: boolean
}

function ItemContent({ icon: IconComponent, children, end, checked }: MenuItemProps) {
  return (
    <>
      {IconComponent ? <IconComponent aria-hidden="true" /> : null}
      {children}
      {end != null ? <span className={s.miEnd}>{end}</span> : null}
      {checked ? <CheckIcon aria-hidden="true" className={s.miCheck} /> : null}
    </>
  )
}

export function MenuItem(props: MenuItemProps) {
  const { sheet, close } = useContext(MenuModeContext)
  const className = clsx(s.mi, props.danger && s.miDanger)
  if (sheet) {
    return (
      <button
        type="button"
        role={props.checked === undefined ? "menuitem" : "menuitemcheckbox"}
        aria-checked={props.checked}
        className={className}
        disabled={props.disabled}
        onClick={() => {
          close()
          props.onSelect?.()
        }}
      >
        <ItemContent {...props} />
      </button>
    )
  }
  if (props.checked !== undefined) {
    return (
      <DropdownMenu.CheckboxItem
        className={className}
        checked={props.checked}
        disabled={props.disabled}
        onSelect={() => props.onSelect?.()}
      >
        <ItemContent {...props} />
      </DropdownMenu.CheckboxItem>
    )
  }
  return (
    <DropdownMenu.Item className={className} disabled={props.disabled} onSelect={() => props.onSelect?.()}>
      <ItemContent {...props} />
    </DropdownMenu.Item>
  )
}

export function MenuLink({ to, icon, children }: { to: string; icon?: Icon; children: ReactNode }) {
  const { sheet, close } = useContext(MenuModeContext)
  if (sheet) {
    return (
      <Link to={to} className={s.mi} onClick={close}>
        <ItemContent icon={icon}>{children}</ItemContent>
      </Link>
    )
  }
  return (
    <DropdownMenu.Item asChild className={s.mi}>
      <Link to={to}>
        <ItemContent icon={icon}>{children}</ItemContent>
      </Link>
    </DropdownMenu.Item>
  )
}

export function MenuSeparator() {
  const { sheet } = useContext(MenuModeContext)
  return sheet ? <div role="separator" className={s.msep} /> : <DropdownMenu.Separator className={s.msep} />
}

export function MenuLabel({ children }: { children: ReactNode }) {
  const { sheet } = useContext(MenuModeContext)
  return sheet ? <div className={s.mhead}>{children}</div> : <DropdownMenu.Label className={s.mhead}>{children}</DropdownMenu.Label>
}
