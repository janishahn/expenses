import { useRef, useState, type FormEvent } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { CalendarBlankIcon } from "@phosphor-icons/react/CalendarBlank"
import { PaperclipIcon } from "@phosphor-icons/react/Paperclip"
import { ShapesIcon } from "@phosphor-icons/react/Shapes"
import { TagIcon } from "@phosphor-icons/react/Tag"
import { WarningIcon } from "@phosphor-icons/react/Warning"
import { apiFetch, apiFetchFormData, getApiErrorMessage } from "../app/api"
import type {
  BankAccount,
  BankStatementPreviewResponse,
  BankStatementRow,
  CategoriesResponse,
  TagsResponse,
} from "../app/api-types"
import { formatAmountPrivate, formatDateRange, formatShortDate } from "../app/format"
import { shortDateLabel } from "../app/transactions"
import { CategoryPicker } from "../components/CategoryPicker"
import { TagPicker } from "../components/TagPicker"
import { Amount } from "../components/ui/Amount"
import { Button } from "../components/ui/Button"
import { CategoryGlyph } from "../components/ui/CategoryGlyph"
import { Dialog } from "../components/ui/Dialog"
import { Status } from "../components/ui/EmptyState"
import { EntryAmount, EntryChips, EntryDialog, EntryName, EntryNotes } from "../components/ui/EntryDialog"
import { FileDrop } from "../components/ui/FileDrop"
import { AmountCell, Cell, List, ListFooter, Row, type Columns } from "../components/ui/LedgerRow"
import { Pill } from "../components/ui/Pill"
import { Popover, PopoverActions } from "../components/ui/Popover"
import { Property, PropertyList } from "../components/ui/PropertyList"
import { RECEIPT_ACCEPT } from "../components/ui/receipt-file"
import { Field, FieldError, FieldGrid, Select, TextField } from "../components/ui/TextField"
import { bankRowTitle } from "./bank-row"

export type CreateFromRowPayload = {
  date: string
  category_id: number | null
  title: string
  description: string | null
  tag_ids: number[]
}

function DayChip({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (draft) onChange(draft)
    setOpen(false)
  }
  return (
    <Popover
      form
      label="Date"
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(value)
        setOpen(next)
      }}
      trigger={
        <Pill icon={CalendarBlankIcon} set aria-label={`Date ${formatShortDate(value)}`}>
          {formatShortDate(value)}
        </Pill>
      }
    >
      <form onSubmit={submit}>
        <FieldGrid narrow>
          <Field label="Date">
            <TextField type="date" required autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} />
          </Field>
        </FieldGrid>
        <PopoverActions>
          <Button type="submit" variant="primary" size="small" disabled={!draft}>
            Done
          </Button>
        </PopoverActions>
      </form>
    </Popover>
  )
}

// The add dialog filled from a bank row. The amount and type come from the row.
export function CreateFromRowDialog({
  row,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  row: BankStatementRow
  pending: boolean
  error: string | null
  onClose: () => void
  onSubmit: (payload: CreateFromRowPayload, receipt: File | null) => void
}) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const type = row.amount_cents > 0 ? "income" : "expense"
  const [title, setTitle] = useState(bankRowTitle(row))
  const [date, setDate] = useState(row.value_date ?? row.booking_date)
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [tagNames, setTagNames] = useState<string[]>([])
  const [notes, setNotes] = useState(row.purpose ?? row.raw_description)
  const [receipt, setReceipt] = useState<File | null>(null)
  const [titleError, setTitleError] = useState<string | null>(null)

  const { data: categoriesData } = useQuery({
    queryKey: ["categories", "options"],
    queryFn: () => apiFetch<CategoriesResponse>("/api/categories/options"),
  })
  const { data: tagsData } = useQuery({
    queryKey: ["tags", "options"],
    queryFn: () => apiFetch<TagsResponse>("/api/tags/options"),
  })
  const categories = (categoriesData?.categories ?? []).filter(
    (category) => category.archived_at === null && category.type === type
  )
  const category = categories.find((entry) => entry.id === categoryId) ?? null
  const tags = tagsData?.tags ?? []

  const submit = () => {
    if (!title.trim()) {
      setTitleError("Enter a title.")
      return
    }
    onSubmit(
      {
        date,
        category_id: categoryId,
        title: title.trim(),
        description: notes.trim() || null,
        tag_ids: tags.filter((tag) => tagNames.includes(tag.name)).map((tag) => tag.id),
      },
      receipt
    )
  }

  return (
    <EntryDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Create transaction"
      submitLabel={pending ? "Creating…" : "Create and match"}
      onSubmit={submit}
      pending={pending}
      error={error}
    >
      <EntryAmount readOnly income={type === "income"} value={formatAmountPrivate(Math.abs(row.amount_cents), type)} />
      <EntryName
        aria-label="Title"
        placeholder="Title"
        autoFocus
        value={title}
        error={titleError}
        onChange={(event) => {
          setTitle(event.target.value)
          setTitleError(null)
        }}
      />
      <EntryChips>
        <DayChip value={date} onChange={setDate} />
        <CategoryPicker
          allowNone
          categories={categories}
          selectedId={categoryId}
          onSelect={setCategoryId}
          trigger={
            <Pill
              icon={category ? undefined : ShapesIcon}
              leading={category ? <CategoryGlyph categoryId={category.id} icon={category.icon} name={category.name} /> : undefined}
              set={Boolean(category)}
              aria-label={category ? `Category ${category.name}` : undefined}
            >
              {category?.name ?? "Category"}
            </Pill>
          }
        />
        <TagPicker
          options={tags.map((tag) => tag.name)}
          selected={tagNames}
          onChange={setTagNames}
          trigger={
            <Pill icon={TagIcon} set={tagNames.length > 0} aria-label={tagNames.length ? `Tags ${tagNames.join(", ")}` : undefined}>
              {tagNames.length ? tagNames.join(", ") : "Tags"}
            </Pill>
          }
        />
        <Pill
          icon={PaperclipIcon}
          set={Boolean(receipt)}
          onClick={() => fileRef.current?.click()}
          onClear={receipt ? () => setReceipt(null) : undefined}
          clearLabel="Remove receipt"
          aria-label={receipt ? `Receipt ${receipt.name}` : undefined}
        >
          {receipt?.name ?? "Receipt"}
        </Pill>
        <input
          ref={fileRef}
          type="file"
          accept={RECEIPT_ACCEPT}
          hidden
          onChange={(event) => {
            setReceipt(event.target.files?.[0] ?? null)
            event.target.value = ""
          }}
        />
      </EntryChips>
      <EntryNotes value={notes} onChange={(event) => setNotes(event.target.value)} />
    </EntryDialog>
  )
}

