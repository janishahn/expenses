import { forwardRef, type ButtonHTMLAttributes, type ComponentProps } from "react"
import type { Icon } from "@phosphor-icons/react"
import { Link } from "react-router-dom"
import clsx from "clsx"
import { Tooltip } from "./Tooltip"
import s from "./kit.module.css"

export type ButtonVariant = "primary" | "quiet" | "plain" | "ghost" | "danger" | "dangerFill"

const variantClass: Record<ButtonVariant, string | undefined> = {
  primary: s.btnPrimary,
  quiet: s.btnQuiet,
  plain: s.btnPlain,
  ghost: s.btnGhost,
  danger: s.btnDanger,
  dangerFill: s.btnDangerFill,
}

type ButtonOwnProps = {
  variant?: ButtonVariant
  size?: "default" | "small"
  icon?: Icon
}

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & ButtonOwnProps
>(function Button(
  { variant = "plain", size = "default", icon: IconComponent, className, children, type = "button", ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={clsx(s.btn, variantClass[variant], size === "small" && s.btnSmall, className)}
      {...props}
    >
      {IconComponent ? <IconComponent aria-hidden="true" /> : null}
      {children}
    </button>
  )
})

export const LinkButton = forwardRef<
  HTMLAnchorElement,
  ComponentProps<typeof Link> & ButtonOwnProps
>(function LinkButton(
  { variant = "plain", size = "default", icon: IconComponent, className, children, ...props },
  ref
) {
  return (
    <Link
      ref={ref}
      className={clsx(s.btn, variantClass[variant], size === "small" && s.btnSmall, className)}
      {...props}
    >
      {IconComponent ? <IconComponent aria-hidden="true" /> : null}
      {children}
    </Link>
  )
})

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  icon: Icon
  label: string
  size?: "default" | "small"
  // Inside menus and triggers that already show a tooltip, skip the extra one.
  tooltip?: boolean
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: IconComponent, label, size = "default", tooltip = true, className, type = "button", ...props },
  ref
) {
  const button = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={clsx(s.ib, size === "small" && s.ibSmall, className)}
      {...props}
    >
      <IconComponent aria-hidden="true" />
    </button>
  )
  return tooltip ? <Tooltip label={label}>{button}</Tooltip> : button
})
