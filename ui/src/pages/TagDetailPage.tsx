import { useMemo, useRef, useState } from "react"
import { FloppyDiskIcon } from "@phosphor-icons/react/FloppyDisk"
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple"
import { TrashIcon } from "@phosphor-icons/react/Trash"
import { XIcon } from "@phosphor-icons/react/X"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { apiFetch, getApiErrorMessage, isApiErrorStatus } from "../app/api"
import { formatCurrency, formatEuroDate } from "../app/format"
import { CategoryIcon } from "../components/CategoryIcon"
import { confirmDialog } from "../components/confirm"
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
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog"
import { AppFieldLabel, AppInput } from "../components/ui/product-fields"
import {
  buildCustomPeriodSearchParams,
  buildPresetPeriodSearchParams,
  type PresetPeriod,
} from "../lib/searchParams"
import RouteLoading from "../components/RouteLoading"
import RouteError from "../components/RouteError"

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
    auto_attach_period: { start: string; end: string } | null
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

type TagSettingsEditorProps = {
  tag: TagDetailResponse["tag"]
  updatePending: boolean
  deletePending: boolean
  updateError: unknown
  onUpdate: (payload: {
    name: string
    color: string | null
    is_hidden_from_budget: boolean
    auto_attach_period: { start: string; end: string } | null
  }) => void
  onDelete: () => void
  onClose: () => void
}

