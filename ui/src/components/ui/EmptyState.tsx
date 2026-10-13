import type { ReactNode } from "react"
import type { Icon } from "@phosphor-icons/react"
import clsx from "clsx"
import s from "./kit.module.css"

// One line of text that ends in an action. Inline empty states sit inside cards and sections.
export function EmptyState({
  icon: IconComponent,
  children,
  action,
  inline = false,
}: {
  icon?: Icon
  children: ReactNode
  action?: ReactNode
  inline?: boolean
}) {
  return (
    <div className={clsx(s.empty, inline && s.emptyInline)}>
      {IconComponent ? <IconComponent aria-hidden="true" /> : null}
      <div>{children}</div>
      {action}
    </div>
  )
}

// A state label with its icon: ok uses the income tone, bad uses the problem tone.
export function Status({
  icon: IconComponent,
  tone = "neutral",
  wrap = false,
  children,
}: {
  icon?: Icon
  tone?: "neutral" | "ok" | "bad"
  wrap?: boolean
  children: ReactNode
}) {
  return (
    <span className={clsx(s.status, tone === "ok" && s.statusOk, tone === "bad" && s.statusBad, wrap && s.statusWrap)}>
      {IconComponent ? <IconComponent aria-hidden="true" /> : null}
      <span>{children}</span>
    </span>
  )
}
