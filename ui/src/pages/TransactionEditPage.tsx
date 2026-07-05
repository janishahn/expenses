import { useState, type MouseEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { DownloadSimpleIcon } from "@phosphor-icons/react/DownloadSimple"
import { PaperclipIcon } from "@phosphor-icons/react/Paperclip"
import { TrashIcon } from "@phosphor-icons/react/Trash"
import { UploadSimpleIcon } from "@phosphor-icons/react/UploadSimple"
import { XIcon } from "@phosphor-icons/react/X"
import { useLocation, useNavigate, useParams } from "react-router-dom"
import { apiFetch, apiFetchBlob, apiFetchFormData } from "../app/api"
import type {
  CategoriesResponse,
  CategoryListItem,
  ReceiptAttachment,
  ReimbursementExpenseSearchResponse,
  ReimbursementExpenseSearchResult,
  TransactionDetail,
  TransactionReimbursements,
  TransactionRouteState,
} from "../app/api-types"
import { formatCurrency, formatEuroDate, formatFileSize } from "../app/format"
import PageIntro from "../components/PageIntro"
import DescriptionEditor from "../components/DescriptionEditor"
import TagSelector from "../components/TagSelector"
import TransactionDateTimeField from "../components/TransactionDateTimeField"
import { AppButton } from "../components/ui/product-button"
import { AppCard } from "../components/ui/product-card"
import {
  AppCheckbox,
  AppFieldLabel,
  AppInput,
  AppNativeSelect,
} from "../components/ui/product-fields"

type TransactionEditFormProps = {
  transaction: TransactionDetail
  categories: CategoryListItem[]
  updatePending: boolean
  deletePending: boolean
  updateError: unknown
  deleteError: unknown
  onSubmit: (payload: Record<string, unknown>) => void
  onDelete: () => void
}

function TransactionEditForm({
  transaction,
  categories,
  updatePending,
  deletePending,
  updateError,
  deleteError,
  onSubmit,
  onDelete,
}: TransactionEditFormProps) {
  const [occurredAt, setOccurredAt] = useState(
    transaction.occurred_at?.slice(0, 16) || `${transaction.date}T12:00`
  )
  const [type, setType] = useState(transaction.type)
  const [amount, setAmount] = useState((transaction.amount_cents / 100).toFixed(2))
  const [categoryId, setCategoryId] = useState(String(transaction.category_id))
  const [title, setTitle] = useState(transaction.title)
  const [description, setDescription] = useState(transaction.description || "")
  const [isReimbursement, setIsReimbursement] = useState(transaction.is_reimbursement)
  const [tags, setTags] = useState<string[]>(transaction.tags)
  const [formError, setFormError] = useState("")

  const activeCategories = categories.filter((category) => category.archived_at === null)
  const filteredCategories = activeCategories.filter((category) => category.type === type)

  const parseAmount = (raw: string) => {
    const normalized = raw.replace(/\s/g, "").replace(",", ".")
    const value = Number(normalized)
    if (!Number.isFinite(value) || value < 0) {
      return null
    }
    return Math.round(value * 100)
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError("")

    if (!occurredAt) {
      setFormError("Date and time are required")
      return
    }
    if (!title.trim()) {
      setFormError("Title is required")
      return
    }
    const amountCents = parseAmount(amount)
    if (amountCents === null) {
      setFormError("Invalid amount")
      return
    }

    onSubmit({
      date: occurredAt.slice(0, 10),
      occurred_at: `${occurredAt}:00`,
      type,
      amount_cents: amountCents,
      category_id: categoryId ? Number(categoryId) : null,
      title: title.trim(),
      description: description.trim() || null,
      is_reimbursement: type === "income" ? isReimbursement : false,
      tags,
    })
  }

  return (
    <AppCard className="max-w-2xl p-6">
      <form onSubmit={handleSubmit}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <AppFieldLabel>
          <span>Type</span>
          <AppNativeSelect
            value={type}
            onChange={(event) => {
              const nextType = event.target.value
              const defaultCategory = activeCategories.find(
                (category) => category.type === nextType
              )
              setType(nextType)
              setCategoryId(defaultCategory ? String(defaultCategory.id) : "")
            }}
          >
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </AppNativeSelect>
        </AppFieldLabel>
        <TransactionDateTimeField value={occurredAt} onChange={setOccurredAt} />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <AppFieldLabel>
          <span>Amount</span>
          <AppInput
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            placeholder="12.34"
            required
          />
        </AppFieldLabel>
        <AppFieldLabel>
          <span>Category (optional)</span>
          <AppNativeSelect
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="">Uncategorized</option>
            {filteredCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </AppNativeSelect>
        </AppFieldLabel>
      </div>

      <AppFieldLabel className="mt-4">
        <span>Title</span>
        <AppInput
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Short title"
          required
        />
      </AppFieldLabel>

      <div className="mt-4 form-label">
        Description (optional)
        <DescriptionEditor
          value={description}
          onChange={setDescription}
          placeholder="Optional description"
          className="mt-1"
          minHeight="8rem"
        />
      </div>

      <div className="mt-4">
        <TagSelector selected={tags} onChange={setTags} />
      </div>

      {type === "income" && (
        <label className="mt-4 flex items-center gap-3 rounded-lg border border-border bg-surface-hi/55 px-3 py-2 text-xs text-muted">
          <AppCheckbox
            checked={isReimbursement}
            onCheckedChange={(checked) => setIsReimbursement(checked === true)}
          />
          This is a reimbursement
        </label>
      )}

      {formError && <p className="mt-4 text-xs text-semantic-red">{formError}</p>}
      {Boolean(updateError) && (
        <p className="mt-4 text-xs text-semantic-red">{String(updateError)}</p>
      )}
      {Boolean(deleteError) && (
        <p className="mt-4 text-xs text-semantic-red">{String(deleteError)}</p>
      )}

      <div className="mt-4 flex gap-3">
        <AppButton
          type="submit"
          className="flex-1"
          disabled={updatePending}
        >
          {updatePending ? "Saving…" : "Save changes"}
        </AppButton>
        <AppButton
          type="button"
          onClick={onDelete}
          tone="danger"
          disabled={deletePending}
        >
          Delete
        </AppButton>
      </div>
      </form>
    </AppCard>
  )
}

function TransactionAttachmentsCard({
  transactionId,
  attachments,
}: {
  transactionId: number
  attachments: ReceiptAttachment[]
}) {
  const queryClient = useQueryClient()
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploadError, setUploadError] = useState("")
  const [downloadError, setDownloadError] = useState("")

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append("file", file)
      return apiFetchFormData<ReceiptAttachment>(
        `/api/transactions/${transactionId}/attachments`,
        {
          method: "POST",
          body: form,
        }
      )
    },
    onSuccess: () => {
      setSelectedFile(null)
      setUploadError("")
      queryClient.invalidateQueries({ queryKey: ["transaction", String(transactionId)] })
      queryClient.invalidateQueries({ queryKey: ["transactions"] })
    },
    onError: (error) => {
      setUploadError(String(error))
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (attachmentId: number) =>
      apiFetch(`/api/attachments/${attachmentId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transaction", String(transactionId)] })
      queryClient.invalidateQueries({ queryKey: ["transactions"] })
    },
  })

  const downloadAttachment = async (attachmentId: number, fallbackName: string) => {
    setDownloadError("")
    try {
      const { blob, filename } = await apiFetchBlob(
        `/api/attachments/${attachmentId}/download`
      )
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = objectUrl
      link.download = filename || fallbackName
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(objectUrl)
    } catch (error) {
      setDownloadError(String(error))
    }
  }

  return (
    <AppCard className="max-w-xl p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-head text-lg font-bold">Attachments</h2>
        <p className="inline-flex items-center gap-1 text-xs text-muted">
          <PaperclipIcon className="h-3.5 w-3.5" />
          {attachments.length} attached
        </p>
      </div>

      <div className="rounded-lg border border-border bg-surface-hi/55 p-3">
        <AppFieldLabel>
          <span>Add receipt (PDF/JPG/PNG/WEBP)</span>
          <AppInput
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            onChange={(event) =>
              setSelectedFile(event.target.files ? event.target.files[0] || null : null)
            }
          />
        </AppFieldLabel>
        <AppButton
          type="button"
          onClick={() => {
            setUploadError("")
            if (!selectedFile) {
              return
            }
            uploadMutation.mutate(selectedFile)
          }}
          disabled={uploadMutation.isPending || !selectedFile}
          className="mt-3 inline-flex items-center gap-1"
        >
          <UploadSimpleIcon className="h-4 w-4" />
          {uploadMutation.isPending ? "Uploading…" : "Upload"}
        </AppButton>
      </div>

      {uploadError ? <p className="mt-3 text-xs text-semantic-red">{uploadError}</p> : null}
      {downloadError ? (
        <p className="mt-3 text-xs text-semantic-red">{downloadError}</p>
      ) : null}
      {deleteMutation.error ? (
        <p className="mt-3 text-xs text-semantic-red">{String(deleteMutation.error)}</p>
      ) : null}

      <div className="mt-4 space-y-2">
        {attachments.length ? (
          attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface-hi/55 p-3"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold text-text">
                  {attachment.original_filename}
                </p>
                <p className="text-xs text-muted">
                  {attachment.mime_type} · {formatFileSize(attachment.size_bytes)} ·{" "}
                  {new Date(attachment.created_at).toLocaleString()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <AppButton
                  type="button"
                  onClick={() =>
                    downloadAttachment(attachment.id, attachment.original_filename)
                  }
                  tone="ghost"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border p-0 text-muted hover:bg-faint"
                  aria-label={`Download ${attachment.original_filename}`}
                >
                  <DownloadSimpleIcon className="h-4 w-4" />
                </AppButton>
                <AppButton
                  type="button"
                  onClick={() => {
                    if (!confirm("Delete this attachment?")) {
                      return
                    }
                    deleteMutation.mutate(attachment.id)
                  }}
                  disabled={deleteMutation.isPending}
                  tone="ghost"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border p-0 text-muted hover:bg-faint disabled:opacity-60"
                  aria-label={`Delete ${attachment.original_filename}`}
                >
                  <TrashIcon className="h-4 w-4" />
                </AppButton>
              </div>
            </div>
          ))
        ) : (
          <p className="rounded-lg border border-border bg-surface-hi/55 p-4 text-sm text-muted">
            No attachments yet.
          </p>
        )}
      </div>
    </AppCard>
  )
}

function TransactionDurablePurchaseCard({
  transactionId,
  transactionType,
  transactionDate,
  amountCents,
  durablePurchase,
}: {
  transactionId: number
  transactionType: string
  transactionDate: string
  amountCents: number
  durablePurchase: {
    expected_lifespan_days: number
    acquired_on: string
  } | null
}) {
  const queryClient = useQueryClient()
  const presetOptions = [
    { value: "182", label: "6 months" },
    { value: "365", label: "1 year" },
    { value: "730", label: "2 years" },
    { value: "1095", label: "3 years" },
    { value: "1825", label: "5 years" },
  ]
  const initialDays = durablePurchase?.expected_lifespan_days
  const presetMatch =
    initialDays && presetOptions.some((option) => Number(option.value) === initialDays)
      ? String(initialDays)
      : "custom"

  const [expanded, setExpanded] = useState(Boolean(durablePurchase))
  const [preset, setPreset] = useState(presetMatch)
  const [customDays, setCustomDays] = useState(
    presetMatch === "custom" && initialDays ? String(initialDays) : ""
  )
  const [acquiredOn, setAcquiredOn] = useState(
    durablePurchase?.acquired_on || transactionDate
  )
  const [formError, setFormError] = useState("")

  const saveMutation = useMutation({
    mutationFn: (payload: { expected_lifespan_days: number; acquired_on: string }) =>
      apiFetch(`/api/transactions/${transactionId}/durable`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      setFormError("")
      queryClient.invalidateQueries({ queryKey: ["transaction", String(transactionId)] })
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      queryClient.invalidateQueries({ queryKey: ["durable-purchases"] })
    },
    onError: (error) => {
      setFormError(String(error))
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/transactions/${transactionId}/durable`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      setFormError("")
      setExpanded(false)
      queryClient.invalidateQueries({ queryKey: ["transaction", String(transactionId)] })
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      queryClient.invalidateQueries({ queryKey: ["durable-purchases"] })
    },
    onError: (error) => {
      setFormError(String(error))
    },
  })

  if (transactionType !== "expense") {
    return null
  }

  const resolvedDays =
    preset === "custom" ? Number(customDays) : Number(preset)
  const validDays = Number.isFinite(resolvedDays) && resolvedDays > 0
  const costPerDay = validDays ? amountCents / resolvedDays : 0
  const presetLabel =
    preset === "custom"
      ? `${resolvedDays || 0} days`
      : (presetOptions.find((option) => option.value === preset)?.label ?? "Custom")

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError("")
    if (!validDays) {
      setFormError("Expected lifespan must be greater than 0 days.")
      return
    }
    if (!acquiredOn) {
      setFormError("Acquired date is required.")
      return
    }
    saveMutation.mutate({
      expected_lifespan_days: resolvedDays,
      acquired_on: acquiredOn,
    })
  }

  return (
    <AppCard className="max-w-xl p-6">
      <div className="mb-4">
        <h2 className="font-head text-lg font-bold">Amortized cost</h2>
      </div>

      {!expanded && !durablePurchase ? (
        <AppButton
          type="button"
          onClick={() => setExpanded(true)}
          tone="inline"
        >
          Track as durable purchase
        </AppButton>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <AppFieldLabel>
            <span>Expected lifespan</span>
            <AppNativeSelect
              value={preset}
              onChange={(event) => setPreset(event.target.value)}
            >
              {presetOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              <option value="custom">Custom</option>
            </AppNativeSelect>
          </AppFieldLabel>

          {preset === "custom" && (
            <AppFieldLabel>
              <span>Days</span>
              <AppInput
                type="number"
                min={1}
                value={customDays}
                onChange={(event) => setCustomDays(event.target.value)}
                required
              />
            </AppFieldLabel>
          )}

          <AppFieldLabel>
            <span>Acquired on</span>
            <AppInput
              type="date"
              value={acquiredOn}
              onChange={(event) => setAcquiredOn(event.target.value)}
              required
            />
          </AppFieldLabel>

          {validDays && (
            <p className="rounded-lg border border-border bg-surface-hi/55 px-3 py-2 text-xs text-muted">
              At {presetLabel}, this {formatCurrency(amountCents)} € purchase costs{" "}
              {(costPerDay / 100).toFixed(2)} €/day.
            </p>
          )}

          {formError && <p className="text-xs text-semantic-red">{formError}</p>}

          <div className="flex flex-wrap items-center gap-2">
            <AppButton
              type="submit"
              disabled={saveMutation.isPending || deleteMutation.isPending}
            >
              {saveMutation.isPending ? "Saving…" : "Save durable tracking"}
            </AppButton>
            {durablePurchase && (
              <AppButton
                type="button"
                onClick={() => deleteMutation.mutate()}
                tone="inline"
                disabled={saveMutation.isPending || deleteMutation.isPending}
              >
                {deleteMutation.isPending
                  ? "Removing…"
                  : "Remove durable tracking"}
              </AppButton>
            )}
          </div>
        </form>
      )}
    </AppCard>
  )
}

