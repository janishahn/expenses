import { useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle"
import { XCircleIcon } from "@phosphor-icons/react/XCircle"
import { TrashIcon } from "@phosphor-icons/react/Trash"
import { apiFetch } from "../app/api"
import { useAuth } from "../app/auth"
import { formatCurrency } from "../app/format"
import { Toggle } from "../components/Toggle"
import { CategoryIcon } from "../components/CategoryIcon"
import PageIntro from "../components/PageIntro"
import { AppButton } from "../components/ui/product-button"
import { AppCard } from "../components/ui/product-card"
import {
  AppFieldLabel,
  AppInput,
  AppNativeSelect,
} from "../components/ui/product-fields"

type RuleCategory = {
  id: number
  name: string
  type: string
  icon: string | null
}

type RuleTag = {
  id: number
  name: string
  is_hidden_from_budget: boolean
}

type RuleRow = {
  id: number
  name: string
  enabled: boolean
  priority: number
  match_type: string
  match_value: string
  transaction_type: string | null
  min_amount_cents: number | null
  max_amount_cents: number | null
  set_category_id: number | null
  set_category: RuleCategory | null
  add_tags: string[]
  budget_exclude_tag_id: number | null
  budget_exclude_tag: { id: number; name: string } | null
}

type RulesResponse = {
  rules: RuleRow[]
  categories: RuleCategory[]
  tags: RuleTag[]
}

type RulePreviewSample = {
  id: number
  title: string | null
  amount_cents: number
  type: string
  before_category: string
  after_category: string
  add_tags: string[]
}

type RulePreview = {
  matches_count: number
  sample: RulePreviewSample[]
}

type RuleSuggestion = {
  id: number
  status: string
  name: string
  match_type: string
  match_value: string
  transaction_type: string | null
  set_category_name: string | null
  add_tags: string[]
  confidence: number
  reason: string
  preview_matches_count: number
}

function RulesPage() {
  const { llmEnabled } = useAuth()
  const queryClient = useQueryClient()
  const formRef = useRef<HTMLFormElement | null>(null)
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [name, setName] = useState("")
  const [enabled, setEnabled] = useState(true)
  const [priority, setPriority] = useState("100")
  const [matchType, setMatchType] = useState("contains")
  const [matchValue, setMatchValue] = useState("")
  const [transactionType, setTransactionType] = useState("")
  const [minAmount, setMinAmount] = useState("")
  const [maxAmount, setMaxAmount] = useState("")
  const [setCategoryId, setSetCategoryId] = useState("")
  const [addTags, setAddTags] = useState<string[]>([])
  const [budgetExcludeTagId, setBudgetExcludeTagId] = useState("")
  const [formError, setFormError] = useState("")
  const [preview, setPreview] = useState<RulePreview | null>(null)
  const [previewError, setPreviewError] = useState("")
  const [ruleMiningStatus, setRuleMiningStatus] = useState<"idle" | "none_found">("idle")

  const { data, isLoading, error } = useQuery({
    queryKey: ["rules"],
    queryFn: () => apiFetch<RulesResponse>("/api/rules"),
  })

  const suggestionsQuery = useQuery({
    queryKey: ["ai", "rule-suggestions"],
    queryFn: () => apiFetch<RuleSuggestion[]>("/api/ai/rules/suggestions"),
    enabled: llmEnabled,
  })

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch("/api/rules", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rules"] })
      setEditingId(null)
      setFormError("")
    },
  })

  const updateMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch(`/api/rules/${editingId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rules"] })
      setEditingId(null)
      setFormError("")
    },
  })

  const toggleMutation = useMutation({
    mutationFn: (payload: { id: number; enabled: boolean }) =>
      apiFetch(`/api/rules/${payload.id}/toggle`, {
        method: "POST",
        body: JSON.stringify({ enabled: payload.enabled }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rules"] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/rules/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rules"] })
    },
  })

  const previewMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<RulePreview>("/api/rules/preview", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (data) => {
      setPreview(data)
      setPreviewError("")
    },
    onError: (error) => {
      setPreview(null)
      setPreviewError(String(error))
    },
  })

  const mineRulesMutation = useMutation({
    mutationFn: () =>
      apiFetch<RuleSuggestion[]>("/api/ai/rules/mine", { method: "POST" }),
    onMutate: () => {
      setRuleMiningStatus("idle")
    },
    onSuccess: (suggestions) => {
      setRuleMiningStatus(suggestions.length ? "idle" : "none_found")
      queryClient.invalidateQueries({ queryKey: ["ai", "rule-suggestions"] })
    },
    onError: () => {
      setRuleMiningStatus("idle")
    },
  })

  const acceptRuleSuggestionMutation = useMutation({
    mutationFn: (suggestionId: number) =>
      apiFetch<{ id: number }>(`/api/ai/rules/suggestions/${suggestionId}/accept`, {
        method: "POST",
      }),
    onSuccess: () => {
      setRuleMiningStatus("idle")
      queryClient.invalidateQueries({ queryKey: ["ai", "rule-suggestions"] })
      queryClient.invalidateQueries({ queryKey: ["rules"] })
    },
  })

  const rejectRuleSuggestionMutation = useMutation({
    mutationFn: (suggestionId: number) =>
      apiFetch<{ id: number }>(`/api/ai/rules/suggestions/${suggestionId}/reject`, {
        method: "POST",
      }),
    onSuccess: () => {
      setRuleMiningStatus("idle")
      queryClient.invalidateQueries({ queryKey: ["ai", "rule-suggestions"] })
    },
  })

  const handleEditRule = (rule: RuleRow) => {
    setEditingId(rule.id)
    setName(rule.name)
    setEnabled(rule.enabled)
    setPriority(String(rule.priority))
    setMatchType(rule.match_type)
    setMatchValue(rule.match_value)
    setTransactionType(rule.transaction_type ?? "")
    setMinAmount(
      rule.min_amount_cents !== null
        ? (rule.min_amount_cents / 100).toFixed(2)
        : ""
    )
    setMaxAmount(
      rule.max_amount_cents !== null
        ? (rule.max_amount_cents / 100).toFixed(2)
        : ""
    )
    setSetCategoryId(rule.set_category_id ? String(rule.set_category_id) : "")
    setAddTags(rule.add_tags || [])
    setBudgetExcludeTagId(
      rule.budget_exclude_tag_id ? String(rule.budget_exclude_tag_id) : ""
    )
    setPreview(null)
    setPreviewError("")
  }

  const parseAmount = (raw: string) => {
    if (!raw.trim()) return null
    const normalized = raw.replace(/\s/g, "").replace(",", ".")
    const value = Number(normalized)
    if (!Number.isFinite(value) || value < 0) {
      return null
    }
    return Math.round(value * 100)
  }

  const resetForm = () => {
    setEditingId(null)
    setName("")
    setEnabled(true)
    setPriority("100")
    setMatchType("contains")
    setMatchValue("")
    setTransactionType("")
    setMinAmount("")
    setMaxAmount("")
    setSetCategoryId("")
    setAddTags([])
    setBudgetExcludeTagId("")
    setFormError("")
    setPreview(null)
    setPreviewError("")
  }

  const jumpToForm = () => {
    resetForm()
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      nameInputRef.current?.focus()
    })
  }

  const buildPayload = () => {
    if (!name.trim()) {
      return { error: "Enter a rule name." }
    }
    if (!matchValue.trim()) {
      return { error: "Enter a match value." }
    }
    const minCents = parseAmount(minAmount)
    const maxCents = parseAmount(maxAmount)
    if (minAmount && minCents === null) {
      return { error: "Invalid min amount." }
    }
    if (maxAmount && maxCents === null) {
      return { error: "Invalid max amount." }
    }
    return {
      payload: {
        name: name.trim(),
        enabled,
        priority: Number(priority) || 100,
        match_type: matchType,
        match_value: matchValue.trim(),
        transaction_type: transactionType || null,
        min_amount_cents: minCents,
        max_amount_cents: maxCents,
        set_category_id: setCategoryId ? Number(setCategoryId) : null,
        add_tags: addTags,
        budget_exclude_tag_id: budgetExcludeTagId
          ? Number(budgetExcludeTagId)
          : null,
      },
    }
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError("")
    const built = buildPayload()
    if (!built.payload) {
      setFormError(built.error || "Fix the rule form.")
      return
    }
    if (editingId) {
      updateMutation.mutate(built.payload)
      return
    }
    createMutation.mutate(built.payload)
  }

  const handlePreview = () => {
    setFormError("")
    const built = buildPayload()
    if (!built.payload) {
      setFormError(built.error || "Fix the rule form.")
      return
    }
    previewMutation.mutate(built.payload)
  }

  if (isLoading) {
    return <div className="text-muted">Loading rules…</div>
  }
  if (error || !data) {
    return <div className="text-semantic-red">Unable to load rules.</div>
  }

  const hiddenTags = data.tags.filter((t) => t.is_hidden_from_budget)
  const ruleSuggestions = suggestionsQuery.data ?? []

  return (
    <section className="space-y-6">
      <PageIntro
        title="Categorization Rules"
        actions={
          <AppButton
            type="button"
            onClick={jumpToForm}
            className="desk:hidden"
          >
            Create rule
          </AppButton>
        }
      />

      {llmEnabled ? (
        <AppCard className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="font-head text-lg font-bold text-text">Rule suggestions</h2>
              {ruleMiningStatus === "none_found" && !ruleSuggestions.length ? (
                <span className="shrink-0 text-xs font-semibold text-muted">
                  No suggestions
                </span>
              ) : null}
            </div>
            <AppButton
              type="button"
              onClick={() => mineRulesMutation.mutate()}
              disabled={mineRulesMutation.isPending}
              className="shrink-0"
            >
              {mineRulesMutation.isPending ? "Mining…" : "Mine rules"}
            </AppButton>
          </div>
        </AppCard>
      ) : null}

      {llmEnabled && ruleSuggestions.length ? (
        <div className="space-y-2">
          {ruleSuggestions.map((suggestion) => (
            <div
              key={suggestion.id}
              className="rounded-lg border border-border bg-surface-hi/40 p-3"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="truncate font-semibold text-text">{suggestion.name}</p>
                  <span className="shrink-0 text-xs tabular-nums text-muted">
                    {Math.round(suggestion.confidence * 100)}%
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <AppButton
                    type="button"
                    tone="ghost"
                    onClick={() => rejectRuleSuggestionMutation.mutate(suggestion.id)}
                    disabled={rejectRuleSuggestionMutation.isPending}
                    className="text-xs"
                  >
                    <XCircleIcon className="mr-1 h-3.5 w-3.5" />
                    Reject
                  </AppButton>
                  <AppButton
                    type="button"
                    onClick={() => acceptRuleSuggestionMutation.mutate(suggestion.id)}
                    disabled={acceptRuleSuggestionMutation.isPending}
                    className="text-xs"
                  >
                    <CheckCircleIcon className="mr-1 h-3.5 w-3.5" />
                    Accept
                  </AppButton>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          {data.rules.length ? (
            data.rules.map((rule) => (
              <AppCard key={rule.id} className="p-4">
                <div className="mb-3 flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-text">{rule.name}</p>
                    <p className="text-xs text-muted">
                      Priority {rule.priority} ·{" "}
                      {rule.enabled ? "Enabled" : "Disabled"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <AppButton
                      type="button"
                      onClick={() => handleEditRule(rule)}
                      tone="inline"
                    >
                      Edit
                    </AppButton>
                    <Toggle on={rule.enabled} onChange={(val) => toggleMutation.mutate({ id: rule.id, enabled: val })} />
                    <AppButton
                      type="button"
                      onClick={() => deleteMutation.mutate(rule.id)}
                      tone="inlineDanger"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                      Delete
                    </AppButton>
                  </div>
                </div>
                <div className="space-y-2 text-sm text-muted">
                  <p>
                    <span className="rounded-sm bg-surface-hi px-2 py-0.5 text-xs font-semibold">
                      IF
                    </span>{" "}
                    Title {rule.match_type.replace("_", " ")} "{rule.match_value}"
                    {rule.transaction_type && ` · Type ${rule.transaction_type}`}
                    {(rule.min_amount_cents !== null ||
                      rule.max_amount_cents !== null) && (
                      <>
                        {" "}
                        · Amount
                        {rule.min_amount_cents !== null &&
                          ` ≥ ${formatCurrency(rule.min_amount_cents)} €`}
                        {rule.max_amount_cents !== null &&
                          ` ≤ ${formatCurrency(rule.max_amount_cents)} €`}
                      </>
                    )}
                  </p>
                  <p>
                    <span className="rounded-sm bg-surface-hi px-2 py-0.5 text-xs font-semibold">
                      THEN
                    </span>{" "}
                    {rule.set_category ? (
                      <span className="inline-flex items-center gap-1.5">
                        Category → <CategoryIcon icon={rule.set_category?.icon ?? null} /> <strong>{rule.set_category.name}</strong>
                      </span>
                    ) : (
                      "Category unchanged"
                    )}
                    {rule.add_tags.length > 0 &&
                      ` · Add tags: ${rule.add_tags.join(", ")}`}
                    {rule.budget_exclude_tag && (
                      <>
                        {" "}
                        · Add tag <strong>{rule.budget_exclude_tag.name}</strong>
                      </>
                    )}
                  </p>
                </div>
              </AppCard>
            ))
          ) : (
            <AppCard className="p-10 text-center">
              <p className="font-head text-lg font-bold text-text">No rules yet</p>
              <p className="text-sm text-muted">
                Create a rule to auto-categorize expenses like "Rent" or
                "Netflix".
              </p>
            </AppCard>
          )}
        </div>

        <AppCard>
          <form
            ref={formRef}
            onSubmit={handleSubmit}
            className="editor-rail"
          >
            <div className="surface-section-header">
              <p className="text-xs font-semibold uppercase text-muted">
                Editor
              </p>
              <h2 className="font-head text-lg font-bold">
                {editingId ? "Edit rule" : "Create rule"}
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
                  placeholder="e.g. Netflix → Subscriptions"
                  required
                />
              </AppFieldLabel>
              <label className="flex items-center gap-3 rounded-md border border-border bg-bg px-3 py-2 text-xs text-muted">
                <Toggle on={enabled} onChange={setEnabled} />
                Apply this rule automatically
              </label>
              <AppFieldLabel>
                Priority
                <AppInput
                  type="number"
                  min={0}
                  max={10000}
                  value={priority}
                  onChange={(event) => setPriority(event.target.value)}
                  className="mt-1"
                />
              </AppFieldLabel>
              <AppFieldLabel>
                Transaction type (optional)
                <AppNativeSelect
                  value={transactionType}
                  onChange={(event) => setTransactionType(event.target.value)}
                  className="mt-1"
                >
                  <option value="">Any</option>
                  <option value="income">Income</option>
                  <option value="expense">Expense</option>
                </AppNativeSelect>
              </AppFieldLabel>
              <div className="rounded-lg border border-border bg-bg p-3">
                <p className="mb-2 text-xs font-semibold text-muted">
                  Match condition
                </p>
                <div className="space-y-3">
                  <AppFieldLabel>
                    Match type
                    <AppNativeSelect
                      value={matchType}
                      onChange={(event) => setMatchType(event.target.value)}
                      className="mt-1"
                    >
                      <option value="contains">Contains</option>
                      <option value="starts_with">Starts with</option>
                      <option value="equals">Equals</option>
                      <option value="regex">Regex</option>
                    </AppNativeSelect>
                  </AppFieldLabel>
                  <AppFieldLabel>
                    Title text
                    <AppInput
                      value={matchValue}
                      onChange={(event) => setMatchValue(event.target.value)}
                      className="mt-1"
                      placeholder="e.g. netflix"
                      required
                    />
                  </AppFieldLabel>
                  <div className="grid grid-cols-2 gap-2">
                    <AppFieldLabel>
                      Min amount
                      <AppInput
                        value={minAmount}
                        onChange={(event) => setMinAmount(event.target.value)}
                        inputMode="decimal"
                        className="mt-1"
                        placeholder="5.00"
                      />
                    </AppFieldLabel>
                    <AppFieldLabel>
                      Max amount
                      <AppInput
                        value={maxAmount}
                        onChange={(event) => setMaxAmount(event.target.value)}
                        inputMode="decimal"
                        className="mt-1"
                        placeholder="50.00"
                      />
                    </AppFieldLabel>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-border bg-bg p-3">
                <p className="mb-2 text-xs font-semibold text-muted">
                  Actions
                </p>
                <div className="space-y-3">
                  <AppFieldLabel>
                    Set category (optional)
                    <AppNativeSelect
                      value={setCategoryId}
                      onChange={(event) => setSetCategoryId(event.target.value)}
                      className="mt-1"
                    >
                      <option value="">Leave unchanged</option>
                      {data.categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.type} · {category.name}
                        </option>
                      ))}
                    </AppNativeSelect>
                  </AppFieldLabel>
                  <AppFieldLabel>
                    Add tags (comma-separated)
                    <AppInput
                      value={addTags.join(", ")}
                      onChange={(event) =>
                        setAddTags(
                          event.target.value
                            .split(",")
                            .map((t) => t.trim())
                            .filter(Boolean)
                        )
                      }
                      className="mt-1"
                      placeholder="e.g. subscription, streaming"
                    />
                  </AppFieldLabel>
                  <AppFieldLabel>
                    Exclude from budget (optional)
                    <AppNativeSelect
                      value={budgetExcludeTagId}
                      onChange={(event) =>
                        setBudgetExcludeTagId(event.target.value)
                      }
                      className="mt-1"
                    >
                      <option value="">No</option>
                      {hiddenTags.map((tag) => (
                        <option key={tag.id} value={tag.id}>
                          {tag.name}
                        </option>
                      ))}
                    </AppNativeSelect>
                  </AppFieldLabel>
                </div>
              </div>
              {formError && (
                <p className="text-xs text-semantic-red">{formError}</p>
              )}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <AppButton
                  type="button"
                  onClick={handlePreview}
                  tone="ghost"
                  disabled={
                    previewMutation.isPending ||
                    createMutation.isPending ||
                    updateMutation.isPending
                  }
                >
                  {previewMutation.isPending ? "Previewing…" : "Preview matches"}
                </AppButton>

                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  {editingId && (
                    <AppButton
                      type="button"
                      onClick={resetForm}
                      tone="ghost"
                    >
                      Cancel
                    </AppButton>
                  )}
                  <AppButton
                    type="submit"
                    disabled={createMutation.isPending || updateMutation.isPending}
                  >
                    {editingId
                      ? updateMutation.isPending
                        ? "Saving…"
                        : "Update rule"
                      : createMutation.isPending
                        ? "Saving…"
                        : "Save rule"}
                  </AppButton>
                </div>
              </div>

            {previewError ? (
              <p className="text-xs text-semantic-red">{previewError}</p>
            ) : null}

            {preview ? (
              <div className="rounded-lg border border-border bg-bg p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-text">Preview</p>
                  <span className="chip text-[11px] text-text">
                    {preview.matches_count} match
                    {preview.matches_count === 1 ? "" : "es"} in recent activity
                  </span>
                </div>

                {preview.sample.length ? (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="min-w-full text-xs">
                      <thead className="bg-faint text-[11px] font-semibold uppercase tracking-wide text-muted">
                        <tr>
                          <th className="px-3 py-2 text-left">Title</th>
                          <th className="px-3 py-2 text-left">Type</th>
                          <th className="px-3 py-2 text-right">Amount</th>
                          <th className="px-3 py-2 text-left">Category</th>
                          <th className="px-3 py-2 text-left">Tags to add</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border text-text">
                        {preview.sample.map((row) => (
                          <tr key={row.id}>
                            <td className="max-w-[240px] truncate px-3 py-2 font-semibold text-text">
                              {row.title || "—"}
                            </td>
                            <td className="px-3 py-2 capitalize">{row.type}</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">
                              {formatCurrency(row.amount_cents)} €
                            </td>
                            <td className="px-3 py-2">
                              {row.before_category !== row.after_category ? (
                                <span className="inline-flex flex-wrap items-center gap-1">
                                  <span className="rounded-full border border-border bg-faint px-2 py-0.5 text-[11px] text-text">
                                    {row.before_category}
                                  </span>
                                  <span className="text-muted">→</span>
                                  <span className="rounded-full border border-border bg-faint px-2 py-0.5 text-[11px] text-text">
                                    {row.after_category}
                                  </span>
                                </span>
                              ) : (
                                row.before_category
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {row.add_tags.length ? row.add_tags.join(", ") : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-muted">
                    No recent transactions match this rule.
                  </p>
                )}
              </div>
            ) : null}
            </div>
          </form>
        </AppCard>
      </div>
    </section>
  )
}

export default RulesPage
