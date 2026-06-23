import { useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useSearchParams } from "react-router-dom"
import { apiFetch } from "../app/api"
import PageIntro from "../components/PageIntro"
import PeriodPicker from "../components/PeriodPicker"
import { Toggle } from "../components/Toggle"
import { AppButton } from "../components/ui/product-button"
import { AppCard, AppCardLink } from "../components/ui/product-card"
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
  const formRef = useRef<HTMLFormElement | null>(null)
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const [name, setName] = useState("")
  const [hidden, setHidden] = useState(false)
  const [mergeSourceId, setMergeSourceId] = useState("")
  const [mergeTargetId, setMergeTargetId] = useState("")
  const [mergePreview, setMergePreview] = useState<Record<string, number> | null>(null)

  const queryString = useMemo(() => {
    const params = new URLSearchParams(searchParams)
    if (!params.get("period")) {
      params.set("period", "all")
    }
    return params.toString()
  }, [searchParams])

  const { data, isLoading, error } = useQuery({
    queryKey: ["tags", queryString],
    queryFn: () => apiFetch<TagsResponse>(`/api/tags?${queryString}`),
  })

  const createMutation = useMutation({
    mutationFn: (payload: { name: string; is_hidden_from_budget: boolean }) =>
      apiFetch<TagRow>("/api/tags", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      setName("")
      setHidden(false)
      queryClient.invalidateQueries({ queryKey: ["tags"] })
    },
  })

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
      setMergePreview(null)
      setMergeSourceId("")
      setMergeTargetId("")
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

  const jumpToForm = () => {
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      nameInputRef.current?.focus()
    })
  }

  if (isLoading) {
    return <div className="text-muted">Loading tags…</div>
  }
  if (error || !data) {
    return <div className="text-semantic-red">Unable to load tags.</div>
  }

  const mergeSource = data.tags.find((tag) => String(tag.id) === mergeSourceId)
  const mergeTargets = mergeSource
    ? data.tags.filter((tag) => tag.id !== mergeSource.id)
    : []

  return (
    <section className="space-y-6">
      <PageIntro
        title="Tags"
        actions={
          <AppButton
            type="button"
            onClick={jumpToForm}
            className="desk:hidden"
          >
            Create tag
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

      <div className="grid gap-6 lg:grid-cols-[1.4fr_0.8fr]">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.tags.length ? (
            data.tags.map((tag) => (
              <AppCardLink
                key={tag.id}
                to={`/tags/${tag.id}`}
                className="p-4 transition hover:border-border-hi"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-text">{tag.name}</p>
                    <p className="text-xs text-muted">
                      {tag.usage_count} uses in period
                    </p>
                  </div>
                  {tag.is_hidden_from_budget && (
                    <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] text-accent">
                      Hidden
                    </span>
                  )}
                </div>
              </AppCardLink>
            ))
          ) : (
            <AppCard className="p-6 text-sm text-muted">
              No tags yet. Create one to organize transactions.
            </AppCard>
          )}
        </div>

        <div className="space-y-6">
          <AppCard>
            <form ref={formRef} onSubmit={handleCreate}>
              <div className="surface-section-header">
                <h2 className="font-head text-lg font-bold">Create tag</h2>
                <p className="text-xs text-muted">
                  Add a new context for tracking spend.
                </p>
              </div>
              <div className="surface-section-body space-y-3">
                <AppFieldLabel>
                  Name
                  <AppInput
                    ref={nameInputRef}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="mt-1"
                    placeholder="e.g. Vacation 2024"
                    required
                  />
                </AppFieldLabel>
                <label className="flex items-center gap-3 rounded-md border border-border bg-bg p-3 text-xs text-muted">
                  <Toggle on={hidden} onChange={setHidden} />
                  <span>Exclude from budgets</span>
                </label>
                {createMutation.error && (
                  <p className="text-xs text-semantic-red">
                    {String(createMutation.error)}
                  </p>
                )}
                <AppButton
                  type="submit"
                  className="w-full"
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending ? "Creating…" : "Create tag"}
                </AppButton>
              </div>
            </form>
          </AppCard>

          <AppCard>
            <div className="surface-section-header">
              <h2 className="text-xl font-head font-bold">Merge tags</h2>
              <p className="mt-1 text-sm text-muted">
                Move links and rule references to target, then archive source.
              </p>
            </div>

            <div className="surface-section-body space-y-3">
              <AppFieldLabel>
                Source
                <AppNativeSelect
                  className="mt-1"
                  value={mergeSourceId}
                  onChange={(event) => {
                    setMergeSourceId(event.target.value)
                    setMergeTargetId("")
                    setMergePreview(null)
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
                    setMergePreview(null)
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
                  onClick={() => {
                    if (!confirm("Merge source tag into target?")) {
                      return
                    }
                    mergeApplyMutation.mutate({
                      source_tag_id: Number(mergeSourceId),
                      target_tag_id: Number(mergeTargetId),
                    })
                  }}
                  disabled={mergeApplyMutation.isPending || !mergeSourceId || !mergeTargetId}
                  className="flex-1"
                >
                  {mergeApplyMutation.isPending ? "Merging…" : "Merge"}
                </AppButton>
              </div>
              {(mergePreviewMutation.error || mergeApplyMutation.error) && (
                <p className="text-xs text-semantic-red">
                  {String(mergePreviewMutation.error || mergeApplyMutation.error)}
                </p>
              )}
              {mergePreview && (
                <div className="rounded-md border border-border bg-bg p-3 text-xs text-muted">
                  <p>Transaction links: {mergePreview.transaction_links ?? 0}</p>
                  <p>Budget exclude rules: {mergePreview.budget_exclude_rules ?? 0}</p>
                  <p>Add-tags rules scanned: {mergePreview.add_tags_rules_scanned ?? 0}</p>
                </div>
              )}
            </div>
          </AppCard>
        </div>
      </div>
    </section>
  )
}

export default TagsPage
