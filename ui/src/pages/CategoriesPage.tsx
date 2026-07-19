import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArchiveIcon } from "@phosphor-icons/react/Archive"
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple"
import { XIcon } from "@phosphor-icons/react/X"
import { useOutletContext, useSearchParams } from "react-router-dom"
import { apiFetch } from "../app/api"
import type { CategoryListItem } from "../app/api-types"
import type { AppShellOutletContext } from "../app/AppShell"
import { formatEuroDate } from "../app/format"
import { CategoryIcon } from "../components/CategoryIcon"
import PageIntro from "../components/PageIntro"
import PeriodPicker from "../components/PeriodPicker"
import { DEFAULT_CATEGORY_ICON_KEY } from "../components/categoryIconsCatalog"
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
import {
  buildCustomPeriodSearchParams,
  buildPresetPeriodSearchParams,
  type PresetPeriod,
} from "../lib/searchParams"

const IconPicker = lazy(() =>
  import("../components/IconPicker").then((module) => ({
    default: module.IconPicker,
  }))
)

type CategoriesPageResponse = {
  period: { slug: string; start: string; end: string }
  categories: CategoryListItem[]
}

const formatMutationError = (error: unknown) => {
  if (error instanceof Error) {
    const message = error.message.trim()
    if (message.startsWith("{")) {
      try {
        const parsed = JSON.parse(message) as { detail?: unknown }
        if (typeof parsed.detail === "string" && parsed.detail.trim()) {
          return parsed.detail
        }
      } catch {
        return message
      }
    }
    return message
  }
  if (typeof error === "string") {
    return error
  }
  return "Request failed."
}

function CategoriesPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const { setUtilityAction } = useOutletContext<AppShellOutletContext>()
  const [editorOpen, setEditorOpen] = useState(false)
  const [name, setName] = useState("")
  const [type, setType] = useState("expense")
  const [icon, setIcon] = useState(DEFAULT_CATEGORY_ICON_KEY)
  const [order, setOrder] = useState("0")
  const [sortIncome, setSortIncome] = useState("usage")
  const [sortExpense, setSortExpense] = useState("usage")
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null)
  const [editName, setEditName] = useState("")
  const [editIcon, setEditIcon] = useState(DEFAULT_CATEGORY_ICON_KEY)
  const [editOrder, setEditOrder] = useState("0")
  const [editType, setEditType] = useState("expense")
  const [mergeSourceId, setMergeSourceId] = useState("")
  const [mergeTargetId, setMergeTargetId] = useState("")
  const [mergePreview, setMergePreview] = useState<Record<string, number> | null>(null)
  const [mergeConfirmOpen, setMergeConfirmOpen] = useState(false)
  const [mergeOutcomeMessage, setMergeOutcomeMessage] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)

  useEffect(() => {
    if (!savedFlash) {
      return
    }
    const id = window.setTimeout(() => setSavedFlash(false), 2100)
    return () => window.clearTimeout(id)
  }, [savedFlash])

  const queryString = useMemo(() => {
    const params = new URLSearchParams(searchParams)
    if (!params.get("period")) {
      params.set("period", "all")
    }
    return params.toString()
  }, [searchParams])

  const { data, isLoading, error } = useQuery({
    queryKey: ["categories", queryString],
    queryFn: () => apiFetch<CategoriesPageResponse>(`/api/categories?${queryString}`),
  })

  const resetEditState = useCallback(() => {
    setEditingCategoryId(null)
    setEditName("")
    setEditIcon(DEFAULT_CATEGORY_ICON_KEY)
    setEditOrder("0")
    setEditType("expense")
  }, [])

  const normalizeIconKey = (iconKey: string) =>
    iconKey.length > 0 ? iconKey : DEFAULT_CATEGORY_ICON_KEY

  const createMutation = useMutation({
    mutationFn: (payload: { name: string; type: string; icon: string; order: number }) =>
      apiFetch<CategoryListItem>("/api/categories", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      setEditorOpen(false)
      setName("")
      setIcon(DEFAULT_CATEGORY_ICON_KEY)
      setOrder("0")
      queryClient.invalidateQueries({ queryKey: ["categories"] })
      setSavedFlash(true)
    },
  })

  const updateMutation = useMutation({
    mutationFn: (payload: { id: number; name: string; icon: string; order: number }) =>
      apiFetch<CategoryListItem>(`/api/categories/${payload.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: payload.name,
          icon: payload.icon,
          order: payload.order,
        }),
      }),
  })

  const archiveMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch<{ status: string }>(`/api/categories/${id}/archive`, {
        method: "POST",
      }),
    onSuccess: (_result, id) => {
      if (editingCategoryId === id) {
        setEditorOpen(false)
        resetEditState()
      }
      queryClient.invalidateQueries({ queryKey: ["categories"] })
    },
  })

  const restoreMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch<{ status: string }>(`/api/categories/${id}/restore`, {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] })
    },
  })

  const mergePreviewMutation = useMutation({
    mutationFn: (payload: { source_category_id: number; target_category_id: number }) =>
      apiFetch<{ counts: Record<string, number> }>("/api/categories/merge/preview", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (result) => setMergePreview(result.counts),
  })

  const mergeApplyMutation = useMutation({
    mutationFn: (payload: { source_category_id: number; target_category_id: number }) =>
      apiFetch<{ counts: Record<string, number> }>("/api/categories/merge", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      setMergePreview(null)
      setMergeConfirmOpen(false)
      setMergeOutcomeMessage("Categories merged. Source category was archived.")
      setMergeSourceId("")
      setMergeTargetId("")
      queryClient.invalidateQueries({ queryKey: ["categories"] })
      queryClient.invalidateQueries({ queryKey: ["transactions"] })
      queryClient.invalidateQueries({ queryKey: ["insights"] })
      queryClient.invalidateQueries({ queryKey: ["budgets"] })
      queryClient.invalidateQueries({ queryKey: ["recurring"] })
      queryClient.invalidateQueries({ queryKey: ["rules"] })
    },
  })

  const setPresetPeriod = (value: PresetPeriod) =>
    setSearchParams(buildPresetPeriodSearchParams(searchParams, value))

  const applyCustomPeriod = (start: string, end: string) =>
    setSearchParams(buildCustomPeriodSearchParams(searchParams, start, end))

  const parseOrder = (value: string) => {
    const parsed = Number.parseInt(value, 10)
    if (Number.isNaN(parsed)) {
      return 0
    }
    return parsed
  }

  const handleCreate = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    createMutation.mutate({
      name: name.trim(),
      type,
      icon: normalizeIconKey(icon),
      order: parseOrder(order),
    })
  }

  const resetCreateMutation = createMutation.reset
  const openCreateEditor = useCallback(() => {
    resetCreateMutation()
    resetEditState()
    setName("")
    setType("expense")
    setIcon(DEFAULT_CATEGORY_ICON_KEY)
    setOrder("0")
    setEditorOpen(true)
  }, [resetCreateMutation, resetEditState])

  useEffect(() => {
    setUtilityAction({ label: "Add category", onClick: openCreateEditor })
    return () => setUtilityAction(null)
  }, [openCreateEditor, setUtilityAction])

  const startEdit = (row: CategoryListItem) => {
    updateMutation.reset()
    setEditingCategoryId(row.id)
    setEditName(row.name)
    setEditIcon(row.icon ?? DEFAULT_CATEGORY_ICON_KEY)
    setEditOrder(String(row.order))
    setEditType(row.type)
    setEditorOpen(true)
  }

  const closeEditor = () => {
    if (updateMutation.isPending) {
      return
    }
    setEditorOpen(false)
    resetEditState()
  }

  const submitEdit = () => {
    if (!editingCategoryId) {
      return
    }
    updateMutation.mutate(
      {
        id: editingCategoryId,
        name: editName.trim(),
        icon: normalizeIconKey(editIcon),
        order: parseOrder(editOrder),
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["categories"] })
          setEditorOpen(false)
          resetEditState()
          setSavedFlash(true)
        },
      }
    )
  }

  const handleEditSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    submitEdit()
  }

  if (isLoading) {
    return <div className="text-muted">Loading categories…</div>
  }
  if (error || !data) {
    return <div className="text-semantic-red">Unable to load categories.</div>
  }

  const activeCategories = data.categories.filter((row) => !row.archived_at)
  const archivedCategories = data.categories.filter((row) => row.archived_at)
  const isEditing = editingCategoryId !== null
  const iconPickerFallback = (
    <div className="rounded-lg bg-faint px-3 py-2 text-xs text-muted">
      Loading icon picker…
    </div>
  )

  const sortedCategories = (rows: CategoryListItem[], mode: string) => {
    const sorted = [...rows]
    sorted.sort((a, b) => {
      if (mode === "usage") {
        const aUsage = a.usage_count ?? 0
        const bUsage = b.usage_count ?? 0
        if (bUsage !== aUsage) {
          return bUsage - aUsage
        }
      }
      return a.name.localeCompare(b.name)
    })
    return sorted
  }

  const incomeCategories = sortedCategories(
    activeCategories.filter((row) => row.type === "income"),
    sortIncome
  )
  const expenseCategories = sortedCategories(
    activeCategories.filter((row) => row.type === "expense"),
    sortExpense
  )
  const mergeCandidates = [...incomeCategories, ...expenseCategories]
  const mergeSource = mergeCandidates.find((row) => String(row.id) === mergeSourceId)
  const mergeTarget = mergeCandidates.find((row) => String(row.id) === mergeTargetId)
  const mergeTargets = mergeSource
    ? mergeCandidates.filter(
        (row) => row.id !== mergeSource.id && row.type === mergeSource.type
      )
    : []

  const runMergePreview = () => {
    setMergePreview(null)
    setMergeConfirmOpen(false)
    setMergeOutcomeMessage(null)
    mergeApplyMutation.reset()
    if (!mergeSourceId || !mergeTargetId) {
      return
    }
    mergePreviewMutation.mutate({
      source_category_id: Number(mergeSourceId),
      target_category_id: Number(mergeTargetId),
    })
  }

  const openMergeConfirmation = () => {
    if (!mergeSourceId || !mergeTargetId) {
      return
    }
    setMergeOutcomeMessage(null)
    mergePreviewMutation.reset()
    mergeApplyMutation.reset()
    setMergeConfirmOpen(true)
  }

  const runMergeApply = () => {
    if (!mergeSourceId || !mergeTargetId) {
      return
    }
    mergePreviewMutation.reset()
    mergeApplyMutation.mutate({
      source_category_id: Number(mergeSourceId),
      target_category_id: Number(mergeTargetId),
    })
  }

  const mergeError =
    mergeApplyMutation.error || mergePreviewMutation.error
      ? formatMutationError(mergeApplyMutation.error || mergePreviewMutation.error)
      : null
  const showsGuardedBudgetError = Boolean(
    mergeError?.toLowerCase().includes("overlapping budget scopes")
  )

  return (
    <section className="space-y-6">
      <PageIntro title="Categories" />

      <PeriodPicker
        periodSlug={data.period.slug}
        start={data.period.start}
        end={data.period.end}
        onSetPreset={setPresetPeriod}
        onApplyCustom={applyCustomPeriod}
      />

      <div className="grid grid-cols-1 items-start gap-4 desk:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
        <div
          className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2"
          data-testid="category-library"
        >
          <FinancialPanel role="ledger">
            <SectionHeading className="items-stretch max-sm:flex-col sm:items-end">
              <div>
                <h2 className="font-head text-lg font-bold">Income categories</h2>
                <p className="mt-0.5 text-xs text-muted">
                  {incomeCategories.length} active
                </p>
              </div>
              <AppFieldLabel className="grid min-w-0 gap-1 text-xs text-muted sm:min-w-[8.75rem]">
                Sort by
                <AppNativeSelect
                  className="field-sm"
                  value={sortIncome}
                  onChange={(event) => setSortIncome(event.target.value)}
                >
                  <option value="usage">Usage</option>
                  <option value="name">Name</option>
                </AppNativeSelect>
              </AppFieldLabel>
            </SectionHeading>
            <div className="divide-y divide-border">
              {incomeCategories.length ? (
                incomeCategories.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-faint/60"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <CategoryIcon icon={row.icon} label={row.name} />
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-text">{row.name}</p>
                        <p className="text-xs text-muted">{row.usage_count} uses this period</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <AppButton
                        type="button"
                        onClick={() => startEdit(row)}
                        tone="ghost"
                        className="h-9 w-9 p-0"
                        aria-label={`Edit ${row.name}`}
                      >
                        <PencilSimpleIcon className="h-4 w-4" aria-hidden="true" />
                      </AppButton>
                      <AppButton
                        type="button"
                        onClick={() => archiveMutation.mutate(row.id)}
                        tone="ghost"
                        className="h-9 w-9 p-0"
                        aria-label={`Archive ${row.name}`}
                      >
                        <ArchiveIcon className="h-4 w-4" aria-hidden="true" />
                      </AppButton>
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-4 py-6 text-sm text-muted">No income categories yet.</div>
              )}
            </div>
          </FinancialPanel>

          <FinancialPanel role="ledger">
            <SectionHeading className="items-stretch max-sm:flex-col sm:items-end">
              <div>
                <h2 className="font-head text-lg font-bold">Expense categories</h2>
                <p className="mt-0.5 text-xs text-muted">
                  {expenseCategories.length} active
                </p>
              </div>
              <AppFieldLabel className="grid min-w-0 gap-1 text-xs text-muted sm:min-w-[8.75rem]">
                Sort by
                <AppNativeSelect
                  className="field-sm"
                  value={sortExpense}
                  onChange={(event) => setSortExpense(event.target.value)}
                >
                  <option value="usage">Usage</option>
                  <option value="name">Name</option>
                </AppNativeSelect>
              </AppFieldLabel>
            </SectionHeading>
            <div className="divide-y divide-border">
              {expenseCategories.length ? (
                expenseCategories.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-faint/60"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <CategoryIcon icon={row.icon} label={row.name} />
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-text">{row.name}</p>
                        <p className="text-xs text-muted">{row.usage_count} uses this period</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <AppButton
                        type="button"
                        onClick={() => startEdit(row)}
                        tone="ghost"
                        className="h-9 w-9 p-0"
                        aria-label={`Edit ${row.name}`}
                      >
                        <PencilSimpleIcon className="h-4 w-4" aria-hidden="true" />
                      </AppButton>
                      <AppButton
                        type="button"
                        onClick={() => archiveMutation.mutate(row.id)}
                        tone="ghost"
                        className="h-9 w-9 p-0"
                        aria-label={`Archive ${row.name}`}
                      >
                        <ArchiveIcon className="h-4 w-4" aria-hidden="true" />
                      </AppButton>
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-4 py-6 text-sm text-muted">No expense categories yet.</div>
              )}
            </div>
          </FinancialPanel>
        </div>

        <div className="space-y-6">
          <FinancialPanel role="ledger">
            <SectionHeading>
              <div>
                <h2 className="font-head text-lg font-bold">Archived categories</h2>
                <p className="mt-0.5 text-xs text-muted">
                  Restore identities when they become useful again
                </p>
              </div>
              <span className="rounded-full bg-faint px-2.5 py-1 text-xs text-muted">
                {archivedCategories.length}
              </span>
            </SectionHeading>
            <div className="divide-y divide-border">
              {archivedCategories.length ? (
                archivedCategories.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-faint/60"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <CategoryIcon icon={row.icon} label={row.name} />
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-text">{row.name}</p>
                        <p className="text-xs text-muted">
                          {row.type} · Archived {formatEuroDate(row.archived_at ?? "")}
                        </p>
                      </div>
                    </div>
                    <AppButton
                      type="button"
                      onClick={() => restoreMutation.mutate(row.id)}
                      tone="ghost"
                      className="px-3 py-1 text-xs"
                    >
                      Restore
                    </AppButton>
                  </div>
                ))
              ) : (
                <div className="px-4 py-6 text-sm text-muted">No archived categories.</div>
              )}
            </div>
          </FinancialPanel>

          <FinancialPanel role="inspector" className="p-4">
            <p className="mono-meta text-muted">Library maintenance</p>
            <h2 className="mt-1 font-head text-lg font-bold">Merge categories</h2>
            <p className="mt-1 text-xs text-muted">
              Move all references to target and archive source.
            </p>
            <div className="mt-4 grid gap-3">
              <AppFieldLabel>
                Source
                <AppNativeSelect
                  value={mergeSourceId}
                  onChange={(event) => {
                    setMergeSourceId(event.target.value)
                    setMergeTargetId("")
                    setMergePreview(null)
                    setMergeConfirmOpen(false)
                    setMergeOutcomeMessage(null)
                    mergePreviewMutation.reset()
                    mergeApplyMutation.reset()
                  }}
                >
                  <option value="">Choose source category</option>
                  {mergeCandidates.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name} ({category.type})
                    </option>
                  ))}
                </AppNativeSelect>
              </AppFieldLabel>
              <AppFieldLabel>
                Target
                <AppNativeSelect
                  value={mergeTargetId}
                  onChange={(event) => {
                    setMergeTargetId(event.target.value)
                    setMergePreview(null)
                    setMergeConfirmOpen(false)
                    setMergeOutcomeMessage(null)
                    mergePreviewMutation.reset()
                    mergeApplyMutation.reset()
                  }}
                  disabled={!mergeSource}
                >
                  <option value="">Choose target category</option>
                  {mergeTargets.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name} ({category.type})
                    </option>
                  ))}
                </AppNativeSelect>
              </AppFieldLabel>
            </div>
            <div className="mt-3 flex gap-2">
              <AppButton
                type="button"
                onClick={runMergePreview}
                disabled={mergePreviewMutation.isPending || !mergeSourceId || !mergeTargetId}
                className="flex-1"
                tone="ghost"
              >
                {mergePreviewMutation.isPending ? "Previewing…" : "Preview"}
              </AppButton>
              <AppButton
                type="button"
                onClick={openMergeConfirmation}
                disabled={
                  mergeApplyMutation.isPending ||
                  mergeConfirmOpen ||
                  !mergeSourceId ||
                  !mergeTargetId
                }
                className="flex-1"
              >
                {mergeApplyMutation.isPending
                  ? "Merging…"
                  : mergeConfirmOpen
                    ? "Awaiting confirmation…"
                    : "Merge"}
              </AppButton>
            </div>
            {mergeConfirmOpen && (
              <div className="mt-3 rounded-lg bg-signal-blue-soft p-3 text-xs">
                <p className="font-semibold text-text">Confirm category merge</p>
                <p className="mt-1 text-muted">
                  Merge <span className="font-semibold text-text">{mergeSource?.name}</span>{" "}
                  into <span className="font-semibold text-text">{mergeTarget?.name}</span>? The
                  source category will be archived after merge.
                </p>
                <div className="mt-3 flex gap-2">
                  <AppButton
                    type="button"
                    tone="ghost"
                    className="flex-1"
                    onClick={() => setMergeConfirmOpen(false)}
                    disabled={mergeApplyMutation.isPending}
                  >
                    Cancel
                  </AppButton>
                  <AppButton
                    type="button"
                    className="flex-1"
                    onClick={runMergeApply}
                    disabled={mergeApplyMutation.isPending}
                  >
                    {mergeApplyMutation.isPending ? "Merging…" : "Confirm merge"}
                  </AppButton>
                </div>
              </div>
            )}
            {mergeError && (
              <div className="mt-3 rounded-lg border border-semantic-red/40 bg-semantic-red/10 p-3 text-xs text-semantic-red">
                <p className="font-semibold">
                  {showsGuardedBudgetError ? "Guarded budget conflict" : "Merge failed"}
                </p>
                <p className="mt-1">{mergeError}</p>
              </div>
            )}
            {mergeOutcomeMessage && (
              <p className="mt-3 rounded-lg bg-signal-green-soft p-3 text-xs text-semantic-green">
                {mergeOutcomeMessage}
              </p>
            )}
            {mergePreview && (
              <div className="mt-3 rounded-lg bg-faint p-3 text-xs text-muted">
                <p>Transactions: {mergePreview.transactions ?? 0}</p>
                <p>Recurring rules: {mergePreview.recurring_rules ?? 0}</p>
                <p>Rule category actions: {mergePreview.rules_set_category ?? 0}</p>
                <p>Budget templates: {mergePreview.budget_templates ?? 0}</p>
                <p>Budget overrides: {mergePreview.budget_overrides ?? 0}</p>
              </div>
            )}
          </FinancialPanel>
        </div>
      </div>

      <Dialog
        open={editorOpen}
        onOpenChange={(open) => {
          if (!open && !createMutation.isPending && !updateMutation.isPending) {
            closeEditor()
          }
        }}
      >
        <DialogContent
          aria-label={isEditing ? "Edit category" : "Add category"}
          className="max-h-[calc(100dvh-2rem)] overflow-hidden p-5"
        >
          <div className="-mr-5 overflow-y-auto pr-5">
            <DialogHeader>
              <DialogTitle>{isEditing ? "Edit category" : "Add category"}</DialogTitle>
              <DialogClose asChild>
                <AppButton
                  tone="ghost"
                  className="h-9 w-9 rounded-full p-0"
                  aria-label="Close category editor"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  <XIcon className="h-4 w-4" aria-hidden="true" />
                </AppButton>
              </DialogClose>
            </DialogHeader>

            <form
              onSubmit={isEditing ? handleEditSubmit : handleCreate}
              className="space-y-4"
            >
              <AppFieldLabel>
                Name
                <AppInput
                  value={isEditing ? editName : name}
                  onChange={(event) =>
                    isEditing ? setEditName(event.target.value) : setName(event.target.value)
                  }
                  placeholder="e.g. Groceries"
                  autoFocus
                  required
                />
              </AppFieldLabel>
              {isEditing ? (
                <div className="form-label">
                  Type
                  <p className="rounded-lg border border-border bg-surface-hi/60 px-3 py-2 text-sm font-semibold capitalize text-text">
                    {editType}
                  </p>
                </div>
              ) : (
                <AppFieldLabel>
                  Type
                  <AppNativeSelect
                    value={type}
                    onChange={(event) => setType(event.target.value)}
                    className="mt-1"
                  >
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                  </AppNativeSelect>
                </AppFieldLabel>
              )}
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-muted">Icon</p>
                <Suspense fallback={iconPickerFallback}>
                  <IconPicker
                    value={isEditing ? editIcon : icon}
                    onChange={isEditing ? setEditIcon : setIcon}
                  />
                </Suspense>
              </div>
              <AppFieldLabel>
                Order (optional)
                <AppInput
                  value={isEditing ? editOrder : order}
                  onChange={(event) =>
                    isEditing ? setEditOrder(event.target.value) : setOrder(event.target.value)
                  }
                  type="number"
                />
              </AppFieldLabel>
              {(isEditing ? updateMutation.error : createMutation.error) ? (
                <p className="text-xs text-semantic-red">
                  {String(isEditing ? updateMutation.error : createMutation.error)}
                </p>
              ) : null}
              <div className="flex gap-2 border-t border-border pt-4">
                <AppButton
                  type="submit"
                  className="flex-1"
                  disabled={isEditing ? updateMutation.isPending : createMutation.isPending}
                >
                  {isEditing
                    ? updateMutation.isPending
                      ? "Saving…"
                      : "Save changes"
                    : createMutation.isPending
                      ? "Creating…"
                      : "Add category"}
                </AppButton>
                <AppButton
                  type="button"
                  onClick={closeEditor}
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
      {savedFlash && (
        <div className="fixed inset-x-0 bottom-6 z-[80] flex justify-center pointer-events-none">
          <div className="toast-flash pointer-events-auto rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-semantic-green shadow-[var(--shadow-raised)]">
            Changes saved
          </div>
        </div>
      )}
    </section>
  )
}

export default CategoriesPage