function TransactionReimbursementsCard({
  transaction,
}: {
  transaction: TransactionDetail
}) {
  const queryClient = useQueryClient()
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<
    ReimbursementExpenseSearchResult[] | null
  >(null)
  const [searchError, setSearchError] = useState("")
  const [allocationAmounts, setAllocationAmounts] = useState<Record<number, string>>(
    {}
  )
  const [allocationError, setAllocationError] = useState("")

  const reimbursementsQuery = useQuery({
    queryKey: ["transaction", transaction.id, "reimbursements"],
    queryFn: () =>
      apiFetch<TransactionReimbursements>(
        `/api/transactions/${transaction.id}/reimbursements`
      ),
    enabled: Boolean(transaction.id),
  })

  const searchMutation = useMutation({
    mutationFn: (query: string) =>
      apiFetch<ReimbursementExpenseSearchResponse>(
        `/api/reimbursements/${transaction.id}/expense-search?q=${encodeURIComponent(query)}`
      ),
    onSuccess: (data) => {
      setSearchResults(data.results)
      setSearchError("")
      setAllocationError("")
      setAllocationAmounts((prev) => {
        const next = { ...prev }
        for (const row of data.results) {
          if (next[row.expense.id] === undefined && row.suggested_amount_cents > 0) {
            next[row.expense.id] = (row.suggested_amount_cents / 100).toFixed(2)
          }
        }
        return next
      })
    },
    onError: (error) => {
      setSearchResults(null)
      setSearchError(String(error))
    },
  })

  const allocateMutation = useMutation({
    mutationFn: (payload: { expenseId: number; amountCents: number }) =>
      apiFetch(`/api/reimbursements/${transaction.id}/allocations`, {
        method: "POST",
        body: JSON.stringify({
          expense_transaction_id: payload.expenseId,
          amount_cents: payload.amountCents,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["transaction", transaction.id, "reimbursements"],
      })
      const q = searchQuery.trim()
      searchMutation.mutate(q)
    },
    onError: (error) => {
      setAllocationError(String(error))
    },
  })

  const removeMutation = useMutation({
    mutationFn: (allocationId: number) =>
      apiFetch(`/api/reimbursements/allocations/${allocationId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["transaction", transaction.id, "reimbursements"],
      })
      const q = searchQuery.trim()
      if (searchResults) {
        searchMutation.mutate(q)
      }
    },
  })

  const parseAmountCents = (raw: string) => {
    const normalized = raw.replace(/\s/g, "").replace(",", ".")
    const value = Number(normalized)
    if (!Number.isFinite(value) || value <= 0) {
      return null
    }
    return Math.round(value * 100)
  }

  const handleSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSearchError("")
    setAllocationError("")
    searchMutation.mutate(searchQuery.trim())
  }

  const reimbursements = reimbursementsQuery.data

  return (
    <AppCard className="max-w-xl p-6">
      <div className="mb-4">
        <h2 className="font-head text-lg font-bold">
          {transaction.type === "income"
            ? "Income reimbursement"
            : "Expense reimbursements"}
        </h2>
      </div>

      {reimbursementsQuery.isLoading ? (
        <p className="text-sm text-muted">Loading reimbursements…</p>
      ) : reimbursementsQuery.error || !reimbursements ? (
        <p className="text-sm text-semantic-red">Unable to load reimbursements.</p>
      ) : reimbursements.mode === "income" ? (
        <div className="space-y-5">
          {!reimbursements.is_reimbursement ? (
            <p className="text-sm text-muted">
              Mark this income as a reimbursement in the form above, then save
              changes to allocate it to expenses.
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border bg-surface-hi/55 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Allocated
                  </p>
                  <p className="font-mono text-lg font-semibold text-semantic-green tabular-nums">
                    {formatCurrency(reimbursements.allocated_total_cents)} €
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-surface-hi/55 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Remaining
                  </p>
                  <p
                    className={`font-mono text-lg font-semibold tabular-nums ${
                      reimbursements.remaining_to_allocate_cents > 0
                        ? "text-accent"
                        : "text-text"
                    }`}
                  >
                    {formatCurrency(reimbursements.remaining_to_allocate_cents)} €
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-text">Allocated to</p>
                  <span className="text-xs text-muted">
                    {reimbursements.allocations_out.length} expense
                    {reimbursements.allocations_out.length === 1 ? "" : "s"}
                  </span>
                </div>
                {reimbursements.allocations_out.length ? (
                  <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                    {reimbursements.allocations_out.map((alloc) => {
                      const expense = alloc.expense_transaction
                      const title =
                        expense.title ||
                        expense.category?.name ||
                        `Expense #${expense.id}`
                      const subtitle = `${formatEuroDate(expense.date)} · ${
                        expense.category?.name || "Uncategorized"
                      }${expense.deleted_at ? " · Deleted" : ""}`
                      return (
                        <li
                          key={alloc.allocation_id}
                          className="flex items-start justify-between gap-3 p-3"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-text">
                              {title}
                            </p>
                            <p className="text-xs text-muted">{subtitle}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <p className="font-mono font-semibold tabular-nums text-semantic-green">
                              {formatCurrency(alloc.amount_cents)} €
                            </p>
                            <AppButton
                              type="button"
                              onClick={() => {
                                if (
                                  confirm("Remove this reimbursement allocation?")
                                ) {
                                  removeMutation.mutate(alloc.allocation_id)
                                }
                              }}
                              disabled={removeMutation.isPending}
                              tone="ghost"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border p-0 text-muted hover:bg-faint disabled:opacity-60"
                              aria-label="Remove allocation"
                            >
                              <XIcon className="h-4 w-4" />
                            </AppButton>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">No allocations yet.</p>
                )}
              </div>

              <div className="space-y-3">
                <p className="text-sm font-semibold text-text">
                  Allocate to an expense
                </p>
                <form onSubmit={handleSearch} className="flex gap-2">
                  <AppInput
                    type="text"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    className="flex-1"
                    placeholder="Search by title or category…"
                  />
                  <AppButton
                    type="submit"
                    disabled={searchMutation.isPending}
                  >
                    {searchMutation.isPending ? "Searching…" : "Search"}
                  </AppButton>
                </form>

                {searchError ? (
                  <p className="text-xs text-semantic-red">{searchError}</p>
                ) : null}
                {allocationError ? (
                  <p className="text-xs text-semantic-red">{allocationError}</p>
                ) : null}

                {searchResults ? (
                  searchResults.length ? (
                    <ul className="space-y-2">
                      {searchResults.map((row) => {
                        const title =
                          row.expense.title ||
                          row.expense.category?.name ||
                          `Expense #${row.expense.id}`
                        const subtitle = `${formatEuroDate(row.expense.date)} · ${
                          row.expense.category?.name || "Uncategorized"
                        }`
                        const amountText =
                          allocationAmounts[row.expense.id] ||
                          (row.suggested_amount_cents > 0
                            ? (row.suggested_amount_cents / 100).toFixed(2)
                            : "")
                        return (
                          <li
                            key={row.expense.id}
                            className="rounded-lg border border-border bg-surface-hi/55 p-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate font-semibold text-text">
                                  {title}
                                </p>
                                <p className="text-xs text-muted">
                                  {subtitle}
                                </p>
                              </div>
                              <p className="font-mono font-semibold tabular-nums text-semantic-red">
                                -{formatCurrency(row.expense.amount_cents)} €
                              </p>
                            </div>

                            <div className="mt-3 grid gap-2 sm:grid-cols-2">
                              <div className="rounded-lg border border-border bg-faint p-2">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                                  Already reimbursed
                                </p>
                                <p className="font-mono text-sm font-semibold tabular-nums text-semantic-green">
                                  {formatCurrency(row.reimbursed_total_cents)} €
                                </p>
                              </div>
                              <div className="rounded-lg border border-border bg-faint p-2">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                                  Remaining
                                </p>
                                <p className="font-mono text-sm font-semibold tabular-nums text-text">
                                  {formatCurrency(
                                    row.remaining_unreimbursed_cents
                                  )}{" "}
                                  €
                                </p>
                              </div>
                            </div>

                            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                              <AppFieldLabel className="flex-1">
                                <span>Allocate amount</span>
                                <AppInput
                                  type="text"
                                  value={amountText}
                                  onChange={(event) =>
                                    setAllocationAmounts((prev) => ({
                                      ...prev,
                                      [row.expense.id]: event.target.value,
                                    }))
                                  }
                                  inputMode="decimal"
                                  placeholder="0.00"
                                />
                              </AppFieldLabel>
                              <div className="flex items-center gap-1">
                                <AppButton
                                  type="button"
                                  onClick={() =>
                                    setAllocationAmounts((prev) => ({
                                      ...prev,
                                      [row.expense.id]: (
                                        row.expense.amount_cents / 2 / 100
                                      ).toFixed(2),
                                    }))
                                  }
                                  tone="inline"
                                  className="px-2 py-1.5"
                                  title="Half"
                                >
                                  ½
                                </AppButton>
                                <AppButton
                                  type="button"
                                  onClick={() =>
                                    setAllocationAmounts((prev) => ({
                                      ...prev,
                                      [row.expense.id]: (
                                        row.expense.amount_cents / 3 / 100
                                      ).toFixed(2),
                                    }))
                                  }
                                  tone="inline"
                                  className="px-2 py-1.5"
                                  title="One third"
                                >
                                  ⅓
                                </AppButton>
                              </div>
                              <AppButton
                                type="button"
                                onClick={() => {
                                  const cents = parseAmountCents(amountText)
                                  if (cents === null) {
                                    setAllocationError("Enter a valid amount.")
                                    return
                                  }
                                  allocateMutation.mutate({
                                    expenseId: row.expense.id,
                                    amountCents: cents,
                                  })
                                }}
                                disabled={
                                  allocateMutation.isPending ||
                                  row.suggested_amount_cents <= 0
                                }
                              >
                                {allocateMutation.isPending
                                  ? "Allocating…"
                                  : "Allocate"}
                              </AppButton>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    <div className="rounded-lg border border-border bg-surface-hi/55 p-4 text-sm text-muted">
                      No matching expenses.
                    </div>
                  )
                ) : null}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-surface-hi/55 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                Reimbursed
              </p>
              <p className="font-mono text-lg font-semibold text-semantic-green tabular-nums">
                {formatCurrency(reimbursements.reimbursed_total_cents)} €
              </p>
            </div>
            <div className="rounded-lg border border-border bg-surface-hi/55 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                Net cost
              </p>
              <p className="font-mono text-lg font-semibold text-text tabular-nums">
                {formatCurrency(reimbursements.net_cost_cents)} €
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-text">
                Reimbursements applied
              </p>
              <span className="text-xs text-muted">
                {reimbursements.allocations_in.length} allocation
                {reimbursements.allocations_in.length === 1 ? "" : "s"}
              </span>
            </div>
            {reimbursements.allocations_in.length ? (
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {reimbursements.allocations_in.map((alloc) => {
                  const reimb = alloc.reimbursement_transaction
                  const title =
                    reimb.title || reimb.category?.name || `Reimbursement #${reimb.id}`
                  const subtitle = `${formatEuroDate(reimb.date)} · ${
                    reimb.category?.name || "Uncategorized"
                  }${reimb.deleted_at ? " · Deleted" : ""}`
                  return (
                    <li
                      key={alloc.allocation_id}
                      className="flex items-start justify-between gap-3 p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-text">{title}</p>
                        <p className="text-xs text-muted">{subtitle}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <p className="font-mono font-semibold tabular-nums text-semantic-green">
                          {formatCurrency(alloc.amount_cents)} €
                        </p>
                        <AppButton
                          type="button"
                          onClick={() => {
                            if (
                              confirm("Remove this reimbursement allocation?")
                            ) {
                              removeMutation.mutate(alloc.allocation_id)
                            }
                          }}
                          disabled={removeMutation.isPending}
                          tone="ghost"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border p-0 text-muted hover:bg-faint disabled:opacity-60"
                          aria-label="Remove allocation"
                        >
                          <XIcon className="h-4 w-4" />
                        </AppButton>
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted">
                No reimbursements linked to this expense.
              </p>
            )}
          </div>
        </div>
      )}
    </AppCard>
  )
}

function TransactionEditPage() {
  const { transactionId } = useParams()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const navigationState = location.state as TransactionRouteState | null
  const returnTo = navigationState?.returnTo || "/transactions"
  const hasOriginContext =
    navigationState?.hasOriginContext ?? Boolean(navigationState?.returnTo)
  const enteredFromDetail = navigationState !== null
  const detailHref = transactionId ? `/transactions/${transactionId}` : "/transactions"
  const detailBackState = { returnTo, hasOriginContext }

  const handleEditBackClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (hasOriginContext) {
      return
    }
    event.preventDefault()
    navigate(returnTo, { replace: true })
    window.setTimeout(() => {
      navigate(detailHref, { state: detailBackState })
    }, 0)
  }

  const { data: transaction, isLoading, error } = useQuery({
    queryKey: ["transaction", transactionId],
    queryFn: () => apiFetch<TransactionDetail>(`/api/transactions/${transactionId}`),
    enabled: Boolean(transactionId),
  })

  const { data: categoriesData } = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<CategoriesResponse>("/api/categories"),
  })

  const updateMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch(`/api/transactions/${transactionId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] })
      queryClient.invalidateQueries({ queryKey: ["transaction", transactionId] })
      queryClient.invalidateQueries({
        queryKey: ["transaction", Number(transactionId), "reimbursements"],
      })
      navigate(detailHref, { replace: true, state: detailBackState })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/transactions/${transactionId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] })
      queryClient.removeQueries({ queryKey: ["transaction", transactionId] })
      queryClient.removeQueries({
        queryKey: ["transaction", Number(transactionId), "reimbursements"],
      })
      if (hasOriginContext) {
        navigate(-2)
        return
      }
      if (enteredFromDetail) {
        const replaceDetailEntry = () => {
          navigate(returnTo, { replace: true })
        }
        window.addEventListener("popstate", replaceDetailEntry, { once: true })
        navigate(-1)
        return
      }
      navigate(returnTo, { replace: true })
    },
  })

  const handleDelete = () => {
    if (!confirm("Delete this transaction?")) {
      return
    }
    deleteMutation.mutate()
  }

  if (isLoading) {
    return <div className="text-muted">Loading transaction…</div>
  }
  if (error || !transaction) {
    return (
      <section className="space-y-6">
        <PageIntro title="Edit Transaction" backHref={returnTo} backLabel="← Back" />
        <AppCard className="p-5 text-semantic-red">Transaction not found.</AppCard>
      </section>
    )
  }

  return (
    <section className="space-y-6">
      <PageIntro
        title="Edit Transaction"
        backHref={detailHref}
        backState={detailBackState}
        backReplace={!hasOriginContext}
        backOnClick={handleEditBackClick}
        backLabel="← Back"
      />

      <TransactionEditForm
        key={transaction.id}
        transaction={transaction}
        categories={categoriesData?.categories || []}
        updatePending={updateMutation.isPending}
        deletePending={deleteMutation.isPending}
        updateError={updateMutation.error}
        deleteError={deleteMutation.error}
        onSubmit={(payload) => updateMutation.mutate(payload)}
        onDelete={handleDelete}
      />

      <TransactionAttachmentsCard
        transactionId={transaction.id}
        attachments={transaction.attachments}
      />

      <TransactionDurablePurchaseCard
        transactionId={transaction.id}
        transactionType={transaction.type}
        transactionDate={transaction.date}
        amountCents={transaction.amount_cents}
        durablePurchase={transaction.durable_purchase}
      />

      <TransactionReimbursementsCard transaction={transaction} />
    </section>
  )
}

export default TransactionEditPage
