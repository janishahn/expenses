import { useId, type CSSProperties, type ReactNode } from "react"
import type { Icon } from "@phosphor-icons/react"
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree"
import clsx from "clsx"
import { IconButton } from "./Button"
import { BudgetBar } from "./Charts"
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
  const titleId = useId()
  return (
    <section className={clsx(s.card, flat && s.cardFlat)} aria-labelledby={title != null ? titleId : undefined}>
      {title != null || actions || menu ? (
        <div className={s.ch}>
          {title != null ? <h2 id={titleId}>{title}</h2> : null}
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

// An editor inline at the top of a card's body, above its rows; it ends with PopoverActions.
export function CardForm({ onSubmit, children }: { onSubmit: () => void; children: ReactNode }) {
  return (
    <form
      className={s.cardForm}
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      {children}
    </form>
  )
}

// A page-width form in one card. From 720px of card width, `main` sits left and `side` right, with `top`
// and `wide` across; narrower, the groups stack in that order.
export function FormCard({ top, main, side, wide }: { top?: ReactNode; main: ReactNode; side?: ReactNode; wide?: ReactNode }) {
  return (
    <section className={clsx(s.card, s.formCard)}>
      <div className={s.formCols}>
        {top != null ? <div className={s.formTop}>{top}</div> : null}
        <div className={s.formMain}>{main}</div>
        {side != null ? <div className={s.formSide}>{side}</div> : null}
        {wide != null ? <div className={s.formWide}>{wide}</div> : null}
      </div>
    </section>
  )
}

// One file the page produced, such as a generated report: its name, a muted note, and an action.
export function FileRow({ icon: IconComponent, name, meta, action }: { icon: Icon; name: string; meta?: ReactNode; action?: ReactNode }) {
  return (
    <div className={s.fileRow}>
      <IconComponent aria-hidden="true" />
      <span className={s.fileName}>{name}</span>
      {meta != null ? <span className={s.fileMeta}>{meta}</span> : null}
      <span className={s.sp} />
      {action}
    </div>
  )
}

// Preformatted text such as a captured request body or a log payload; it scrolls inside its own box.
export function CodeBlock({ label, children }: { label: string; children: string }) {
  return (
    <pre className={s.code} aria-label={label} tabIndex={0}>
      {children}
    </pre>
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

export type SummaryBudget = {
  label: string
  used: ReactNode
  ratio: number
  over: boolean
  pace: number | null
  remaining: ReactNode
  projection?: ReactNode
  projectionOver?: boolean
}

// The metric strip on a phone: one lead figure, an optional budget, and the other figures in a row.
export function SummaryCard({ lead, budget, metrics }: { lead: Metric; budget?: SummaryBudget; metrics: Metric[] }) {
  return (
    <section className={clsx(s.card, s.summary)}>
      <div>
        <div className={s.lab}>{lead.label}</div>
        <div className={s.summaryNum}>{lead.value}</div>
        {lead.detail != null ? <div className={s.delta}>{lead.detail}</div> : null}
      </div>
      {budget ? (
        <div role="group" aria-label={budget.label} className={s.summaryBudget}>
          <div className={s.summaryLine}>
            <span className={s.lab}>{budget.label}</span>
            <span className={s.muted}>{budget.used}</span>
          </div>
          <BudgetBar ratio={budget.ratio} over={budget.over} pace={budget.pace} />
          <div className={s.summaryLine}>
            <span className={s.muted}>{budget.remaining}</span>
            {budget.projection != null ? (
              <span className={budget.projectionOver ? s.over : s.muted}>{budget.projection}</span>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className={s.summaryRow}>
        {metrics.map((metric) => (
          <div key={metric.label}>
            <div className={s.lab}>{metric.label}</div>
            <div className={s.summaryValue}>{metric.value}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