function TagSettingsEditor({
  tag,
  updatePending,
  deletePending,
  updateError,
  onUpdate,
  onDelete,
  onClose,
}: TagSettingsEditorProps) {
  const [name, setName] = useState(tag.name)
  const [hidden, setHidden] = useState(tag.is_hidden_from_budget)
  const [autoAttachEnabled, setAutoAttachEnabled] = useState(
    tag.auto_attach_period !== null,
  )
  const [autoAttachStart, setAutoAttachStart] = useState(
    tag.auto_attach_period?.start ?? "",
  )
  const [autoAttachEnd, setAutoAttachEnd] = useState(
    tag.auto_attach_period?.end ?? "",
  )

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onUpdate({
      name: name.trim(),
      color: tag.color,
      is_hidden_from_budget: hidden,
      auto_attach_period: autoAttachEnabled
        ? { start: autoAttachStart, end: autoAttachEnd }
        : null,
    })
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !updatePending && !deletePending) onClose()
      }}
    >
      <DialogContent
        aria-label="Edit tag"
        className="max-h-[calc(100dvh-2rem)] overflow-hidden p-5"
      >
        <div className="-mr-5 overflow-y-auto pr-5">
          <DialogHeader>
            <div>
              <DialogTitle>Edit tag</DialogTitle>
              <p className="mt-1 text-xs text-muted">
                Update identity, budget treatment, and automatic dates
              </p>
            </div>
            <DialogClose asChild>
              <AppButton
                tone="ghost"
                className="h-9 w-9 rounded-full p-0"
                aria-label="Close tag editor"
                disabled={updatePending || deletePending}
              >
                <XIcon className="h-4 w-4" aria-hidden="true" />
              </AppButton>
            </DialogClose>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
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
            <label className="flex items-center gap-3 rounded-md bg-faint p-3 text-xs text-muted">
              <Toggle on={hidden} onChange={setHidden} />
              <span>Exclude from budgets</span>
            </label>
            <label className="flex items-center gap-3 rounded-md bg-faint p-3 text-xs text-muted">
              <Toggle
                on={autoAttachEnabled}
                onChange={setAutoAttachEnabled}
              />
              <span>Automatically add during a date range</span>
            </label>
            {autoAttachEnabled ? (
              <div className="grid gap-3 rounded-md bg-faint p-3 sm:grid-cols-2">
                <AppFieldLabel>
                  Start date
                  <AppInput
                    type="date"
                    value={autoAttachStart}
                    onChange={(event) => setAutoAttachStart(event.target.value)}
                    className="mt-1 max-md:p-0"
                    required
                  />
                </AppFieldLabel>
                <AppFieldLabel>
                  End date
                  <AppInput
                    type="date"
                    value={autoAttachEnd}
                    min={autoAttachStart || undefined}
                    onChange={(event) => setAutoAttachEnd(event.target.value)}
                    className="mt-1 max-md:p-0"
                    required
                  />
                </AppFieldLabel>
              </div>
            ) : null}
            {Boolean(updateError) && (
              <p className="text-xs text-semantic-red">
                {getApiErrorMessage(updateError, "Unable to update tag.")}
              </p>
            )}
            <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
              <AppButton
                type="button"
                onClick={onDelete}
                tone="danger"
                disabled={updatePending || deletePending}
              >
                <TrashIcon className="h-4 w-4" aria-hidden="true" />
                {deletePending ? "Deleting…" : "Delete tag"}
              </AppButton>
              <div className="grid grid-cols-2 gap-2 sm:flex">
                <AppButton
                  type="button"
                  onClick={onClose}
                  tone="ghost"
                  disabled={updatePending || deletePending}
                >
                  Cancel
                </AppButton>
                <AppButton
                  type="submit"
                  disabled={updatePending || deletePending}
                >
                  <FloppyDiskIcon className="h-4 w-4" aria-hidden="true" />
                  {updatePending ? "Saving…" : "Save"}
                </AppButton>
              </div>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function TagDetailPage() {
  const { tagId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [editorOpen, setEditorOpen] = useState(false)
  const editButtonRef = useRef<HTMLButtonElement>(null)

  const closeEditor = () => {
    setEditorOpen(false)
    window.requestAnimationFrame(() => editButtonRef.current?.focus())
  }

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
    mutationFn: (payload: {
      name: string
      color: string | null
      is_hidden_from_budget: boolean
      auto_attach_period: { start: string; end: string } | null
    }) =>
      apiFetch(`/api/tags/${tagId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      closeEditor()
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

  const openEditor = () => {
    updateMutation.reset()
    setEditorOpen(true)
  }

  const handleDelete = async () => {
    const confirmed = await confirmDialog({
      title: "Delete this tag?",
      description: "This will remove it from transactions.",
    })
    if (!confirmed) {
      return
    }
    deleteMutation.mutate()
  }

  if (!tagId || isApiErrorStatus(error, 404)) {
    return (
      <RouteError
        title="Tag"
        message="Tag not found."
        returnHref="/tags"
        returnLabel="Back to tags"
      />
    )
  }
  if (isLoading) {
    return <RouteLoading title="Tag" label="Loading tag…" />
  }
  if (error || !data) {
    return <RouteError title="Tag" message="Unable to load tag." />
  }

  const { tag, period, kpis, sparklines, donut, transactions } = data
  const now = new Date()
  const timezoneOffsetMs = now.getTimezoneOffset() * 60_000
  const today = new Date(now.getTime() - timezoneOffsetMs)
    .toISOString()
    .slice(0, 10)
  const automaticStatus = !tag.auto_attach_period
    ? "Off"
    : today < tag.auto_attach_period.start
      ? "Upcoming"
      : today > tag.auto_attach_period.end
        ? "Ended"
        : "Active"

  return (
    <section className="space-y-4 md:space-y-5">
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

      <FinancialPanel role="hero" className="space-y-5 p-5 md:p-6">
        <div className="w-full lg:ml-auto lg:max-w-[28rem]">
          <PeriodPicker
            periodSlug={period.slug}
            start={period.start}
            end={period.end}
            onSetPreset={setPresetPeriod}
            onApplyCustom={applyCustomPeriod}
          />
        </div>
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
      </FinancialPanel>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
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

        <aside className="space-y-4">
          <FinancialPanel role="inspector" data-testid="tag-settings-inspector">
            <SectionHeading>
              <div>
                <h2 className="font-head text-lg font-bold">Tag settings</h2>
                <p className="mt-0.5 text-xs text-muted">
                  Identity, budget treatment, and automatic dates
                </p>
              </div>
              <AppButton
                ref={editButtonRef}
                type="button"
                onClick={openEditor}
                tone="secondary"
              >
                <PencilSimpleIcon className="h-4 w-4" aria-hidden="true" />
                Edit
              </AppButton>
            </SectionHeading>
            <dl className="divide-y divide-border px-5">
              <div className="grid gap-1 py-3.5 sm:grid-cols-[minmax(7rem,0.7fr)_minmax(0,1.3fr)] sm:gap-4">
                <dt className="text-xs font-semibold text-muted">Name</dt>
                <dd className="min-w-0 break-words text-sm font-semibold text-text sm:text-right">
                  {tag.name}
                </dd>
              </div>
              <div className="grid gap-1 py-3.5 sm:grid-cols-[minmax(7rem,0.7fr)_minmax(0,1.3fr)] sm:gap-4">
                <dt className="text-xs font-semibold text-muted">
                  Budget treatment
                </dt>
                <dd className="min-w-0 text-sm font-semibold text-text sm:text-right">
                  {tag.is_hidden_from_budget
                    ? "Excluded from budgets"
                    : "Included in budgets"}
                  <span className="mt-0.5 block text-xs font-normal text-muted">
                    {tag.is_hidden_from_budget
                      ? "Kept outside normal spending plans"
                      : "Counts toward normal spending plans"}
                  </span>
                </dd>
              </div>
              <div className="grid gap-1 py-3.5 sm:grid-cols-[minmax(7rem,0.7fr)_minmax(0,1.3fr)] sm:gap-4">
                <dt className="text-xs font-semibold text-muted">
                  Automatic tagging
                </dt>
                <dd
                  className={`min-w-0 text-sm font-semibold sm:text-right ${
                    automaticStatus === "Active"
                      ? "text-semantic-green"
                      : automaticStatus === "Upcoming"
                        ? "text-accent"
                        : "text-text"
                  }`}
                >
                  {automaticStatus}
                  <span className="mt-0.5 block text-xs font-normal text-muted">
                    {tag.auto_attach_period
                      ? `${formatEuroDate(tag.auto_attach_period.start)}–${formatEuroDate(tag.auto_attach_period.end)}`
                      : "New transactions are not preselected"}
                  </span>
                </dd>
              </div>
            </dl>
          </FinancialPanel>

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
        </aside>
      </div>

      {editorOpen ? (
        <TagSettingsEditor
          tag={tag}
          updatePending={updateMutation.isPending}
          deletePending={deleteMutation.isPending}
          updateError={updateMutation.error}
          onUpdate={(payload) => updateMutation.mutate(payload)}
          onDelete={handleDelete}
          onClose={closeEditor}
        />
      ) : null}
    </section>
  )
}

export default TagDetailPage