export function IgnoreReasonDialog({
  row,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  row: BankStatementRow
  pending: boolean
  error: string | null
  onClose: () => void
  onSubmit: (reason: string) => void
}) {
  const [reason, setReason] = useState("")
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (reason.trim() && !pending) onSubmit(reason.trim())
  }
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !pending) onClose()
      }}
      title={`Ignore ${bankRowTitle(row)}`}
      size="narrow"
      footer={
        <>
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="ignore-reason" variant="primary" disabled={pending || !reason.trim()}>
            Ignore
          </Button>
        </>
      }
    >
      <form id="ignore-reason" onSubmit={submit}>
        <TextField aria-label="Reason" placeholder="Reason" autoFocus maxLength={200} value={reason} onChange={(event) => setReason(event.target.value)} />
        {error ? <FieldError>{error}</FieldError> : null}
      </form>
    </Dialog>
  )
}

// Reopening a row that created a transaction asks what happens to that transaction.
export function ReopenCreatedDialog({
  transactionTitle,
  pending,
  onClose,
  onReopen,
}: {
  transactionTitle: string
  pending: boolean
  onClose: () => void
  onReopen: (trashTransaction: boolean) => void
}) {
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !pending) onClose()
      }}
      title="Reopen this row?"
      size="narrow"
      closable={false}
      warning={`The transaction “${transactionTitle}” was created from it.`}
      footer={
        <>
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="quiet" disabled={pending} onClick={() => onReopen(true)}>
            Move transaction to Trash
          </Button>
          <Button variant="primary" disabled={pending} onClick={() => onReopen(false)}>
            Keep transaction
          </Button>
        </>
      }
    />
  )
}

const NEW_ACCOUNT = "\u0000new"
const PREVIEW_COLUMNS: Columns = { columns: "56px minmax(0, 1fr) auto" }
const PREVIEW_ROWS = 3
const PREVIEW_ERRORS = 5

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

