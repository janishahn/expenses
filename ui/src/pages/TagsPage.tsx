import { useCallback, useEffect, useMemo, useState } from "react"
import { TagIcon } from "@phosphor-icons/react/Tag"
import { XIcon } from "@phosphor-icons/react/X"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useOutletContext, useSearchParams } from "react-router-dom"
import { apiFetch } from "../app/api"
import type { AppShellOutletContext } from "../app/AppShell"
import PageIntro from "../components/PageIntro"
import PeriodPicker from "../components/PeriodPicker"
import { Toggle } from "../components/Toggle"
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

type TagRow = {
  id: number
  name: string
  color: string | null
  is_hidden_from_budget: boolean
  usage_count: number
}

type TagsResponse = {
  period: { slug: string; start: string; end: string }
  tags: TagRow[]
}

function TagsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const { setUtilityAction } = useOutletContext<AppShellOutletContext>()
  const [createOpen, setCreateOpen] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [name, setName] = useState("")
  const [hidden, setHidden] = useState(false)
  const [mergeSourceId, setMergeSourceId] = useState("")
  const [mergeTargetId, setMergeTargetId] = useState("")
  const [mergePreview, setMergePreview] = useState<Record<string, number> | null>(null)
  const [mergeConfirmOpen, setMergeConfirmOpen] = useState(false)

  const queryString = useMemo(() => {
    const params = new URLSearchParams(searchParams)
    if (!params.get("period")) params.set("period", "all")
    return params.toString()
  }, [searchParams])

  const { data, isLoading, error } = useQuery({
    queryKey: ["tags", queryString],
    queryFn: () => apiFetch<TagsResponse>(`/api/tags?${queryString}`),
  })

  const openMergeEditor = () => {
    setMergeSourceId("")
    setMergeTargetId("")
    setMergePreview(null)
    setMergeConfirmOpen(false)
    setMergeOpen(true)
  }

  const createMutation = useMutation({
    mutationFn: (payload: { name: string; is_hidden_from_budget: boolean }) =>
      apiFetch<TagRow>("/api/tags", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      setCreateOpen(false)
      setName("")
      setHidden(false)
      queryClient.invalidateQueries({ queryKey: ["tags"] })
    },
  })
  const resetCreateMutation = createMutation.reset
  const openCreateEditor = useCallback(() => {
    resetCreateMutation()
    setName("")
    setHidden(false)
    setCreateOpen(true)
  }, [resetCreateMutation])

  useEffect(() => {
    setUtilityAction({ label: "Add tag", onClick: openCreateEditor })
    return () => setUtilityAction(null)
  }, [openCreateEditor, setUtilityAction])

  const mergePreviewMutation = useMutation({
    mutationFn: (payload: { source_tag_id: number; target_tag_id: number }) =>
      apiFetch<{ counts: Record<string, number> }>("/api/tags/merge/preview", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (result) => setMergePreview(result.counts),
  })

  const mergeApplyMutation = useMutation({
    mutationFn: (payload: { source_tag_id: number; target_tag_id: number }) =>
      apiFetch<{ counts: Record<string, number> }>("/api/tags/merge", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      setMergeOpen(false)
      setMergePreview(null)
      setMergeSourceId("")
      setMergeTargetId("")
      setMergeConfirmOpen(false)
      queryClient.invalidateQueries({ queryKey: ["tags"] })
      queryClient.invalidateQueries({ queryKey: ["transactions"] })
      queryClient.invalidateQueries({ queryKey: ["rules"] })
      queryClient.invalidateQueries({ queryKey: ["insights"] })
    },
  })

  const setPresetPeriod = (value: PresetPeriod) =>
    setSearchParams(buildPresetPeriodSearchParams(searchParams, value))

  const applyCustomPeriod = (start: string, end: string) =>
    setSearchParams(buildCustomPeriodSearchParams(searchParams, start, end))

  const handleCreate = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    createMutation.mutate({
      name: name.trim(),
      is_hidden_from_budget: hidden,
    })
  }

  if (isLoading) return <div className="text-muted">Loading tags…</div>
  if (error || !data) return <div className="text-semantic-red">Unable to load tags.</div>

  const mergeSource = data.tags.find((tag) => String(tag.id) === mergeSourceId)
  const mergeTarget = data.tags.find((tag) => String(tag.id) === mergeTargetId)
  const mergeTargets = mergeSource
    ? data.tags.filter((tag) => tag.id !== mergeSource.id)
    : []

  const resetMergeSelection = () => {
    setMergePreview(null)
    setMergeConfirmOpen(false)
    mergePreviewMutation.reset()
    mergeApplyMutation.reset()
  }

  return (
    <section className="space-y-6">
      <PageIntro
        title="Tags"
        actions={
          <div className="flex flex-wrap gap-2">
            <AppButton type="button" onClick={openMergeEditor} tone="ghost">
              Merge tags
            </AppButton>
          </div>
        }
      />

      <PeriodPicker
        periodSlug={data.period.slug}
        start={data.period.start}
        end={data.period.end}
        onSetPreset={setPresetPeriod}
        onApplyCustom={applyCustomPeriod}
      />

      <FinancialPanel role="ledger" data-testid="tag-library">
        <SectionHeading>
          <div>
            <h2 className="font-head text-lg font-bold">Context library</h2>
            <p className="mt-0.5 text-xs text-muted">
              Cross-cutting labels for activity and budget treatment
            </p>
          </div>
          <span className="rounded-full bg-faint px-2.5 py-1 text-xs text-muted">
            {data.tags.length}
          </span>
        </SectionHeading>
        {data.tags.length ? (
          <div className="grid gap-2.5 p-3.5 sm:grid-cols-2 xl:grid-cols-3">
            {data.tags.map((tag) => (
              <Link
                key={tag.id}
                to={`/tags/${tag.id}`}
                className="group flex min-h-[5.75rem] items-start justify-between gap-3 rounded-lg bg-faint/80 p-3.5 text-inherit transition hover:bg-surface-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className="category-icon-tile"
                    data-signal-tone={tag.is_hidden_from_budget ? "yellow" : "purple"}
                  >
                    <TagIcon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-text group-hover:text-accent">
                      {tag.name}
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-muted">
                      {tag.usage_count} uses in period
                    </p>
                  </div>
                </div>
                {tag.is_hidden_from_budget ? (
                  <span className="shrink-0 rounded-full bg-signal-yellow-soft px-2 py-1 text-[10px] font-semibold text-text">
                    Excluded
                  </span>
                ) : null}
              </Link>
            ))}
          </div>
        ) : (
          <div className="p-6 text-sm text-muted">
            No tags yet. Create one to organize transactions.
          </div>
        )}
      </FinancialPanel>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!open && !createMutation.isPending) setCreateOpen(false)
        }}
      >
        <DialogContent aria-label="Add tag" className="p-5">
          <DialogHeader>
            <DialogTitle>Add tag</DialogTitle>
            <DialogClose asChild>
              <AppButton
                tone="ghost"
                className="h-9 w-9 rounded-full p-0"
                aria-label="Close tag editor"
                disabled={createMutation.isPending}
              >
                <XIcon className="h-4 w-4" aria-hidden="true" />
              </AppButton>
            </DialogClose>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <AppFieldLabel>
              Name
              <AppInput
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-1"
                placeholder="e.g. Vacation 2024"
                autoFocus
                required
              />
            </AppFieldLabel>
            <label className="flex items-center gap-3 rounded-md bg-faint p-3 text-xs text-muted">
              <Toggle on={hidden} onChange={setHidden} />
              <span>Exclude from budgets</span>
            </label>
            {createMutation.error ? (
              <p className="text-xs text-semantic-red">{String(createMutation.error)}</p>
            ) : null}
            <div className="flex gap-2 border-t border-border pt-4">
              <AppButton type="submit" className="flex-1" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating…" : "Add tag"}
              </AppButton>
              <AppButton
                type="button"
                onClick={() => setCreateOpen(false)}
                tone="ghost"
                disabled={createMutation.isPending}
              >
                Cancel
              </AppButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={mergeOpen}
        onOpenChange={(open) => {
          if (!open && !mergeApplyMutation.isPending) setMergeOpen(false)
        }}
      >
        <DialogContent aria-label="Merge tags" className="p-5">
          <DialogHeader>
            <div>
              <DialogTitle>Merge tags</DialogTitle>
              <p className="mt-1 text-xs text-muted">
                Move links and rules from one tag to another.
              </p>
            </div>
            <DialogClose asChild>
              <AppButton
                tone="ghost"
                className="h-9 w-9 rounded-full p-0"
                aria-label="Close tag merge"
                disabled={mergeApplyMutation.isPending}
              >
                <XIcon className="h-4 w-4" aria-hidden="true" />
              </AppButton>
            </DialogClose>
          </DialogHeader>
          <div className="space-y-4">
            <AppFieldLabel>
              Source
              <AppNativeSelect
                className="mt-1"
                value={mergeSourceId}
                onChange={(event) => {
                  setMergeSourceId(event.target.value)
                  setMergeTargetId("")
                  resetMergeSelection()
                }}
              >
                <option value="">Choose source tag</option>
                {data.tags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </AppNativeSelect>
            </AppFieldLabel>
            <AppFieldLabel>
              Target
              <AppNativeSelect
                className="mt-1"
                value={mergeTargetId}
                onChange={(event) => {
                  setMergeTargetId(event.target.value)
                  resetMergeSelection()
                }}
                disabled={!mergeSource}
              >
                <option value="">Choose target tag</option>
                {mergeTargets.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </AppNativeSelect>
            </AppFieldLabel>
            <div className="flex gap-2">
              <AppButton
                type="button"
                onClick={() =>
                  mergePreviewMutation.mutate({
                    source_tag_id: Number(mergeSourceId),
                    target_tag_id: Number(mergeTargetId),
                  })
                }
                disabled={
                  mergePreviewMutation.isPending || !mergeSourceId || !mergeTargetId
                }
                className="flex-1"
                tone="ghost"
              >
                {mergePreviewMutation.isPending ? "Previewing…" : "Preview"}
              </AppButton>
              <AppButton
                type="button"
                onClick={() => setMergeConfirmOpen(true)}
                disabled={
                  mergeApplyMutation.isPending ||
                  mergeConfirmOpen ||
                  !mergeSourceId ||
                  !mergeTargetId
                }
                className="flex-1"
              >
                {mergeConfirmOpen ? "Awaiting confirmation…" : "Merge"}
              </AppButton>
            </div>
            {mergeConfirmOpen ? (
              <div className="rounded-lg bg-signal-blue-soft p-3 text-xs">
                <p className="font-semibold text-text">Confirm tag merge</p>
                <p className="mt-1 text-muted">
                  Merge <strong className="text-text">{mergeSource?.name}</strong> into{" "}
                  <strong className="text-text">{mergeTarget?.name}</strong>?
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
                    onClick={() =>
                      mergeApplyMutation.mutate({
                        source_tag_id: Number(mergeSourceId),
                        target_tag_id: Number(mergeTargetId),
                      })
                    }
                    disabled={mergeApplyMutation.isPending}
                  >
                    {mergeApplyMutation.isPending ? "Merging…" : "Confirm merge"}
                  </AppButton>
                </div>
              </div>
            ) : null}
            {mergePreviewMutation.error || mergeApplyMutation.error ? (
              <p className="text-xs text-semantic-red">
                {String(mergePreviewMutation.error || mergeApplyMutation.error)}
              </p>
            ) : null}
            {mergePreview ? (
              <div className="rounded-md bg-faint p-3 text-xs text-muted">
                <p>Transaction links: {mergePreview.transaction_links ?? 0}</p>
                <p>Budget exclude rules: {mergePreview.budget_exclude_rules ?? 0}</p>
                <p>Add-tags rules scanned: {mergePreview.add_tags_rules_scanned ?? 0}</p>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}

export default TagsPage
