import type { ReactNode } from "react"
import { ArrowsLeftRightIcon } from "@phosphor-icons/react/ArrowsLeftRight"
import { MapPinIcon } from "@phosphor-icons/react/MapPin"
import { PaperclipIcon } from "@phosphor-icons/react/Paperclip"
import clsx from "clsx"
import { Checkbox } from "./Checkbox"
import { TagChips } from "./TagChip"
import { columnAttrs, columnStyle, rowProps, type Columns, type RowProps } from "./row-layout"
import s from "./kit.module.css"

export type { Columns }

// A complete, flat list in one sheet. `scroll` lists fill the remaining height and scroll;
// in-flow lists grow with their rows.
export function List({
  children,
  footer,
  scroll = true,
  flat = false,
  hasSelection = false,
  label,
}: {
  children: ReactNode
  // Paging or an empty state below the rows; it stays outside the list role, which holds only rows and bands.
  footer?: ReactNode
  scroll?: boolean
  // Rows inside a card or peek: no surface of their own, since sheets never nest.
  flat?: boolean
  // While any row is selected, every row shows its checkbox.
  hasSelection?: boolean
  label?: string
}) {
  return (
    <div className={clsx(s.list, (!scroll || flat) && s.listStatic, flat && s.listFlat, hasSelection && s.hasSel)}>
      <div role="list" aria-label={label}>
        {children}
      </div>
      {footer}
    </div>
  )
}

// Column labels, only where values would be ambiguous without them.
export function ListHead({ children, ...columns }: Columns & { children: ReactNode }) {
  return (
    <div className={s.lhead} style={columnStyle(columns)} {...columnAttrs(columns)} aria-hidden="true">
      {children}
    </div>
  )
}

export function Row({ children, dim = false, ...props }: RowProps) {
  return (
    <div className={clsx(s.row, dim && s.rowDim)} style={columnStyle(props)} {...rowProps(props)}>
      {children}
    </div>
  )
}

export function Cell({
  children,
  align = "left",
  hide,
  strong = false,
  tone,
  wrap = false,
}: {
  children?: ReactNode
  align?: "left" | "right"
  // Drop the cell when the list is narrow (peek open) or on mobile; drop it from the columns too.
  hide?: "narrow" | "mobile"
  strong?: boolean
  tone?: "muted" | "faint"
  wrap?: boolean
}) {
  return (
    <span
      className={clsx(
        s.cell,
        align === "right" && s.cellR,
        hide === "narrow" && s.hideNarrow,
        (hide === "mobile" || hide === "narrow") && s.hideMobile,
        strong && s.strong,
        tone === "muted" && s.muted,
        tone === "faint" && s.faint,
        wrap && s.cellWrap
      )}
    >
      {children}
    </span>
  )
}

// Hover-revealed actions at the end of a row: ✕ on short removable lists, triage accept/reject.
export function RowActions({ children, reveal = false }: { children: ReactNode; reveal?: boolean }) {
  return <span className={clsx(s.acts, reveal && s.rowHover)}>{children}</span>
}

// The selection checkbox and glyph of a selectable row. Desktop shows the checkbox on hover;
// mobile selection mode puts it in the glyph's place.
export function RowLead({
  glyph,
  title,
  checked,
  selecting = false,
  onCheckedChange,
}: {
  glyph: ReactNode
  title: string
  checked: boolean
  selecting?: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const checkbox = <Checkbox rowSelect checked={checked} onCheckedChange={onCheckedChange} label={`Select ${title}`} />
  return (
    <>
      <span className={s.hideMobile}>{selecting ? null : checkbox}</span>
      {selecting ? checkbox : glyph}
    </>
  )
}

// The right-aligned amount at the end of a row.
export function AmountCell({ children }: { children: ReactNode }) {
  return <span className={s.amt}>{children}</span>
}

export function ListFooter({ children }: { children: ReactNode }) {
  return <div className={s.lfoot}>{children}</div>
}

const LEDGER_COLUMNS: Columns = {
  columns: "14px 18px minmax(160px, 1fr) 128px minmax(0, 200px) 44px 150px",
  narrowColumns: "14px 18px minmax(0, 1fr) 110px 150px",
  mobileColumns: "18px minmax(0, 1fr) auto",
}

// One transaction: checkbox (on hover), category glyph, title, category, tags, markers, amount.
export function LedgerRow({
  glyph,
  title,
  category,
  tags,
  receipt = false,
  location = false,
  reimbursed = false,
  amount,
  selected = false,
  checked = false,
  selecting = false,
  onCheckedChange,
  onOpen,
}: {
  glyph: ReactNode
  title: string
  category: string
  tags: string[]
  receipt?: boolean
  location?: boolean
  reimbursed?: boolean
  // The formatted amount; a reimbursed expense passes its muted net before the gross amount.
  amount: ReactNode
  selected?: boolean
  checked?: boolean
  // Mobile selection mode: the checkbox takes the glyph's place and a tap toggles the row.
  selecting?: boolean
  onCheckedChange: (checked: boolean) => void
  onOpen: () => void
}) {
  return (
    <Row {...LEDGER_COLUMNS} selected={selected || checked} onOpen={selecting ? () => onCheckedChange(!checked) : onOpen} label={title}>
      <RowLead glyph={glyph} title={title} checked={checked} selecting={selecting} onCheckedChange={onCheckedChange} />
      <span className={s.title}>{title}</span>
      <Cell tone="muted" hide="mobile">
        {category}
      </Cell>
      <span className={clsx(s.hideNarrow, s.hideMobile)}>
        <TagChips names={tags} />
      </span>
      <span className={clsx(s.flags, s.hideNarrow, s.hideMobile)}>
        {receipt ? <PaperclipIcon aria-label="Receipt" role="img" /> : null}
        {location ? <MapPinIcon aria-label="Location" role="img" /> : null}
        {reimbursed ? <ArrowsLeftRightIcon aria-label="Reimbursed" role="img" /> : null}
      </span>
      <AmountCell>{amount}</AmountCell>
    </Row>
  )
}

// Small marker icons in a row, such as a tag excluded from budgets; each icon carries its own label.
export function RowFlags({ children }: { children: ReactNode }) {
  return <span className={s.flags}>{children}</span>
}

// A smaller figure before the main amount, such as a tag's income before its spending; hidden on mobile.
export function AmountPrefix({ children }: { children: ReactNode }) {
  return <span className={clsx(s.net, s.hideMobile)}>{children}</span>
}

// The muted net before a reimbursed expense's gross amount; hidden on mobile.
export function NetPrefix({ children }: { children: ReactNode }) {
  return <span className={clsx(s.net, s.hideMobile)}>net {children}</span>
}