// Choose an account, drop a Commerzbank CSV, check the preview, then import the new rows.
// A file with an invalid row imports nothing.
export function ImportStatementDialog({
  accounts,
  onClose,
  onImported,
}: {
  accounts: BankAccount[]
  onClose: () => void
  onImported: (imported: number, duplicates: number) => void
}) {
  const latest = [...accounts].sort((a, b) => (b.last_import_at ?? "").localeCompare(a.last_import_at ?? ""))[0]
  const [choice, setChoice] = useState(latest?.label ?? NEW_ACCOUNT)
  const [newName, setNewName] = useState("")
  const [nameError, setNameError] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const accountLabel = choice === NEW_ACCOUNT ? newName.trim() : choice

  const upload = <T,>(path: string, chosen: File) => {
    const form = new FormData()
    form.append("account_label", accountLabel)
    form.append("file", chosen)
    return apiFetchFormData<T>(`/api/reconciliation/commerzbank-csv/${path}`, { method: "POST", body: form })
  }
  const preview = useMutation({
    mutationFn: (chosen: File) => upload<BankStatementPreviewResponse>("preview", chosen),
  })
  const commit = useMutation({
    mutationFn: (chosen: File) => upload<{ imported_count: number; duplicate_count: number }>("commit", chosen),
    onSuccess: (result) => onImported(result.imported_count, result.duplicate_count),
  })
  const pending = preview.isPending || commit.isPending
  const data = file ? preview.data : undefined
  const fresh = data ? data.rows.filter((row) => !row.duplicate) : []
  const dates = data?.rows.map((row) => row.booking_date).sort() ?? []

  const chooseFile = (chosen: File) => {
    if (!accountLabel) {
      setNameError("Enter an account name.")
      return
    }
    setFile(chosen)
    commit.reset()
    preview.mutate(chosen)
  }
  const chooseAnother = () => {
    setFile(null)
    preview.reset()
    commit.reset()
  }
  const failure = preview.error
    ? getApiErrorMessage(preview.error, "Unable to read this file.")
    : commit.error
      ? getApiErrorMessage(commit.error, "Unable to import this file.")
      : null

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !pending) onClose()
      }}
      title="Import statement"
      size="narrow"
      footerStart={
        data && !data.errors.length ? (
          <Button variant="ghost" disabled={pending} onClick={chooseAnother}>
            Choose another file
          </Button>
        ) : undefined
      }
      footer={
        <>
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          {data?.errors.length ? (
            <Button variant="primary" onClick={chooseAnother}>
              Choose another file
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={!data || !file || pending || data.new_count === 0}
              onClick={() => file && commit.mutate(file)}
            >
              {commit.isPending ? "Importing…" : data ? `Import ${plural(data.new_count, "row")}` : "Import"}
            </Button>
          )}
        </>
      }
    >
      {data && file ? (
        <>
          <PropertyList>
            <Property label="Account">{data.account_label}</Property>
            <Property label="File">{file.name}</Property>
            {data.errors.length ? null : (
              <>
                <Property label="Rows">
                  {dates.length ? `${data.rows.length} · ${formatDateRange(dates[0], dates[dates.length - 1])}` : "0"}
                </Property>
                <Property label="New">
                  {data.new_count}
                  {data.duplicate_count ? ` · ${data.duplicate_count} already imported` : ""}
                </Property>
              </>
            )}
          </PropertyList>
          {data.errors.length ? (
            <>
              {data.errors.slice(0, PREVIEW_ERRORS).map((message) => (
                <Status key={message} icon={WarningIcon} tone="bad" wrap>
                  {message}
                </Status>
              ))}
              {data.errors.length > PREVIEW_ERRORS ? (
                <Status>{plural(data.errors.length - PREVIEW_ERRORS, "more problem")}</Status>
              ) : null}
            </>
          ) : fresh.length ? (
            <List
              flat
              label="New rows"
              footer={fresh.length > PREVIEW_ROWS ? <ListFooter>{plural(fresh.length - PREVIEW_ROWS, "more row")}</ListFooter> : null}
            >
              {fresh.slice(0, PREVIEW_ROWS).map((row, index) => (
                <Row key={index} {...PREVIEW_COLUMNS}>
                  <Cell tone="muted">{shortDateLabel(row.booking_date)}</Cell>
                  <Cell>{bankRowTitle(row)}</Cell>
                  <AmountCell>
                    <Amount
                      cents={Math.abs(row.amount_cents)}
                      kind={row.amount_cents > 0 ? "income" : "expense"}
                      currency={row.currency}
                    />
                  </AmountCell>
                </Row>
              ))}
            </List>
          ) : (
            <Status>Every row in this file was imported before.</Status>
          )}
        </>
      ) : (
        <>
          <FieldGrid narrow>
            <Field label="Account">
              <Select
                value={choice}
                disabled={pending}
                onChange={(event) => {
                  setChoice(event.target.value)
                  setNameError(null)
                }}
              >
                {accounts.map((account) => (
                  <option key={account.label} value={account.label}>
                    {account.label}
                  </option>
                ))}
                <option value={NEW_ACCOUNT}>New account…</option>
              </Select>
            </Field>
            {choice === NEW_ACCOUNT ? (
              <Field label="Name" error={nameError}>
                <TextField
                  autoFocus
                  maxLength={120}
                  value={newName}
                  onChange={(event) => {
                    setNewName(event.target.value)
                    setNameError(null)
                  }}
                />
              </Field>
            ) : null}
            <Field label="File">
              <FileDrop accept=".csv,text/csv" label="Commerzbank CSV file" disabled={pending} onFile={chooseFile}>
                {preview.isPending ? "Reading the file…" : "Drop a Commerzbank CSV file or choose one"}
              </FileDrop>
            </Field>
          </FieldGrid>
        </>
      )}
      {failure ? <FieldError>{failure}</FieldError> : null}
    </Dialog>
  )
}
