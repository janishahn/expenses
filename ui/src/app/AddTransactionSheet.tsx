import { useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { XIcon } from "@phosphor-icons/react/X"
import { useNavigate } from "react-router-dom"
import { CategoryIcon } from "../components/CategoryIcon"
import TagSelector from "../components/TagSelector"
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

function AddTransactionSheet({ open, onClose }: AddTransactionSheetProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const amountInputRef = useRef<HTMLInputElement | null>(null)
  const submitButtonRef = useRef<HTMLButtonElement | null>(null)

  const [occurredAt, setOccurredAt] = useState(() => {
    const now = new Date()
    now.setSeconds(0, 0)
    const timezoneOffsetMs = now.getTimezoneOffset() * 60_000
    return new Date(now.getTime() - timezoneOffsetMs).toISOString().slice(0, 16)
  })
  const [type, setType] = useState("expense")
  const [amount, setAmount] = useState("")
  const [categoryId, setCategoryId] = useState("")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [tags, setTags] = useState<string[]>([])
  const [isReimbursement, setIsReimbursement] = useState(false)
  const [formError, setFormError] = useState("")

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

  const categories = (categoriesData?.categories || []).filter(
    (category) => category.archived_at === null
  )
  const filteredCategories = categories.filter((category) => category.type === type)
  const resolvedCategoryId = categoryId
  const templates = templatesData?.templates || []

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
      setOccurredAt(() => {
        const now = new Date()
        now.setSeconds(0, 0)
        const timezoneOffsetMs = now.getTimezoneOffset() * 60_000
        return new Date(now.getTime() - timezoneOffsetMs).toISOString().slice(0, 16)
      })
      setAmount("")
      setTitle("")
      setDescription("")
      setTags([])
      setType("expense")
      setCategoryId("")
      setIsReimbursement(false)
      setFormError("")
      onClose()
    },
  })

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
    setTags(template.tags)
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

              <TagSelector selected={tags} onChange={setTags} />

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
              {createMutation.error && (
                <p className="text-xs text-semantic-red">{String(createMutation.error)}</p>
              )}

              <div className="sticky bottom-0 -mx-5 flex gap-2 border-t border-border bg-surface/95 px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] pt-3 backdrop-blur">
                <AppButton
                  ref={submitButtonRef}
                  type="submit"
                  className="flex-1"
                  disabled={createMutation.isPending}
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
