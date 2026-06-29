import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle"
import { XCircleIcon } from "@phosphor-icons/react/XCircle"
import { useSearchParams } from "react-router-dom"
import { apiFetch } from "../app/api"
import { useAuth } from "../app/auth"
import { formatCurrency, formatEuroDate } from "../app/format"
import { CategoryIcon } from "../components/CategoryIcon"
import PageIntro from "../components/PageIntro"
import PeriodPicker from "../components/PeriodPicker"
import TransactionDescription from "../components/TransactionDescription"
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
  buildSearchParams,
  type PresetPeriod,
} from "../lib/searchParams"

type TransactionRow = {
  id: number
  date: string
  occurred_at: string
  type: string
  amount_cents: number
  net_amount_cents: number
  reimbursed_total_cents: number
  is_reimbursement: boolean
  category: { id: number; name: string; type: string; icon: string | null } | null
  title: string | null
  description: string | null
  tags: Array<{ id: number; name: string }>
  has_attachments: boolean
}

type UncategorizedResponse = {
  items: TransactionRow[]
  page: number
  limit: number
  has_more: boolean
  total: number
  definition: {
    category_name: string
    matched_category_ids: number[]
  }
  period: { slug: string; start: string; end: string }
  filters: {
    type: string | null
    category_id: number | null
    tag_id: number | null
    query: string | null
  }
  categories: Array<{ id: number; name: string; type: string; icon: string | null }>
  tags: Array<{ id: number; name: string }>
}

type BulkResponse = {
  resolved_count: number
  eligible_count: number
  skipped_count: number
  changes: {
    category_changed: number
    tags_added: number
    tags_removed: number
    tags_replaced: number
    deleted: number
    restored: number
  }
}

type TransactionSuggestion = {
  id: number
  transaction_id: number
  status: string
  category_id: number | null
  category_name: string | null
  clean_title: string | null
  tags: string[]
  confidence: number
  reason: string
}

