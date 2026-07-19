import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { apiFetch } from "../app/api"
import { formatCurrency, formatEuroDate } from "../app/format"
import { CategoryIcon } from "../components/CategoryIcon"
import DonutChart from "../components/charts/DonutChart"
import type { BreakdownItem } from "../components/charts/DonutChart"
import Sparkline from "../components/charts/Sparkline"
import PageIntro from "../components/PageIntro"
import PeriodPicker from "../components/PeriodPicker"
import TransactionDescription from "../components/TransactionDescription"
import { Toggle } from "../components/Toggle"
import {
  FinancialPanel,
  MetricLane,
  SectionHeading,
} from "../components/product/ProductSurfaces"
import { AppButton } from "../components/ui/product-button"
import { AppFieldLabel, AppInput } from "../components/ui/product-fields"
import {
  buildCustomPeriodSearchParams,
  buildPresetPeriodSearchParams,
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
}

type TagDetailResponse = {
  tag: {
    id: number
    name: string
    color: string | null
    is_hidden_from_budget: boolean
  }
  period: { slug: string; start: string; end: string }
  kpis: { income: number; expenses: number; balance: number }
  sparklines: { income?: string; expenses?: string; balance?: string }
  donut: {
    mode: "both"
    expense_breakdown: BreakdownItem[]
    income_breakdown: BreakdownItem[]
    has_any_transactions: boolean
  }
  transactions: TransactionRow[]
}

type TagSettingsFormProps = {
  tag: TagDetailResponse["tag"]
  updatePending: boolean
  deletePending: boolean
  updateError: unknown
  onUpdate: (payload: { name: string; is_hidden_from_budget: boolean }) => void
  onDelete: () => void
}

function TagSettingsForm({
  tag,
  updatePending,
  deletePending,
  updateError,
  onUpdate,
  onDelete,
}: TagSettingsFormProps) {
  const [name, setName] = useState(tag.name)
  const [hidden, setHidden] = useState(tag.is_hidden_from_budget)

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onUpdate({
      name: name.trim(),
      is_hidden_from_budget: hidden,
    })
  }

  return (
    <FinancialPanel role="inspector" data-testid="tag-settings-inspector">
      <form onSubmit={handleSubmit}>
        <SectionHeading className="flex-col items-stretch md:flex-row md:items-center">
          <div>
            <h2 className="font-head text-lg font-bold">Tag settings</h2>
            <p className="mt-0.5 text-xs text-muted">
              Identity and budget treatment
            </p>
          </div>
          <AppButton
            type="button"
            onClick={onDelete}
            tone="danger"
            disabled={deletePending}
          >
            Delete tag
          </AppButton>
        </SectionHeading>
        <div className="surface-section-body">
          <div className="grid gap-4 md:grid-cols-[1fr_auto]">
            <AppFieldLabel>
              Name
              <AppInput
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-1"
                required
              />
            </AppFieldLabel>
            <label className="flex items-center gap-3 rounded-md bg-faint px-3 py-2 text-xs text-muted">
              <Toggle on={hidden} onChange={setHidden} />
              Exclude from budgets
            </label>
          </div>
          {Boolean(updateError) && (
            <p className="mt-2 text-xs text-semantic-red">{String(updateError)}</p>
          )}
          <AppButton
            type="submit"
            className="mt-4"
            disabled={updatePending}
          >
            {updatePending ? "Saving…" : "Save changes"}
          </AppButton>
        </div>
      </form>
    </FinancialPanel>
  )
}

