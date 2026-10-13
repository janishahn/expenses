import { useMutation, useQueryClient } from "@tanstack/react-query"
import { apiFetch, getApiErrorMessage } from "../app/api"
import { useQueuedSave } from "../app/queued-save"
import { confirmDialog } from "../components/confirm"
import { showToast } from "../components/ui/toast-store"

export type DateRange = { start: string; end: string }

// The fields the Tags list and the tag page both show and edit.
export type TagRecord = {
  id: number
  name: string
  color: string | null
  is_hidden_from_budget: boolean
  is_hidden_from_filters: boolean
  auto_attach_period: DateRange | null
  archived_at: string | null
  created_at: string
}

export type TagField = "name" | "budgets" | "filters" | "auto"

// The body of PUT /api/tags/{id}.
type TagPayload = {
  name: string
  color: string | null
  is_hidden_from_budget: boolean
  is_hidden_from_filters: boolean
  auto_attach_period: DateRange | null
}

function tagPayload(tag: TagRecord): TagPayload {
  return {
    name: tag.name,
    color: tag.color,
    is_hidden_from_budget: tag.is_hidden_from_budget,
    is_hidden_from_filters: tag.is_hidden_from_filters,
    auto_attach_period: tag.auto_attach_period,
  }
}

// Tag changes reach every view that filters or totals by tags.
function invalidateTagViews(queryClient: ReturnType<typeof useQueryClient>) {
  for (const key of ["tags", "tag", "transactions", "dashboard", "insights", "rules"]) {
    void queryClient.invalidateQueries({ queryKey: [key] })
  }
}

export function useTagSave(tag: TagRecord, draftFields?: readonly TagField[]) {
  const queryClient = useQueryClient()
  return useQueuedSave<TagRecord, TagPayload, TagField>({
    url: `/api/tags/${tag.id}`,
    source: tag,
    toPayload: tagPayload,
    onSaved: () => invalidateTagViews(queryClient),
    draftFields,
  })
}

// Archive offers Undo; delete asks first and then leaves the tag's views.
export function useTagLifecycle(tag: TagRecord, onDeleted: () => void) {
  const queryClient = useQueryClient()
  const restore = useMutation({
    mutationFn: () => apiFetch(`/api/tags/${tag.id}/restore`, { method: "POST" }),
    onSuccess: () => invalidateTagViews(queryClient),
    onError: (failure) => showToast({ message: getApiErrorMessage(failure, "Unable to restore the tag.") }),
  })
  const archive = useMutation({
    mutationFn: () => apiFetch(`/api/tags/${tag.id}/archive`, { method: "POST" }),
    onSuccess: () => {
      invalidateTagViews(queryClient)
      showToast({ message: `Archived ${tag.name}.`, action: { label: "Undo", onClick: () => restore.mutate() } })
    },
    onError: (failure) => showToast({ message: getApiErrorMessage(failure, "Unable to archive the tag.") }),
  })
  const remove = useMutation({
    mutationFn: () => apiFetch(`/api/tags/${tag.id}`, { method: "DELETE" }),
    onSuccess: () => {
      onDeleted()
      queryClient.removeQueries({ queryKey: ["tag", tag.id] })
      invalidateTagViews(queryClient)
    },
    onError: (failure) => showToast({ message: getApiErrorMessage(failure, "Unable to delete the tag.") }),
  })
  const confirmDelete = async () => {
    const confirmed = await confirmDialog({
      title: `Delete tag "${tag.name}"?`,
      description: "It is removed from all transactions.",
      confirmLabel: "Delete",
      tone: "danger",
    })
    if (confirmed) remove.mutate()
  }
  return { archive: () => archive.mutate(), restore: () => restore.mutate(), confirmDelete }
}

export function autoAddStatus(period: DateRange, now: Date): "upcoming" | "active" | "ended" {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
  return today < period.start ? "upcoming" : today > period.end ? "ended" : "active"
}