function UncategorizedInboxPage() {
  const { llmEnabled } = useAuth()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [targetCategoryId, setTargetCategoryId] = useState("")
  const [mode, setMode] = useState<"ids" | "query">("ids")

  const queryString = useMemo(() => {
    const params = new URLSearchParams(searchParams)
    if (!params.get("period")) {
      params.set("period", "all")
    }
    if (!params.get("page")) {
      params.set("page", "1")
    }
    return params.toString()
  }, [searchParams])

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ["transactions", "uncategorized", queryString],
    queryFn: () =>
      apiFetch<UncategorizedResponse>(`/api/transactions/uncategorized?${queryString}`),
  })

  const suggestionsQuery = useQuery({
    queryKey: ["ai", "transaction-suggestions"],
    queryFn: () => apiFetch<TransactionSuggestion[]>("/api/ai/transaction-suggestions"),
    enabled: llmEnabled,
  })

  const bulkMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<BulkResponse>("/api/transactions/bulk/apply", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      setSelectedIds([])
      queryClient.invalidateQueries({ queryKey: ["transactions", "uncategorized"] })
      queryClient.invalidateQueries({ queryKey: ["transactions"] })
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      queryClient.invalidateQueries({ queryKey: ["insights"] })
    },
  })

  const triageMutation = useMutation({
    mutationFn: (transactionId: number) =>
      apiFetch<TransactionSuggestion | null>(`/api/ai/transactions/${transactionId}/triage`, {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai", "transaction-suggestions"] })
    },
  })

  const acceptSuggestionMutation = useMutation({
    mutationFn: (suggestionId: number) =>
      apiFetch<{ id: number }>(`/api/ai/transaction-suggestions/${suggestionId}/accept`, {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai", "transaction-suggestions"] })
      queryClient.invalidateQueries({ queryKey: ["transactions", "uncategorized"] })
      queryClient.invalidateQueries({ queryKey: ["transactions"] })
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      queryClient.invalidateQueries({ queryKey: ["insights"] })
    },
  })

  const rejectSuggestionMutation = useMutation({
    mutationFn: (suggestionId: number) =>
      apiFetch<{ id: number }>(`/api/ai/transaction-suggestions/${suggestionId}/reject`, {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai", "transaction-suggestions"] })
    },
  })

  const setPresetPeriod = (value: PresetPeriod) =>
    setSearchParams(
      buildPresetPeriodSearchParams(searchParams, value, { page: "1" })
    )

  const applyCustomPeriod = (start: string, end: string) =>
    setSearchParams(
      buildCustomPeriodSearchParams(searchParams, start, end, { page: "1" })
    )

  const setQuery = (value: string) => {
    setSearchParams(
      buildSearchParams(searchParams, { q: value.trim() || null, page: "1" })
    )
  }

  const changePage = (nextPage: number) =>
    setSearchParams(buildSearchParams(searchParams, { page: String(nextPage) }))

  if (isLoading) {
    return <div className="text-muted">Loading inbox…</div>
  }
  if (error || !data) {
    return <div className="text-semantic-red">Unable to load uncategorized inbox.</div>
  }

  const allPageSelected =
    data.items.length > 0 && data.items.every((txn) => selectedIds.includes(txn.id))
  const categoryTypes = [...new Set(data.categories.map((c) => c.type))]
  const searchQuery = searchParams.get("q") ?? ""
  const suggestionsByTransaction = new Map(
    (suggestionsQuery.data ?? []).map((suggestion) => [
      suggestion.transaction_id,
      suggestion,
    ])
  )
  const runBulkRecategorize = () => {
    if (!targetCategoryId) {
      return
    }
    if (mode === "ids" && selectedIds.length === 0) {
      return
    }

    const payload =
      mode === "ids"
        ? {
            selection: {
              mode: "ids",
              transaction_ids: selectedIds,
            },
            operation: {
              set_category_id: Number(targetCategoryId),
              tag_patch: null,
              lifecycle: "none",
            },
          }
        : {
            selection: {
              mode: "query",
              query: {
                period: data.period.slug,
                start: data.period.slug === "custom" ? data.period.start : null,
                end: data.period.slug === "custom" ? data.period.end : null,
                type: data.filters.type,
                category: data.filters.category_id,
                matched_category_ids: data.definition.matched_category_ids,
                tag: data.filters.tag_id,
                q: searchQuery || null,
              },
            },
            operation: {
              set_category_id: Number(targetCategoryId),
              tag_patch: null,
              lifecycle: "none",
            },
          }

    if (!confirm("Apply bulk changes to selected transactions?")) {
      return
    }
    bulkMutation.mutate(payload)
  }

  return (
    <section className="space-y-6">
      <PageIntro
        title="Uncategorized"
        backHref="/transactions"
        backLabel="← Back to transactions"
      />

      <PeriodPicker
        periodSlug={data.period.slug}
        start={data.period.start}
        end={data.period.end}
        onSetPreset={setPresetPeriod}
        onApplyCustom={applyCustomPeriod}
      />

      <AppCard className="p-4">
        <div className="mb-4 flex flex-col gap-1">
          <h2 className="font-head text-lg font-bold text-text">Inbox triage</h2>
          <p className="text-sm text-muted">
            Suggestions are staged here first. Nothing is categorized until you accept it.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <AppFieldLabel>
            <span>Search</span>
            <AppInput
              type="text"
              value={searchQuery}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="tag:Work amount>20"
            />
          </AppFieldLabel>
          <AppFieldLabel>
            <span>Move selected to category</span>
            <AppNativeSelect
              value={targetCategoryId}
              onChange={(event) => setTargetCategoryId(event.target.value)}
            >
              <option value="">Choose category</option>
              {categoryTypes.map((type) => (
                <optgroup key={type} label={type.charAt(0).toUpperCase() + type.slice(1)}>
                  {data.categories.filter((c) => c.type === type).map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </AppNativeSelect>
          </AppFieldLabel>
          <div className="flex items-end gap-2">
            <AppButton
              type="button"
              onClick={() => setMode("ids")}
              tone="ghost"
              className={`text-xs ${mode === "ids" ? "border-accent text-accent" : "text-muted"}`}
            >
              Selected
            </AppButton>
            <AppButton
              type="button"
              onClick={() => setMode("query")}
              tone="ghost"
              className={`text-xs ${mode === "query" ? "border-accent text-accent" : "text-muted"}`}
            >
              All filtered
            </AppButton>
            <AppButton
              type="button"
              onClick={runBulkRecategorize}
              disabled={bulkMutation.isPending || !targetCategoryId || (mode === "ids" && selectedIds.length === 0)}
            >
              {bulkMutation.isPending ? "Applying…" : "Apply"}
            </AppButton>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 text-xs text-muted">
          <AppButton
            type="button"
            onClick={() => {
              if (allPageSelected) {
                const pageIds = new Set(data.items.map((txn) => txn.id))
                setSelectedIds((prev) => prev.filter((id) => !pageIds.has(id)))
              } else {
                const merged = new Set(selectedIds)
                for (const item of data.items) {
                  merged.add(item.id)
                }
                setSelectedIds(Array.from(merged))
              }
            }}
            tone="ghost"
            className="px-2.5 py-1 text-xs"
          >
            {allPageSelected ? "Unselect page" : "Select page"}
          </AppButton>
          <span>{selectedIds.length} selected</span>
          {isFetching ? <span className="loading-hint">Updating…</span> : null}
          {bulkMutation.error && (
            <span className="text-semantic-red">{String(bulkMutation.error)}</span>
          )}
        </div>
      </AppCard>

      <div className="space-y-3">
        {data.items.length ? (
          data.items.map((txn) => {
            const suggestion = suggestionsByTransaction.get(txn.id)
            return (
              <AppCard
                key={txn.id}
                className="border-l-2 border-l-semantic-red/55 p-4"
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    aria-label={`Select transaction ${txn.id}`}
                    checked={selectedIds.includes(txn.id)}
                    onChange={() =>
                      setSelectedIds((prev) =>
                        prev.includes(txn.id)
                          ? prev.filter((id) => id !== txn.id)
                          : [...prev, txn.id]
                      )
                    }
                  />
                  <CategoryIcon icon={txn.category?.icon ?? null} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-text">
                      {txn.title || txn.category?.name || "Untitled"}
                    </p>
                    <TransactionDescription
                      markdown={txn.description}
                      compact
                      clamp
                      className="mt-1"
                    />
                    <p className="text-xs text-muted">
                      {formatEuroDate(txn.date)} ·{" "}
                      {txn.category?.name ?? "Uncategorized"}
                    </p>
                    {txn.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {txn.tags.map((tag) => (
                          <span key={tag.id} className="chip">
                            {tag.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <p className="font-mono text-sm font-semibold text-semantic-red">
                    -{formatCurrency(txn.net_amount_cents)} €
                  </p>
                </div>
                {suggestion ? (
                  <div className="mt-3 rounded-lg border border-semantic-blue/25 bg-semantic-blue/10 p-3 text-sm">
                    <p className="font-semibold text-text">
                      Suggested: {suggestion.category_name ?? "Uncategorized"}
                    </p>
                    {suggestion.clean_title ? (
                      <p className="mt-1 text-xs text-muted">
                        Title: {suggestion.clean_title}
                      </p>
                    ) : null}
                    {suggestion.tags.length ? (
                      <p className="mt-1 text-xs text-muted">
                        Tags: {suggestion.tags.join(", ")}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs text-muted">{suggestion.reason}</p>
                    <div className="mt-2 flex justify-end gap-2">
                      <AppButton
                        type="button"
                        tone="ghost"
                        onClick={() =>
                          rejectSuggestionMutation.mutate(suggestion.id)
                        }
                        disabled={rejectSuggestionMutation.isPending}
                        className="text-xs"
                      >
                        <XCircleIcon className="mr-1 h-3.5 w-3.5" />
                        Reject
                      </AppButton>
                      <AppButton
                        type="button"
                        onClick={() =>
                          acceptSuggestionMutation.mutate(suggestion.id)
                        }
                        disabled={acceptSuggestionMutation.isPending}
                        className="text-xs"
                      >
                        <CheckCircleIcon className="mr-1 h-3.5 w-3.5" />
                        Accept
                      </AppButton>
                    </div>
                  </div>
                ) : llmEnabled ? (
                  <div className="mt-3 flex justify-end">
                    <AppButton
                      type="button"
                      onClick={() => triageMutation.mutate(txn.id)}
                      disabled={triageMutation.isPending}
                      tone="ghost"
                      className="text-xs"
                    >
                      {triageMutation.isPending ? "Suggesting…" : "Suggest"}
                    </AppButton>
                  </div>
                ) : null}
              </AppCard>
            )
          })
        ) : (
          <AppCard className="p-6 text-center text-sm text-muted">
            Inbox is empty.
          </AppCard>
        )}
      </div>

      <div className="flex items-center justify-between">
        <AppButton
          type="button"
          onClick={() => changePage(Math.max(1, data.page - 1))}
          disabled={data.page <= 1}
          tone="ghost"
          className="px-4 py-2 text-xs text-muted disabled:opacity-40"
        >
          Previous
        </AppButton>
        <p className="text-xs text-muted">Page {data.page}</p>
        <AppButton
          type="button"
          onClick={() => changePage(data.page + 1)}
          disabled={!data.has_more}
          tone="ghost"
          className="px-4 py-2 text-xs text-muted disabled:opacity-40"
        >
          Next
        </AppButton>
      </div>
    </section>
  )
}

export default UncategorizedInboxPage