function TagDetailPage() {
  const { tagId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const queryString = useMemo(() => {
    const params = new URLSearchParams(searchParams)
    if (!params.get("period")) {
      params.set("period", "all")
    }
    return params.toString()
  }, [searchParams])

  const { data, isLoading, error } = useQuery({
    queryKey: ["tag", tagId, queryString],
    queryFn: () =>
      apiFetch<TagDetailResponse>(`/api/tags/${tagId}?${queryString}`),
    enabled: Boolean(tagId),
  })

  const updateMutation = useMutation({
    mutationFn: (payload: { name: string; is_hidden_from_budget: boolean }) =>
      apiFetch(`/api/tags/${tagId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tag", tagId] })
      queryClient.invalidateQueries({ queryKey: ["tags"] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/tags/${tagId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tags"] })
      navigate("/tags")
    },
  })

  const setPresetPeriod = (value: PresetPeriod) =>
    setSearchParams(buildPresetPeriodSearchParams(searchParams, value))

  const applyCustomPeriod = (start: string, end: string) =>
    setSearchParams(buildCustomPeriodSearchParams(searchParams, start, end))

  const handleDelete = () => {
    if (!window.confirm("Delete this tag? This will remove it from transactions.")) {
      return
    }
    deleteMutation.mutate()
  }

  if (!tagId) {
    return <div className="text-semantic-red">Tag not found.</div>
  }
  if (isLoading) {
    return <div className="text-muted">Loading tag…</div>
  }
  if (error || !data) {
    return <div className="text-semantic-red">Unable to load tag.</div>
  }

  const { tag, period, kpis, sparklines, donut, transactions } = data

  return (
    <section className="space-y-6">
      <PageIntro
        title={tag.name}
        titleAccessory={
          tag.is_hidden_from_budget ? (
            <span className="rounded-full bg-signal-yellow-soft px-2.5 py-1 text-xs font-semibold text-text">
              Excluded from budgets
            </span>
          ) : null
        }
        backHref="/tags"
        backLabel="← Tags"
      />

      <PeriodPicker
        periodSlug={period.slug}
        start={period.start}
        end={period.end}
        onSetPreset={setPresetPeriod}
        onApplyCustom={applyCustomPeriod}
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(19rem,0.85fr)]">
        <div
          data-testid="tag-detail-metrics"
          className="grid grid-cols-1 gap-3 sm:grid-cols-3"
        >
          {[
            {
              label: "Income",
              value: kpis.income,
              tone: "text-semantic-green",
              points: sparklines.income,
            },
            {
              label: "Expenses",
              value: kpis.expenses,
              tone: "text-semantic-red",
              points: sparklines.expenses,
            },
            {
              label: "Balance",
              value: kpis.balance,
              tone: kpis.balance >= 0 ? "text-semantic-green" : "text-semantic-red",
              points: sparklines.balance,
            },
          ].map((item) => (
            <MetricLane
              key={item.label}
              tone={
                item.label === "Income"
                  ? "income"
                  : item.label === "Expenses"
                    ? "expense"
                    : "plan"
              }
              className="p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-muted">
                    {item.label}
                  </p>
                  <p className={`whitespace-nowrap font-mono text-2xl font-semibold ${item.tone}`}>
                    {formatCurrency(item.value)} €
                  </p>
                </div>
                <Sparkline points={item.points} className={`h-10 w-24 ${item.tone}`} />
              </div>
            </MetricLane>
          ))}
        </div>

        <TagSettingsForm
          key={`${tag.id}-${tag.name}-${String(tag.is_hidden_from_budget)}`}
          tag={tag}
          updatePending={updateMutation.isPending}
          deletePending={deleteMutation.isPending}
          updateError={updateMutation.error}
          onUpdate={(payload) => updateMutation.mutate(payload)}
          onDelete={handleDelete}
        />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
        <FinancialPanel role="ledger" data-testid="tag-activity-ledger">
          <SectionHeading>
            <div>
              <h2 className="font-head text-lg font-bold">Activity</h2>
              <p className="mt-0.5 text-xs text-muted">
                Transactions carrying this tag
              </p>
            </div>
            <span className="rounded-full bg-faint px-2.5 py-1 text-xs text-muted">
              {transactions.length}
            </span>
          </SectionHeading>
          <div className="divide-y divide-border">
            {transactions.length ? (
              transactions.map((txn) => {
                const isExpense = txn.type === "expense"
                const amount = isExpense
                  ? txn.net_amount_cents
                  : txn.amount_cents
                return (
                  <div
                    key={txn.id}
                    className="flex flex-col gap-3 px-4 py-3.5 transition-colors hover:bg-faint/60 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <CategoryIcon
                        icon={txn.category?.icon ?? null}
                        label={txn.category?.name}
                      />
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-text">
                          {txn.title || txn.category?.name || "Untitled"}
                        </p>
                        <TransactionDescription
                          markdown={txn.description}
                          compact
                          clamp
                          className="mt-1"
                        />
                        <p className="text-xs text-muted">
                          {formatEuroDate(txn.date)} · {txn.category?.name ?? "Uncategorized"}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p
                        className={`font-mono text-sm font-semibold ${
                          isExpense ? "text-semantic-red" : "text-semantic-green"
                        }`}
                      >
                        {isExpense ? "-" : "+"}
                        {formatCurrency(amount)} €
                      </p>
                      {isExpense && txn.reimbursed_total_cents > 0 && (
                        <p className="font-mono text-xs text-semantic-green">
                          Reimb {formatCurrency(txn.reimbursed_total_cents)} €
                        </p>
                      )}
                    </div>
                  </div>
                )
              })
            ) : (
              <p className="px-4 py-8 text-sm text-muted">
                No transactions in this period.
              </p>
            )}
          </div>
        </FinancialPanel>

        <div className="space-y-4">
          {donut.has_any_transactions ? (
            <div className="space-y-6">
              <DonutChart
                title="Expenses"
                breakdown={donut.expense_breakdown}
                emptyMessage="No expenses in this period"
              />
              <DonutChart
                title="Income"
                breakdown={donut.income_breakdown}
                emptyMessage="No income in this period"
              />
            </div>
          ) : (
            <FinancialPanel className="p-6 text-center">
              <p className="font-head text-lg font-bold text-text">
                No activity yet
              </p>
              <p className="text-sm text-muted">
                Add transactions with this tag to see insights.
              </p>
            </FinancialPanel>
          )}
        </div>
      </div>
    </section>
  )
}

export default TagDetailPage
