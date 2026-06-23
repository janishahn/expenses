import { useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowDownIcon } from "@phosphor-icons/react/ArrowDown"
import { ArrowUpIcon } from "@phosphor-icons/react/ArrowUp"
import { TrashIcon } from "@phosphor-icons/react/Trash"
import { apiFetch } from "../app/api"
import type {
  CategoriesResponse,
  TemplateRow,
  TemplatesResponse,
} from "../app/api-types"
import { formatCurrency } from "../app/format"
import { CategoryIcon } from "../components/CategoryIcon"
import PageIntro from "../components/PageIntro"
import { AppButton } from "../components/ui/product-button"
import { AppCard } from "../components/ui/product-card"
import {
  AppFieldLabel,
  AppInput,
  AppNativeSelect,
} from "../components/ui/product-fields"

function TemplatesPage() {
  const queryClient = useQueryClient()
  const formRef = useRef<HTMLFormElement | null>(null)
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [name, setName] = useState("")
  const [type, setType] = useState("expense")
  const [categoryId, setCategoryId] = useState("")
  const [defaultAmount, setDefaultAmount] = useState("")
  const [title, setTitle] = useState("")
  const [tags, setTags] = useState("")
  const [formError, setFormError] = useState("")

  const { data, isLoading, error } = useQuery({
    queryKey: ["templates"],
    queryFn: () => apiFetch<TemplatesResponse>("/api/templates"),
  })

  const { data: categoriesData } = useQuery({
    queryKey: ["categories", "all"],
    queryFn: () => apiFetch<CategoriesResponse>("/api/categories?period=all"),
  })

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<TemplateRow>("/api/templates", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] })
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      resetForm()
    },
    onError: (err) => {
      setFormError(String(err))
    },
  })

  const updateMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<TemplateRow>(`/api/templates/${editingId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] })
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      resetForm()
    },
    onError: (err) => {
      setFormError(String(err))
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (templateId: number) =>
      apiFetch<{ status: string }>(`/api/templates/${templateId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] })
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      if (editingId) {
        resetForm()
      }
    },
  })

  const reorderMutation = useMutation({
    mutationFn: (templateIds: number[]) =>
      apiFetch<{ status: string }>("/api/templates/reorder", {
        method: "POST",
        body: JSON.stringify({ template_ids: templateIds }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] })
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
    },
  })

  const templates = data?.templates || []
  const categories = (categoriesData?.categories || []).filter(
    (category) => !category.archived_at
  )
  const categoryOptions = useMemo(
    () => categories.filter((category) => category.type === type),
    [categories, type]
  )

  const parseAmount = (raw: string) => {
    const clean = raw.trim()
    if (!clean) {
      return null
    }
    const normalized = clean.replace(/\s/g, "").replace(",", ".")
    const value = Number(normalized)
    if (!Number.isFinite(value) || value < 0) {
      return null
    }
    return Math.round(value * 100)
  }

  const resetForm = () => {
    const defaultType = "expense"
    const defaultCategory = categories.find((c) => c.type === defaultType)
    setEditingId(null)
    setName("")
    setType(defaultType)
    setCategoryId(defaultCategory ? String(defaultCategory.id) : "")
    setDefaultAmount("")
    setTitle("")
    setTags("")
    setFormError("")
  }

  const jumpToForm = () => {
    resetForm()
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      nameInputRef.current?.focus()
    })
  }

  const handleEdit = (template: TemplateRow) => {
    setEditingId(template.id)
    setName(template.name)
    setType(template.type)
    setCategoryId(String(template.category_id))
    setDefaultAmount(
      template.default_amount_cents === null
        ? ""
        : (template.default_amount_cents / 100).toFixed(2)
    )
    setTitle(template.title || "")
    setTags(template.tags.join(", "))
    setFormError("")
  }

  const handleMove = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= templates.length) {
      return
    }
    const next = templates.map((template) => template.id)
    const [moved] = next.splice(index, 1)
    next.splice(nextIndex, 0, moved)
    reorderMutation.mutate(next)
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError("")

    const trimmedName = name.trim()
    if (!trimmedName) {
      setFormError("Name is required.")
      return
    }
    if (!categoryId) {
      setFormError("Category is required.")
      return
    }

    const amountCents = parseAmount(defaultAmount)
    if (defaultAmount.trim() && amountCents === null) {
      setFormError("Default amount must be a valid number.")
      return
    }

    const payload = {
      name: trimmedName,
      type,
      category_id: Number(categoryId),
      default_amount_cents: amountCents,
      title: title.trim() || null,
      tags: tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    }

    if (editingId) {
      updateMutation.mutate(payload)
      return
    }
    createMutation.mutate(payload)
  }

  if (isLoading) {
    return <div className="text-muted">Loading templates…</div>
  }

  if (error) {
    return <div className="text-semantic-red">Unable to load templates.</div>
  }

  const busy =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending ||
    reorderMutation.isPending

  return (
    <section className="space-y-6">
      <PageIntro
        title="Templates"
        actions={
          <AppButton
            type="button"
            onClick={jumpToForm}
            className="desk:hidden"
          >
            Add template
          </AppButton>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <AppCard>
          <div className="surface-section-header flex items-center justify-between">
            <h2 className="font-head text-lg font-bold">Templates</h2>
            <span className="chip text-xs">
              {templates.length}
            </span>
          </div>
          <div className="divide-y divide-border">
            {templates.length ? (
              templates.map((template, index) => (
                <div
                  key={template.id}
                  className="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <CategoryIcon icon={template.category?.icon ?? null} />
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-text">{template.name}</p>
                      <p className="truncate text-xs text-muted">
                        {template.category?.name ?? "Unknown category"}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {template.default_amount_cents === null
                          ? "Variable"
                          : `${formatCurrency(template.default_amount_cents)} €`}
                      </p>
                      {template.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {template.tags.map((tag) => (
                            <span key={`${template.id}-${tag}`} className="chip text-[11px]">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <AppButton
                      type="button"
                      onClick={() => handleMove(index, -1)}
                      tone="ghost"
                      className="px-2 py-1"
                      aria-label={`Move ${template.name} up`}
                      disabled={busy || index === 0}
                    >
                      <ArrowUpIcon className="h-3.5 w-3.5" />
                    </AppButton>
                    <AppButton
                      type="button"
                      onClick={() => handleMove(index, 1)}
                      tone="ghost"
                      className="px-2 py-1"
                      aria-label={`Move ${template.name} down`}
                      disabled={busy || index === templates.length - 1}
                    >
                      <ArrowDownIcon className="h-3.5 w-3.5" />
                    </AppButton>
                    <AppButton
                      type="button"
                      onClick={() => handleEdit(template)}
                      tone="inline"
                      disabled={busy}
                    >
                      Edit
                    </AppButton>
                    <AppButton
                      type="button"
                      onClick={() => {
                        if (confirm(`Delete template "${template.name}"?`)) {
                          deleteMutation.mutate(template.id)
                        }
                      }}
                      tone="inlineDanger"
                      disabled={busy}
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                      Delete
                    </AppButton>
                  </div>
                </div>
              ))
            ) : (
              <div className="px-4 py-6 text-sm text-muted">
                No templates yet. Create one to speed up daily logging.
              </div>
            )}
          </div>
        </AppCard>

        <AppCard>
          <form ref={formRef} onSubmit={handleSubmit} className="editor-rail">
            <div className="surface-section-header">
              <h2 className="font-head text-lg font-bold">
                {editingId ? "Edit template" : "Add template"}
              </h2>
            </div>
            <div className="surface-section-body space-y-4">
              <AppFieldLabel>
                Name
                <AppInput
                  ref={nameInputRef}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="mt-1"
                  required
                />
              </AppFieldLabel>

              <AppFieldLabel>
                Type
                <AppNativeSelect
                  value={type}
                  onChange={(event) => {
                    const nextType = event.target.value
                    const defaultCategory = categories.find(
                      (category) => category.type === nextType
                    )
                    setType(nextType)
                    setCategoryId(defaultCategory ? String(defaultCategory.id) : "")
                  }}
                  className="mt-1"
                >
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </AppNativeSelect>
              </AppFieldLabel>

              <AppFieldLabel>
                Category
                <AppNativeSelect
                  value={categoryId}
                  onChange={(event) => setCategoryId(event.target.value)}
                  className="mt-1"
                  required
                >
                  <option value="">Select category</option>
                  {categoryOptions.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </AppNativeSelect>
              </AppFieldLabel>

              <AppFieldLabel>
                Default amount (optional)
                <AppInput
                  value={defaultAmount}
                  onChange={(event) => setDefaultAmount(event.target.value)}
                  inputMode="decimal"
                  className="mt-1"
                  placeholder="12.34"
                />
                <span className="mt-1 block text-[11px] text-muted">
                  Leave empty to enter the amount each time.
                </span>
              </AppFieldLabel>

              <AppFieldLabel>
                Title (optional)
                <AppInput
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="mt-1"
                  placeholder="Short title"
                />
              </AppFieldLabel>

              <AppFieldLabel>
                Tags (comma-separated)
                <AppInput
                  value={tags}
                  onChange={(event) => setTags(event.target.value)}
                  className="mt-1"
                  placeholder="e.g. work, weekly"
                />
              </AppFieldLabel>

              {formError && <p className="text-xs text-semantic-red">{formError}</p>}

              <div className="flex gap-2">
                <AppButton type="submit" className="flex-1" disabled={busy}>
                  {editingId
                    ? updateMutation.isPending
                      ? "Saving…"
                      : "Save template"
                    : createMutation.isPending
                      ? "Saving…"
                      : "Save template"}
                </AppButton>
                {editingId && (
                  <AppButton
                    type="button"
                    onClick={resetForm}
                    tone="ghost"
                    disabled={busy}
                  >
                    Cancel
                  </AppButton>
                )}
              </div>
            </div>
          </form>
        </AppCard>
      </div>
    </section>
  )
}

export default TemplatesPage
