import type { CSSProperties, ReactNode } from "react"
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree"
import clsx from "clsx"
import { IconButton } from "./Button"
import { Menu } from "./Menu"
import s from "./kit.module.css"

// A card: the sheet surface with an optional 44px header (plain-noun title, meta, controls, ⋯).
export function Sheet({
  title,
  meta,
  actions,
  menu,
  body = "padded",
  flat = false,
  children,
}: {
  title?: ReactNode
  // Muted text after the title, such as a total or "likely 31.690 € in Apr".
  meta?: ReactNode
  actions?: ReactNode
  // Menu items for the ⋯ menu at the right end of the header.
  menu?: ReactNode
  // "padded" for text and charts, "flush" for rows and lists that span the width.
  body?: "padded" | "flush"
  // A sheet's sub-list inside a peek: no surface of its own.
  flat?: boolean
  children: ReactNode
}) {
  return (
    <section className={clsx(s.card, flat && s.cardFlat)}>
      {title != null || actions || menu ? (
        <div className={s.ch}>
          {title != null ? <h2>{title}</h2> : null}
          {meta != null ? <span className={s.meta}>{meta}</span> : null}
          <span className={s.sp} />
          {actions}
          {menu ? (
            <Menu label="More actions" trigger={<IconButton icon={DotsThreeIcon} label="More actions" />}>
              {menu}
            </Menu>
          ) : null}
        </div>
      ) : null}
      <div className={body === "padded" ? s.cbody : s.cbodyFlush}>{children}</div>
    </section>
  )
}

export type Metric = {
  label: string
  value: ReactNode
  // One muted line under the value: a comparison, range, or share.
  detail?: ReactNode
}

export function MetricStrip({ metrics }: { metrics: Metric[] }) {
  return (
    <section className={clsx(s.card, s.strip)} style={{ "--n": metrics.length } as CSSProperties}>
      {metrics.map((metric) => (
        <div key={metric.label}>
          <div className={s.lab}>{metric.label}</div>
          <div className={s.num}>{metric.value}</div>
          {metric.detail != null ? <div className={s.delta}>{metric.detail}</div> : null}
        </div>
      ))}
    </section>
  )
}
