import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { XIcon } from "@phosphor-icons/react/X"
import { useSearchParams } from "react-router-dom"
import { apiFetch } from "../app/api"
import type { CategoryListItem } from "../app/api-types"
import { formatEuroDate } from "../app/format"
import { CategoryIcon } from "../components/CategoryIcon"
import PageIntro from "../components/PageIntro"
import PeriodPicker from "../components/PeriodPicker"
import { DEFAULT_CATEGORY_ICON_KEY } from "../components/categoryIconsCatalog"
import { AppButton } from "../components/ui/product-button"
import { AppCard } from "../components/ui/product-card"
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
  const formRef = useRef<HTMLFormElement | null>(null)
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
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
  const [mobileEditOpen, setMobileEditOpen] = useState(false)
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

  const resetEditState = () => {
    setEditingCategoryId(null)
    setEditName("")
    setEditIcon(DEFAULT_CATEGORY_ICON_KEY)
    setEditOrder("0")
    setEditType("expense")
  }

  const normalizeIconKey = (iconKey: string) =>
    iconKey.length > 0 ? iconKey : DEFAULT_CATEGORY_ICON_KEY

  const createMutation = useMutation({
    mutationFn: (payload: { name: string; type: string; icon: string; order: number }) =>
      apiFetch<CategoryListItem>("/api/categories", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
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
        setMobileEditOpen(false)
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

  const jumpToForm = () => {
    resetEditState()
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      nameInputRef.current?.focus()
    })
  }

  const startEdit = (row: CategoryListItem, useMobileModal: boolean) => {
    updateMutation.reset()
    setEditingCategoryId(row.id)
    setEditName(row.name)
    setEditIcon(row.icon ?? DEFAULT_CATEGORY_ICON_KEY)
    setEditOrder(String(row.order))
    setEditType(row.type)
    setMobileEditOpen(useMobileModal)
  }

  const closeMobileEdit = () => {
    if (updateMutation.isPending) {
      return
    }
    setMobileEditOpen(false)
    resetEditState()
  }

  const submitEdit = (closeMobileModal: boolean) => {
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
          if (closeMobileModal) {
            setMobileEditOpen(false)
          }
          resetEditState()
          setSavedFlash(true)
        },
      }
    )
  }

  const handleDesktopEditSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    submitEdit(false)
  }

  const handleMobileEditSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    submitEdit(true)
  }

  if (isLoading) {
    return <div className="text-muted">Loading categories…</div>
  }
  if (error || !data) {
    return <div className="text-semantic-red">Unable to load categories.</div>
  }

  const activeCategories = data.categories.filter((row) => !row.archived_at)
  const archivedCategories = data.categories.filter((row) => row.archived_at)
  const isDesktopEditing = editingCategoryId !== null && !mobileEditOpen
  const iconPickerFallback = (
    <div className="rounded-lg border border-border bg-surface-hi/65 px-3 py-2 text-xs text-muted">
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
      <PageIntro
        title="Categories"
        actions={
          <AppButton
            type="button"
            onClick={jumpToForm}
            className="desk:hidden"
          >
            Add category
          </AppButton>
        }
      />

      <PeriodPicker
        periodSlug={data.period.slug}
        start={data.period.start}
        end={data.period.end}
        onSetPreset={setPresetPeriod}
        onApplyCustom={applyCustomPeriod}
      />

      <div className="grid gap-6 desk:grid-cols-[1.2fr_0.8fr]">
        <div className="grid gap-6 lg:grid-cols-2">
          <AppCard>
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="font-head text-lg font-bold">Income categories</h2>
              <AppFieldLabel className="grid min-w-[8.75rem] gap-1 text-xs text-muted">
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
            </div>
            <div className="divide-y divide-border">
              {incomeCategories.length ? (
                incomeCategories.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="flex items-center gap-2.5">
                      <CategoryIcon icon={row.icon} />
                      <div>
                        <p className="font-semibold text-text">{row.name}</p>
                        <p className="text-xs text-muted">{row.usage_count} uses this period</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <AppButton
                        type="button"
                        onClick={() => startEdit(row, false)}
                        tone="ghost"
                        className="hidden px-3 py-1 text-xs desk:inline-flex"
                      >
                        Edit
                      </AppButton>
                      <AppButton
                        type="button"
                        onClick={() => startEdit(row, true)}
                        tone="ghost"
                        className="px-3 py-1 text-xs desk:hidden"
                      >
                        Edit
                      </AppButton>
                      <AppButton
                        type="button"
                        onClick={() => archiveMutation.mutate(row.id)}
                        tone="ghost"
                        className="px-3 py-1 text-xs"
                      >
                        Archive
                      </AppButton>
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-4 py-6 text-sm text-muted">No income categories yet.</div>
              )}
            </div>
          </AppCard>

          <AppCard>
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="font-head text-lg font-bold">Expense categories</h2>
              <AppFieldLabel className="grid min-w-[8.75rem] gap-1 text-xs text-muted">
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
            </div>
            <div className="divide-y divide-border">
              {expenseCategories.length ? (
                expenseCategories.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="flex items-center gap-2.5">
                      <CategoryIcon icon={row.icon} />
                      <div>
                        <p className="font-semibold text-text">{row.name}</p>
                        <p className="text-xs text-muted">{row.usage_count} uses this period</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <AppButton
                        type="button"
                        onClick={() => startEdit(row, false)}
                        tone="ghost"
                        className="hidden px-3 py-1 text-xs desk:inline-flex"
                      >
                        Edit
                      </AppButton>
                      <AppButton
                        type="button"
                        onClick={() => startEdit(row, true)}
                        tone="ghost"
                        className="px-3 py-1 text-xs desk:hidden"
                      >
                        Edit
                      </AppButton>
                      <AppButton
                        type="button"
                        onClick={() => archiveMutation.mutate(row.id)}
                        tone="ghost"
                        className="px-3 py-1 text-xs"
                      >
                        Archive
                      </AppButton>
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-4 py-6 text-sm text-muted">No expense categories yet.</div>
              )}
            </div>
          </AppCard>
        </div>

        <div className="space-y-6">
          <AppCard>
            <form
              ref={formRef}
              onSubmit={isDesktopEditing ? handleDesktopEditSubmit : handleCreate}
              className="editor-rail p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-head text-lg font-bold">
                  {isDesktopEditing ? "Edit category" : "Add a category"}
                </h2>
                {isDesktopEditing && (
                  <AppButton
                    type="button"
                    onClick={() => {
                      updateMutation.reset()
                      resetEditState()
                    }}
                    tone="ghost"
                    className="px-3 py-1 text-xs"
                  >
                    Cancel
                  </AppButton>
                )}
              </div>
              <div className="mt-4 space-y-3">
                <AppFieldLabel>
                  Name
                  <AppInput
                    ref={nameInputRef}
                    value={isDesktopEditing ? editName : name}
                    onChange={(event) => {
                      if (isDesktopEditing) {
                        setEditName(event.target.value)
                        return
                      }
                      setName(event.target.value)
                    }}
                    className="mt-1"
                    placeholder="e.g. Groceries"
                    required
                  />
                </AppFieldLabel>
              {isDesktopEditing ? (
                <div className="form-label">
                  Type
                  <p className="mt-1 rounded-lg border border-border bg-surface-hi/60 px-3 py-2 text-sm font-semibold text-text">
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
                    value={isDesktopEditing ? editIcon : icon}
                    onChange={(nextIcon) => {
                      if (isDesktopEditing) {
                        setEditIcon(nextIcon)
                        return
                      }
                      setIcon(nextIcon)
                    }}
                  />
                </Suspense>
              </div>
              <AppFieldLabel>
                Order (optional)
                <AppInput
                  value={isDesktopEditing ? editOrder : order}
                  onChange={(event) => {
                    if (isDesktopEditing) {
                      setEditOrder(event.target.value)
                      return
                    }
                    setOrder(event.target.value)
                  }}
                  type="number"
                  className="mt-1"
                />
              </AppFieldLabel>
              {isDesktopEditing && updateMutation.error && (
                <p className="text-xs text-semantic-red">{String(updateMutation.error)}</p>
              )}
              {!isDesktopEditing && createMutation.error && (
                <p className="text-xs text-semantic-red">{String(createMutation.error)}</p>
              )}
              <AppButton
                type="submit"
                className="w-full"
                disabled={
                  isDesktopEditing ? updateMutation.isPending : createMutation.isPending
                }
              >
                {isDesktopEditing
                  ? updateMutation.isPending
                    ? "Saving…"
                    : "Save changes"
                  : createMutation.isPending
                    ? "Creating…"
                    : "Create category"}
              </AppButton>
              </div>
            </form>
          </AppCard>

          <AppCard>
            <div className="border-b border-border px-4 py-3">
              <h2 className="font-head text-lg font-bold">Archived categories</h2>
            </div>
            <div className="divide-y divide-border">
              {archivedCategories.length ? (
                archivedCategories.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between px-4 py-3"
                  >
                    <div>
                      <p className="font-semibold text-text">{row.name}</p>
                      <p className="text-xs text-muted">
                        {row.type} · Archived {formatEuroDate(row.archived_at ?? "")}
                      </p>
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
          </AppCard>

          <AppCard className="p-4">
            <h2 className="font-head text-lg font-bold">Merge categories</h2>
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
              <div className="mt-3 rounded-lg border border-accent/40 bg-accent/10 p-3 text-xs">
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
              <p className="mt-3 rounded-lg border border-semantic-green/40 bg-semantic-green/10 p-3 text-xs text-semantic-green">
                {mergeOutcomeMessage}
              </p>
            )}
            {mergePreview && (
              <div className="mt-3 rounded-lg border border-border bg-surface-hi/60 p-3 text-xs text-muted">
                <p>Transactions: {mergePreview.transactions ?? 0}</p>
                <p>Recurring rules: {mergePreview.recurring_rules ?? 0}</p>
                <p>Rule category actions: {mergePreview.rules_set_category ?? 0}</p>
                <p>Budget templates: {mergePreview.budget_templates ?? 0}</p>
                <p>Budget overrides: {mergePreview.budget_overrides ?? 0}</p>
              </div>
            )}
          </AppCard>
        </div>
      </div>

      <div
        className={`fixed inset-0 z-[70] desk:hidden ${
          mobileEditOpen ? "pointer-events-auto" : "pointer-events-none"
        }`}
        aria-hidden={!mobileEditOpen}
      >
        <button
          type="button"
          onClick={closeMobileEdit}
          className={`drawer-overlay ${mobileEditOpen ? "opacity-100" : "opacity-0"}`}
          aria-label="Close edit category dialog"
        />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Edit category"
            className={`drawer-panel drawer-motion ${
              mobileEditOpen
                ? "pointer-events-auto scale-100 opacity-100"
                : "pointer-events-none scale-95 opacity-0"
            }`}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-head text-xl font-bold tracking-tight">Edit category</h2>
              </div>
              <button
                type="button"
                onClick={closeMobileEdit}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted transition hover:text-text"
                aria-label="Close edit category dialog"
                disabled={updateMutation.isPending}
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>

            <form
              onSubmit={handleMobileEditSubmit}
              className="grid min-h-0 flex-1 gap-4 overflow-y-auto pr-1"
            >
              <AppFieldLabel>
                Name
                <AppInput
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  required
                />
              </AppFieldLabel>
              <div className="form-label">
                Type
                <p className="rounded-lg border border-border bg-surface-hi/60 px-3 py-2 text-sm font-semibold text-text">
                  {editType}
                </p>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-muted">Icon</p>
                <Suspense fallback={iconPickerFallback}>
                  <IconPicker value={editIcon} onChange={setEditIcon} />
                </Suspense>
              </div>
              <AppFieldLabel>
                Order (optional)
                <AppInput
                  value={editOrder}
                  onChange={(event) => setEditOrder(event.target.value)}
                  type="number"
                />
              </AppFieldLabel>
              {updateMutation.error && (
                <p className="text-xs text-semantic-red">{String(updateMutation.error)}</p>
              )}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <AppButton
                  type="button"
                  onClick={closeMobileEdit}
                  tone="ghost"
                  disabled={updateMutation.isPending}
                >
                  Cancel
                </AppButton>
                <AppButton
                  type="submit"
                  disabled={updateMutation.isPending}
                >
                  {updateMutation.isPending ? "Saving…" : "Save changes"}
                </AppButton>
              </div>
            </form>
          </div>
        </div>
      </div>
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
