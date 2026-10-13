import type { QueryClient } from "@tanstack/react-query"
import type { ReceiptFile } from "../components/ui/receipt-file"
import type { ReceiptAttachment, TransactionDetail, TransactionListItem } from "./api-types"
import { formatCurrency } from "./format"

export type TransactionType = "expense" | "income"

// Fields a peek or full view edits; anything missing keeps the stored value.
export type TransactionChanges = {
  occurred_at?: string
  type?: TransactionType
  amount_cents?: number
  category_id?: number | null
  title?: string
  description?: string | null
  is_reimbursement?: boolean
  tags?: string[]
}

// Every view that shows transaction-derived figures.
export function invalidateTransactionData(queryClient: QueryClient) {
  for (const key of ["transactions", "transaction", "dashboard", "insights", "budgets", "forecast", "tag"]) {
    void queryClient.invalidateQueries({ queryKey: [key] })
  }
}

// "2026-10-22T20:15" from a stored occurred_at, falling back to noon on the booking date.
export function occurredAtInput(detail: Pick<TransactionDetail, "occurred_at" | "date">): string {
  return detail.occurred_at?.slice(0, 16) || `${detail.date}T12:00`
}

// The full PUT body: the stored values with `changes` applied. Coordinates are omitted,
// which keeps them.
export function transactionPayload(detail: TransactionDetail, changes: TransactionChanges) {
  const occurredAt = changes.occurred_at ?? occurredAtInput(detail)
  const type = changes.type ?? detail.type
  return {
    date: occurredAt.slice(0, 10),
    occurred_at: `${occurredAt.slice(0, 16)}:00`,
    type,
    amount_cents: changes.amount_cents ?? detail.amount_cents,
    category_id: changes.category_id !== undefined ? changes.category_id : detail.category_id,
    title: changes.title ?? detail.title,
    description: changes.description !== undefined ? changes.description : detail.description,
    is_reimbursement: type === "income" ? (changes.is_reimbursement ?? detail.is_reimbursement) : false,
    tags: changes.tags ?? detail.tags,
  }
}

// The stored record as it reads after `changes` saved; the category object is resolved by the caller.
export function applyTransactionChanges(detail: TransactionDetail, changes: TransactionChanges): TransactionDetail {
  const payload = transactionPayload(detail, changes)
  return {
    ...detail,
    ...payload,
    net_amount_cents:
      payload.type === "expense" ? Math.max(payload.amount_cents - detail.reimbursed_total_cents, 0) : payload.amount_cents,
  }
}

// Accepts "12,34", "12.34", and "1 234,56"; null for anything else.
export function parseAmountCents(raw: string): number | null {
  const normalized = raw.replace(/[\s€]/g, "").replace(",", ".")
  if (!normalized) return null
  const value = Number(normalized)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 100)
}

export function amountInput(cents: number): string {
  return formatCurrency(cents)
}

export function receiptFiles(attachments: ReceiptAttachment[]): ReceiptFile[] {
  return attachments.map((attachment) => ({
    id: attachment.id,
    name: attachment.original_filename,
    sizeBytes: attachment.size_bytes,
    pdf: attachment.mime_type === "application/pdf",
    previewUrl: attachment.mime_type.startsWith("image/") ? `/api/attachments/${attachment.id}/thumbnail` : null,
    fileUrl: `/api/attachments/${attachment.id}/download`,
  }))
}

const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "short" })
const DAY_MONTH = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" })
const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" })

function localDate(iso: string): Date {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number)
  return new Date(year, month - 1, day)
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

// "Thu 22 Oct", or "Thu 22 Oct 2025" outside the current year.
export function dayLabel(isoDate: string, today = new Date()): string {
  const date = localDate(isoDate)
  const label = `${WEEKDAY.format(date)} ${DAY_MONTH.format(date)}`
  return date.getFullYear() === today.getFullYear() ? label : `${label} ${date.getFullYear()}`
}

// "22 Oct", or "22 Oct 2025" outside the current year.
export function shortDateLabel(isoDate: string, today = new Date()): string {
  const date = localDate(isoDate)
  const label = DAY_MONTH.format(date)
  return date.getFullYear() === today.getFullYear() ? label : `${label} ${date.getFullYear()}`
}

// "Thu 22 Oct 2026, 20:15" from "2026-10-22T20:15".
export function occurredLabel(occurredAt: string): string {
  const date = localDate(occurredAt)
  const [hours, minutes] = occurredAt.slice(11, 16).split(":").map(Number)
  date.setHours(hours || 0, minutes || 0)
  return `${WEEKDAY.format(date)} ${DAY_MONTH.format(date)} ${date.getFullYear()}, ${TIME.format(date)}`
}

// "Today, 14:32", "Yesterday, 09:10", or "Thu 22 Oct, 20:15" for the entry dialog's date chip.
export function occurredChipLabel(occurredAt: string, today = new Date()): string {
  const date = localDate(occurredAt)
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  const day = sameDay(date, today) ? "Today" : sameDay(date, yesterday) ? "Yesterday" : dayLabel(occurredAt, today)
  return `${day}, ${occurredAt.slice(11, 16)}`
}

export function currentLocalDateTime(): string {
  const now = new Date()
  now.setSeconds(0, 0)
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

// A day's net with the summary's rules: income that is not a reimbursement, minus expenses
// after their reimbursements.
export function dayNet(rows: TransactionListItem[]): number {
  return rows.reduce((total, row) => {
    if (row.type === "expense") return total - row.net_amount_cents
    return row.is_reimbursement ? total : total + row.amount_cents
  }, 0)
}
