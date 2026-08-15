import { useCallback, useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { XIcon } from "@phosphor-icons/react/X"
import { useNavigate } from "react-router-dom"
import { CategoryIcon } from "../components/CategoryIcon"
import TagSelector, { type TagsResponse } from "../components/TagSelector"
import TransactionDateTimeField from "../components/TransactionDateTimeField"
import SegmentedControl from "../components/SegmentedControl"
import { AppButton } from "../components/ui/product-button"
import {
  AppCheckbox,
  AppFieldLabel,
  AppInput,
  AppNativeSelect,
  AppTextarea,
} from "../components/ui/product-fields"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog"
import { apiFetch } from "./api"
import type {
  CategoriesResponse,
  TemplateRow,
  TemplatesResponse,
} from "./api-types"

type AddTransactionSheetProps = {
  open: boolean
  onClose: () => void
}

function currentLocalDateTime() {
  const now = new Date()
  now.setSeconds(0, 0)
  const timezoneOffsetMs = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - timezoneOffsetMs).toISOString().slice(0, 16)
}

function AddTransactionSheet({ open, onClose }: AddTransactionSheetProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const amountInputRef = useRef<HTMLInputElement | null>(null)
  const submitButtonRef = useRef<HTMLButtonElement | null>(null)

  const [occurredAt, setOccurredAt] = useState(currentLocalDateTime)
  const [type, setType] = useState("expense")
  const [amount, setAmount] = useState("")
  const [categoryId, setCategoryId] = useState("")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [explicitTags, setExplicitTags] = useState<string[]>([])
  const [excludedScheduledTags, setExcludedScheduledTags] = useState<string[]>([])
  const [isReimbursement, setIsReimbursement] = useState(false)
  const [formError, setFormError] = useState("")

  const resetForm = useCallback(() => {
    setOccurredAt(currentLocalDateTime())
    setAmount("")
    setTitle("")
    setDescription("")
    setExplicitTags([])
    setExcludedScheduledTags([])
    setType("expense")
    setCategoryId("")
    setIsReimbursement(false)
    setFormError("")
  }, [])

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

  const {
    data: tagsData,
    isError: tagsLoadFailed,
    isFetching: tagsLoading,
  } = useQuery({
    queryKey: ["tags", "all"],
    queryFn: () => apiFetch<TagsResponse>("/api/tags?period=all"),
    enabled: open,
  })

  const categories = (categoriesData?.categories || []).filter(
    (category) => category.archived_at === null
  )
  const filteredCategories = categories.filter((category) => category.type === type)
  const resolvedCategoryId = categoryId
  const templates = templatesData?.templates || []
  const transactionDate = occurredAt.slice(0, 10)
  const scheduledTags = (tagsData?.tags ?? [])
    .filter(
      (tag) =>
        tag.auto_attach_period &&
        tag.auto_attach_period.start <= transactionDate &&
        tag.auto_attach_period.end >= transactionDate,
    )
    .map((tag) => tag.name)
  const excludedScheduledLower = new Set(
    excludedScheduledTags.map((name) => name.toLowerCase()),
  )
  const tags = explicitTags.filter(
    (name) => !excludedScheduledLower.has(name.toLowerCase()),
  )
  for (const name of scheduledTags) {
    if (
      !excludedScheduledLower.has(name.toLowerCase()) &&
      !tags.some((entry) => entry.toLowerCase() === name.toLowerCase())
    ) {
      tags.push(name)
    }
  }
  const scheduledSelectedTags = scheduledTags.filter((name) =>
    tags.some((entry) => entry.toLowerCase() === name.toLowerCase()),
  )

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<{ id: number }>("/api/transactions", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] })
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      queryClient.invalidateQueries({ queryKey: ["insights"] })
      queryClient.invalidateQueries({ queryKey: ["budgets"] })
      queryClient.invalidateQueries({ queryKey: ["forecast"] })
      resetForm()
      onClose()
    },
  })

  // The sheet stays mounted after its first open (so close can animate), so
  // each reopen starts from a fresh form instead of a stale draft or a
  // leftover create error.
  const { reset: resetCreateMutation } = createMutation
  const wasOpen = useRef(open)
  useEffect(() => {
    if (open && !wasOpen.current) {
      resetForm()
      resetCreateMutation()
    }
    wasOpen.current = open
  }, [open, resetForm, resetCreateMutation])

  const parseAmount = (raw: string) => {
    const normalized = raw.replace(/\s/g, "").replace(",", ".")
    const value = Number(normalized)
    if (!Number.isFinite(value) || value < 0) {
      return null
    }
    return Math.round(value * 100)
  }

  const applyTemplate = (template: TemplateRow) => {
    setType(template.type)
    setCategoryId(String(template.category_id))
    setTitle(template.title || "")
    setDescription("")
    setExplicitTags(template.tags)
    setFormError("")
    if (template.type !== "income") {
      setIsReimbursement(false)
    }
    if (template.default_amount_cents === null) {
      setAmount("")
      window.setTimeout(() => {
        amountInputRef.current?.focus()
      }, 0)
      return
    }
    setAmount((template.default_amount_cents / 100).toFixed(2))
    window.setTimeout(() => {
      submitButtonRef.current?.focus()
    }, 0)
  }

  const handleTagsChange = (next: string[]) => {
    const currentLower = new Set(tags.map((name) => name.toLowerCase()))
    const nextLower = new Set(next.map((name) => name.toLowerCase()))
    const removed = tags.filter((name) => !nextLower.has(name.toLowerCase()))
    const added = next.filter((name) => !currentLower.has(name.toLowerCase()))
    const removedLower = new Set(removed.map((name) => name.toLowerCase()))
    const activeScheduledLower = new Set(
      scheduledTags.map((name) => name.toLowerCase()),
    )

    setExplicitTags((current) => {
      const updated = current.filter(
        (name) => !removedLower.has(name.toLowerCase()),
      )
      for (const name of added) {
        if (!updated.some((entry) => entry.toLowerCase() === name.toLowerCase())) {
          updated.push(name)
        }
      }
      return updated
    })
    setExcludedScheduledTags((current) => {
      const updated = new Set(current.map((name) => name.toLowerCase()))
      for (const name of added) updated.delete(name.toLowerCase())
      for (const name of removed) {
        if (activeScheduledLower.has(name.toLowerCase())) {
          updated.add(name.toLowerCase())
        }
      }
      return Array.from(updated)
    })
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError("")
    if (!tagsData || tagsLoading || tagsLoadFailed) {
      setFormError("Wait for tags to load before adding the transaction")
      return
    }
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
    createMutation.mutate({
      date: occurredAt.slice(0, 10),
      occurred_at: `${occurredAt}:00`,
      type,
      amount_cents: amountCents,
      category_id: resolvedCategoryId ? Number(resolvedCategoryId) : null,
      title: title.trim(),
      description: description.trim() || null,
      is_reimbursement: type === "income" ? isReimbursement : false,
      tags,
    })
  }

  const closeDisabled = createMutation.isPending
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !closeDisabled) {
      onClose()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        aria-label="Add transaction"
        className="max-h-[calc(100dvh-2.5rem-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px))] w-[calc(100%-2rem)] max-w-2xl overflow-hidden p-5 md:max-h-[calc(100vh-2rem)]"
      >
          <div className="-mr-5 flex-1 overflow-y-auto pr-5">
            <DialogHeader>
              <div>
                <DialogTitle>Add transaction</DialogTitle>
              </div>
              <DialogClose asChild>
                <AppButton
                  tone="ghost"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface-hi/70 p-0 text-muted hover:border-border-hi hover:text-text"
                  aria-label="Close"
                  disabled={closeDisabled}
                >
                  <XIcon className="h-4 w-4" />
                </AppButton>
              </DialogClose>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="space-y-3">
              {templates.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Templates
                  </p>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {templates.map((template) => (
                      <AppButton
                        key={template.id}
                        type="button"
                        onClick={() => applyTemplate(template)}
                        tone="inline"
                        className="shrink-0 border-border bg-surface-hi/80 text-text hover:border-border-hi hover:bg-faint/80"
                      >
                        <CategoryIcon
                          icon={template.category?.icon ?? null}
                          label={template.category?.name ?? template.name}
                        />
                        <span>{template.name}</span>
                      </AppButton>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        onClose()
                        navigate("/templates")
                      }}
                      className="shrink-0 self-center text-xs text-muted underline-offset-2 hover:text-text hover:underline"
                    >
                      Manage
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <AppFieldLabel>
                  <span>Type</span>
                  <SegmentedControl
                    value={type}
                    ariaLabel="Transaction type"
                    className="w-full"
                    equalWidth
                    items={[
                      { value: "expense", label: "Expense" },
                      { value: "income", label: "Income" },
                    ]}
                    onValueChange={(value) => {
                      setType(value)
                      setCategoryId("")
                    }}
                  />
                </AppFieldLabel>
                <TransactionDateTimeField
                  value={occurredAt}
                  onChange={setOccurredAt}
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <AppFieldLabel>
                  <span>Amount</span>
                  <AppInput
                    ref={amountInputRef}
                    type="text"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    inputMode="decimal"
                    placeholder="12.34"
                    required
                  />
                </AppFieldLabel>
                <AppFieldLabel>
                  <span>Category (optional)</span>
                  <div className="flex items-center gap-2">
                    <CategoryIcon
                      icon={
                        filteredCategories.find((c) => String(c.id) === resolvedCategoryId)
                          ?.icon ?? null
                      }
                      label={
                        filteredCategories.find((c) => String(c.id) === resolvedCategoryId)
                          ?.name ?? "Uncategorized"
                      }
                    />
                    <AppNativeSelect
                      value={resolvedCategoryId}
                      onChange={(event) => setCategoryId(event.target.value)}
                    >
                      <option value="">Uncategorized</option>
                      {filteredCategories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </AppNativeSelect>
                  </div>
                </AppFieldLabel>
              </div>

              <AppFieldLabel>
                <span>Title</span>
                <AppInput
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Short title"
                  required
                />
              </AppFieldLabel>

              <div className="form-label">
                <span>Description (optional)</span>
                <AppTextarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Optional description"
                />
              </div>

              <TagSelector
                selected={tags}
                scheduled={scheduledSelectedTags}
                onChange={handleTagsChange}
              />

              {type === "income" && (
                <label className="flex items-center gap-3 rounded-xl border border-border bg-surface-hi/60 px-3.5 py-3 text-xs text-muted">
                  <AppCheckbox
                    checked={isReimbursement}
                    onCheckedChange={(checked) => setIsReimbursement(checked === true)}
                  />
                  This is a reimbursement
                </label>
              )}

              {formError && <p className="text-xs text-semantic-red">{formError}</p>}
              {tagsLoading && (
                <p className="text-xs text-muted">Checking scheduled tags…</p>
              )}
              {createMutation.error && (
                <p className="text-xs text-semantic-red">{String(createMutation.error)}</p>
              )}

              <div className="sticky bottom-0 -mx-5 flex gap-2 border-t border-border bg-surface/95 px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] pt-3 backdrop-blur">
                <AppButton
                  ref={submitButtonRef}
                  type="submit"
                  className="flex-1"
                  disabled={
                    createMutation.isPending ||
                    tagsLoading ||
                    tagsLoadFailed ||
                    !tagsData
                  }
                >
                  {createMutation.isPending ? "Saving..." : "Add transaction"}
                </AppButton>
                <AppButton
                  type="button"
                  onClick={onClose}
                  tone="ghost"
                  disabled={closeDisabled}
                >
                  Cancel
                </AppButton>
              </div>
            </form>
          </div>
      </DialogContent>
    </Dialog>
  )
}

export default AddTransactionSheet
