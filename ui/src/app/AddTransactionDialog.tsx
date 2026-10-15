import { useRef, useState, type FormEvent } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowBendUpLeftIcon } from "@phosphor-icons/react/ArrowBendUpLeft"
import { CalendarBlankIcon } from "@phosphor-icons/react/CalendarBlank"
import { PaperclipIcon } from "@phosphor-icons/react/Paperclip"
import { ShapesIcon } from "@phosphor-icons/react/Shapes"
import { TagIcon } from "@phosphor-icons/react/Tag"
import { useNavigate } from "react-router-dom"
import { CategoryPicker } from "../components/CategoryPicker"
import { TagPicker } from "../components/TagPicker"
import { Button } from "../components/ui/Button"
import { CategoryGlyph } from "../components/ui/CategoryGlyph"
import { EntryAmount, EntryChips, EntryDialog, EntryName, EntryNotes } from "../components/ui/EntryDialog"
import { Pill } from "../components/ui/Pill"
import { Popover, PopoverActions } from "../components/ui/Popover"
import { RECEIPT_ACCEPT } from "../components/ui/receipt-file"
import { SegmentedControl } from "../components/ui/SegmentedControl"
import { Field, FieldGrid, TextField } from "../components/ui/TextField"
import { showToast } from "../components/ui/toast-store"
import { apiFetch, apiFetchFormData, getApiErrorMessage } from "./api"
import type { CategoriesResponse, TagsResponse, TemplateRow, TemplatesResponse } from "./api-types"
import {
  currentLocalDateTime,
  invalidateTransactionData,
  occurredChipLabel,
  parseAmountCents,
  type TransactionType,
} from "./transactions"

type FieldErrors = { amount?: string; title?: string; form?: string }

function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

function DateChip({ value, onChange }: { value: string; onChange: (value: string) => void }) {
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
        <Pill icon={CalendarBlankIcon} aria-label={`Date ${occurredChipLabel(value)}`}>
          {occurredChipLabel(value)}
        </Pill>
      }
    >
      <form onSubmit={submit}>
        <FieldGrid narrow>
          <Field label="Date">
            <TextField type="datetime-local" required autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} />
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

function AddTransactionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const amountRef = useRef<HTMLInputElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const [type, setType] = useState<TransactionType>("expense")
  const [occurredAt, setOccurredAt] = useState(currentLocalDateTime)
  const [amount, setAmount] = useState("")
  const [title, setTitle] = useState("")
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [explicitTags, setExplicitTags] = useState<string[]>([])
  const [excludedScheduledTags, setExcludedScheduledTags] = useState<string[]>([])
  const [isReimbursement, setIsReimbursement] = useState(false)
  const [notes, setNotes] = useState("")
  const [receipt, setReceipt] = useState<File | null>(null)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [pending, setPending] = useState(false)

  const { data: categoriesData } = useQuery({
    queryKey: ["categories", "all"],
    queryFn: () => apiFetch<CategoriesResponse>("/api/categories?period=all"),
    enabled: open,
  })
  const { data: templatesData } = useQuery({
    queryKey: ["templates"],
    queryFn: () => apiFetch<TemplatesResponse>("/api/templates"),
    enabled: open,
  })
  const { data: tagsData, isError: tagsFailed, isFetching: tagsLoading } = useQuery({
    queryKey: ["tags", "all"],
    queryFn: () => apiFetch<TagsResponse>("/api/tags?period=all"),
    enabled: open,
  })

  const categories = (categoriesData?.categories ?? []).filter(
    (category) => category.archived_at === null && category.type === type
  )
  const category = categories.find((entry) => entry.id === categoryId) ?? null
  const templates = templatesData?.templates ?? []

  // Tags scheduled for the chosen date join automatically unless removed.
  const date = occurredAt.slice(0, 10)
  const scheduledTags = (tagsData?.tags ?? [])
    .filter((tag) => tag.auto_attach_period && tag.auto_attach_period.start <= date && tag.auto_attach_period.end >= date)
    .map((tag) => tag.name)
  const tags = explicitTags.filter((name) => !excludedScheduledTags.some((excluded) => sameName(excluded, name)))
  for (const name of scheduledTags) {
    if (!excludedScheduledTags.some((excluded) => sameName(excluded, name)) && !tags.some((entry) => sameName(entry, name))) {
      tags.push(name)
    }
  }
  const changeTags = (next: string[]) => {
    const removed = tags.filter((name) => !next.some((entry) => sameName(entry, name)))
    const added = next.filter((name) => !tags.some((entry) => sameName(entry, name)))
    setExplicitTags((current) => [
      ...current.filter((name) => !removed.some((entry) => sameName(entry, name))),
      ...added.filter((name) => !current.some((entry) => sameName(entry, name))),
    ])
    setExcludedScheduledTags((current) => [
      ...current.filter((name) => !added.some((entry) => sameName(entry, name))),
      ...removed.filter((name) => scheduledTags.some((entry) => sameName(entry, name))),
    ])
  }

  const applyTemplate = (template: TemplateRow) => {
    setType(template.type === "income" ? "income" : "expense")
    setCategoryId(template.category_id)
    setTitle(template.title || "")
    setNotes("")
    setExplicitTags(template.tags)
    setErrors({})
    if (template.type !== "income") setIsReimbursement(false)
    setAmount(template.default_amount_cents === null ? "" : (template.default_amount_cents / 100).toFixed(2).replace(".", ","))
    window.setTimeout(() => amountRef.current?.focus(), 0)
  }

  const submit = async () => {
    const next: FieldErrors = {}
    const amountCents = parseAmountCents(amount)
    if (!amount.trim()) next.amount = "Enter an amount."
    else if (amountCents === null) next.amount = "Enter a valid amount."
    if (!title.trim()) next.title = "Enter a title."
    if (!occurredAt) next.form = "Date and time are required"
    else if (!tagsData || tagsLoading || tagsFailed) next.form = "Wait for tags to load before adding the transaction"
    setErrors(next)
    if (next.amount || next.title || next.form || amountCents === null) return

    setPending(true)
    let createdId: number
    try {
      const created = await apiFetch<{ id: number }>("/api/transactions", {
        method: "POST",
        body: JSON.stringify({
          date,
          occurred_at: `${occurredAt}:00`,
          type,
          amount_cents: amountCents,
          category_id: categoryId,
          title: title.trim(),
          description: notes.trim() || null,
          is_reimbursement: type === "income" ? isReimbursement : false,
          tags,
        }),
      })
      createdId = created.id
    } catch (error) {
      setErrors({ form: getApiErrorMessage(error, "Unable to add transaction.") })
      setPending(false)
      return
    }
    let receiptFailed = false
    if (receipt) {
      try {
        const form = new FormData()
        form.append("file", receipt)
        await apiFetchFormData(`/api/transactions/${createdId}/attachments`, { method: "POST", body: form })
      } catch {
        receiptFailed = true
      }
    }
    setPending(false)
    invalidateTransactionData(queryClient)
    showToast({
      message: receiptFailed ? "Transaction added, but the receipt could not be uploaded" : "Transaction added",
      action: { label: "Open", onClick: () => navigate(`/transactions?peek=${createdId}`) },
    })
    onClose()
  }

  return (
    <EntryDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Add transaction"
      direction={
        <SegmentedControl
          label="Transaction type"
          value={type}
          options={[
            { value: "expense", label: "Expense" },
            { value: "income", label: "Income" },
          ]}
          onChange={(next) => {
            setType(next)
            setCategoryId(null)
            if (next === "expense") setIsReimbursement(false)
          }}
        />
      }
      templates={
        templates.length ? (
          <>
            {templates.map((template) => (
              <Pill
                key={template.id}
                leading={
                  <CategoryGlyph
                    categoryId={template.category?.id}
                    icon={template.category?.icon}
                    name={template.category?.name ?? template.name}
                  />
                }
                onClick={() => applyTemplate(template)}
              >
                {template.name}
              </Pill>
            ))}
            <Button
              variant="ghost"
              onClick={() => {
                onClose()
                navigate("/templates")
              }}
            >
              Manage
            </Button>
          </>
        ) : null
      }
      submitLabel="Add transaction"
      onSubmit={() => void submit()}
      pending={pending}
      error={errors.form}
    >
      <EntryAmount
        ref={amountRef}
        autoFocus
        income={type === "income"}
        placeholder="0,00 €"
        value={amount}
        error={errors.amount}
        onChange={(event) => setAmount(event.target.value)}
      />
      <EntryName
        aria-label="Title"
        placeholder="Title"
        value={title}
        error={errors.title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <EntryChips>
        <DateChip value={occurredAt} onChange={setOccurredAt} />
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
          options={(tagsData?.tags ?? []).map((tag) => tag.name)}
          selected={tags}
          onChange={changeTags}
          trigger={
            <Pill icon={TagIcon} set={tags.length > 0} aria-label={tags.length ? `Tags ${tags.join(", ")}` : undefined}>
              {tags.length ? tags.join(", ") : "Tags"}
            </Pill>
          }
        />
        {type === "income" ? (
          <Pill
            icon={ArrowBendUpLeftIcon}
            set={isReimbursement}
            aria-pressed={isReimbursement}
            onClick={() => setIsReimbursement(!isReimbursement)}
          >
            Reimbursement
          </Pill>
        ) : null}
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

export default AddTransactionDialog
