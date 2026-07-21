import { useCallback, useEffect, useMemo, useState } from "react"
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  arrayMove,
  sortableKeyboardCoordinates,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { DotsSixVerticalIcon } from "@phosphor-icons/react/DotsSixVertical"
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple"
import { TrashIcon } from "@phosphor-icons/react/Trash"
import { XIcon } from "@phosphor-icons/react/X"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useOutletContext } from "react-router-dom"
import { apiFetch } from "../app/api"
import type {
  CategoriesResponse,
  TemplateRow,
  TemplatesResponse,
} from "../app/api-types"
import type { AppShellOutletContext } from "../app/AppShell"
import { formatCurrency } from "../app/format"
import { CategoryIcon } from "../components/CategoryIcon"
import PageIntro from "../components/PageIntro"
import {
  FinancialPanel,
  SectionHeading,
} from "../components/product/ProductSurfaces"
import { AppButton } from "../components/ui/product-button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog"
import {
  AppFieldLabel,
  AppInput,
  AppNativeSelect,
} from "../components/ui/product-fields"

type SortableTemplateRowProps = {
  template: TemplateRow
  busy: boolean
  onEdit: (template: TemplateRow) => void
  onDelete: (template: TemplateRow) => void
}

function SortableTemplateRow({
  template,
  busy,
  onEdit,
  onDelete,
}: SortableTemplateRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: template.id, disabled: busy })

  return (
    <div
      ref={setNodeRef}
      data-testid="template-row"
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex flex-col gap-3 px-4 py-3.5 transition-[background-color,opacity] md:flex-row md:items-center md:justify-between ${
        isDragging
          ? "relative z-10 bg-surface-hi opacity-90 shadow-[var(--shadow-raised)]"
          : "hover:bg-faint/60"
      }`}
    >
      <div className="flex min-w-0 items-start gap-3">
        <AppButton
          ref={setActivatorNodeRef}
          type="button"
          tone="ghost"
          className="h-9 w-8 shrink-0 cursor-grab touch-none p-0 active:cursor-grabbing"
          aria-label={`Reorder ${template.name}`}
          disabled={busy}
          {...attributes}
          {...listeners}
        >
          <DotsSixVerticalIcon className="h-4 w-4" aria-hidden="true" />
        </AppButton>
        <CategoryIcon
          icon={template.category?.icon ?? null}
          label={template.category?.name}
        />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="truncate font-semibold text-text">{template.name}</p>
            <span className="font-mono text-xs font-semibold tabular-nums text-text">
              {template.default_amount_cents === null
                ? "Variable amount"
                : `${formatCurrency(template.default_amount_cents)} €`}
            </span>
          </div>
          <p className="truncate text-xs text-muted">
            {template.category?.name ?? "Unknown category"}
            {template.title ? ` · ${template.title}` : ""}
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
      <div className="flex flex-wrap items-center justify-end gap-2">
        <AppButton
          type="button"
          onClick={() => onEdit(template)}
          tone="inline"
          className="h-9 w-9 p-0"
          aria-label={`Edit ${template.name}`}
          disabled={busy}
        >
          <PencilSimpleIcon className="h-4 w-4" aria-hidden="true" />
        </AppButton>
        <AppButton
          type="button"
          onClick={() => onDelete(template)}
          tone="inlineDanger"
          className="h-9 w-9 p-0"
          aria-label={`Delete ${template.name}`}
          disabled={busy}
        >
          <TrashIcon className="h-4 w-4" aria-hidden="true" />
        </AppButton>
      </div>
    </div>
  )
}

function TemplatesPage() {
  const queryClient = useQueryClient()
  const { setUtilityAction } = useOutletContext<AppShellOutletContext>()
  const [editorOpen, setEditorOpen] = useState(false)
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

  const categories = useMemo(
    () =>
      (categoriesData?.categories || []).filter(
        (category) => !category.archived_at
      ),
    [categoriesData?.categories]
  )
  const categoryOptions = useMemo(
    () => categories.filter((category) => category.type === type),
    [categories, type]
  )

  const resetForm = useCallback(() => {
    const defaultType = "expense"
    const defaultCategory = categories.find((category) => category.type === defaultType)
    setEditingId(null)
    setName("")
    setType(defaultType)
    setCategoryId(defaultCategory ? String(defaultCategory.id) : "")
    setDefaultAmount("")
    setTitle("")
    setTags("")
    setFormError("")
  }, [categories])

  const openCreateEditor = useCallback(() => {
    resetForm()
    setEditorOpen(true)
  }, [resetForm])

  useEffect(() => {
    setUtilityAction({ label: "Add template", onClick: openCreateEditor })
    return () => setUtilityAction(null)
  }, [openCreateEditor, setUtilityAction])

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<TemplateRow>("/api/templates", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      setEditorOpen(false)
      resetForm()
      queryClient.invalidateQueries({ queryKey: ["templates"] })
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
    },
    onError: (mutationError) => setFormError(String(mutationError)),
  })

  const updateMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<TemplateRow>(`/api/templates/${editingId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      setEditorOpen(false)
      resetForm()
      queryClient.invalidateQueries({ queryKey: ["templates"] })
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
    },
    onError: (mutationError) => setFormError(String(mutationError)),
  })

  const deleteMutation = useMutation({
    mutationFn: (templateId: number) =>
      apiFetch<{ status: string }>(`/api/templates/${templateId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] })
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
    },
  })

  const reorderMutation = useMutation({
    mutationFn: (templateIds: number[]) =>
      apiFetch<{ status: string }>("/api/templates/reorder", {
        method: "POST",
        body: JSON.stringify({ template_ids: templateIds }),
      }),
    onMutate: async (templateIds) => {
      await queryClient.cancelQueries({ queryKey: ["templates"] })
      const previous = queryClient.getQueryData<TemplatesResponse>(["templates"])
      queryClient.setQueryData<TemplatesResponse>(["templates"], (current) => {
        if (!current) return current
        const templatesById = new Map(
          current.templates.map((template) => [template.id, template])
        )
        return {
          ...current,
          templates: templateIds
            .map((templateId) => templatesById.get(templateId))
            .filter((template): template is TemplateRow => Boolean(template)),
        }
      })
      return { previous }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
    },
    onError: (_error, _templateIds, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["templates"], context.previous)
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["templates"] }),
  })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const parseAmount = (raw: string) => {
    const clean = raw.trim()
    if (!clean) return null
    const value = Number(clean.replace(/\s/g, "").replace(",", "."))
    if (!Number.isFinite(value) || value < 0) return null
    return Math.round(value * 100)
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
    setEditorOpen(true)
  }

  const handleDelete = (template: TemplateRow) => {
    if (confirm(`Delete template "${template.name}"?`)) {
      deleteMutation.mutate(template.id)
    }
  }

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const oldIndex = orderedTemplates.findIndex((template) => template.id === active.id)
    const newIndex = orderedTemplates.findIndex((template) => template.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const next = arrayMove(orderedTemplates, oldIndex, newIndex)
    reorderMutation.mutate(next.map((template) => template.id))
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
      tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
    }
    if (editingId) {
      updateMutation.mutate(payload)
    } else {
      createMutation.mutate(payload)
    }
  }

  if (isLoading) return <div className="text-muted">Loading templates…</div>
  if (error) return <div className="text-semantic-red">Unable to load templates.</div>

  const busy =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending ||
    reorderMutation.isPending
  const orderedTemplates = data?.templates ?? []

  return (
    <section className="space-y-6">
      <PageIntro title="Templates" />

      <FinancialPanel role="ledger" data-testid="template-library">
        <SectionHeading>
          <div>
            <h2 className="font-head text-lg font-bold">Quick-add library</h2>
            <p className="mt-0.5 text-xs text-muted">
              Drag shortcuts into the order you use them
            </p>
          </div>
          <span className="rounded-full bg-faint px-2.5 py-1 text-xs text-muted">
            {orderedTemplates.length}
          </span>
        </SectionHeading>
        {orderedTemplates.length ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={orderedTemplates.map((template) => template.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="divide-y divide-border">
                {orderedTemplates.map((template) => (
                  <SortableTemplateRow
                    key={template.id}
                    template={template}
                    busy={busy}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="px-4 py-6 text-sm text-muted">
            No templates yet. Create one to speed up daily logging.
          </div>
        )}
      </FinancialPanel>

      <Dialog
        open={editorOpen}
        onOpenChange={(open) => {
          if (!open && !createMutation.isPending && !updateMutation.isPending) {
            setEditorOpen(false)
          }
        }}
      >
        <DialogContent
          aria-label={editingId ? "Edit template" : "Add template"}
          className="max-h-[calc(100dvh-2rem)] overflow-hidden p-5"
        >
          <div className="-mr-5 overflow-y-auto pr-5">
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit template" : "Add template"}</DialogTitle>
              <DialogClose asChild>
                <AppButton
                  tone="ghost"
                  className="h-9 w-9 rounded-full p-0"
                  aria-label="Close template editor"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  <XIcon className="h-4 w-4" aria-hidden="true" />
                </AppButton>
              </DialogClose>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <AppFieldLabel>
                  Name
                  <AppInput
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="mt-1"
                    autoFocus
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
              </div>
              {formError ? <p className="text-xs text-semantic-red">{formError}</p> : null}
              <div className="flex gap-2 border-t border-border pt-4">
                <AppButton type="submit" className="flex-1" disabled={busy}>
                  {createMutation.isPending || updateMutation.isPending
                    ? "Saving…"
                    : editingId
                      ? "Save changes"
                      : "Add template"}
                </AppButton>
                <AppButton
                  type="button"
                  onClick={() => setEditorOpen(false)}
                  tone="ghost"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  Cancel
                </AppButton>
              </div>
            </form>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}

export default TemplatesPage
