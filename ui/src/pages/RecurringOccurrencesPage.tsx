import { useQuery } from "@tanstack/react-query"
import { useParams } from "react-router-dom"
import { apiFetch } from "../app/api"
import { formatCurrency, formatEuroDate, formatEuroDateTime } from "../app/format"
import { CategoryIcon } from "../components/CategoryIcon"
import PageIntro from "../components/PageIntro"
import {
  FinancialPanel,
  MetricLane,
  SectionHeading,
} from "../components/product/ProductSurfaces"

type OccurrenceRule = {
  id: number
  name: string | null
  type: string
  currency_code: string
  amount_cents: number
  category: { id: number; name: string; type: string; icon?: string | null } | null
  interval_unit: string
  interval_count: number
  anchor_date: string
  next_occurrence: string
  end_date: string | null
  auto_post: boolean
}

type OccurrenceRow = {
  id: number
  occurrence_date: string | null
  amount_cents: number
  category: { id: number; name: string } | null
  title: string | null
  created_at: string | null
}

type OccurrencesResponse = {
  rule: OccurrenceRule
  occurrences: OccurrenceRow[]
}

function RecurringOccurrencesPage() {
  const { ruleId } = useParams()

  const { data, isLoading, error } = useQuery({
    queryKey: ["recurring", ruleId, "occurrences"],
    queryFn: () =>
      apiFetch<OccurrencesResponse>(`/api/recurring/${ruleId}/occurrences`),
    enabled: Boolean(ruleId),
  })

  if (!ruleId) {
    return <div className="text-semantic-red">Rule not found.</div>
  }
  if (isLoading) {
    return <div className="text-muted">Loading occurrences…</div>
  }
  if (error || !data) {
    return <div className="text-semantic-red">Unable to load occurrences.</div>
  }

  const { rule, occurrences } = data
  const symbol = rule.currency_code === "USD" ? "$" : "€"

  return (
    <section className="space-y-6">
      <PageIntro
        title={rule.name || `Rule #${rule.id}`}
        backHref="/recurring"
        backLabel="← Back to recurring"
      />

      <div
        data-testid="recurring-occurrence-summary"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <MetricLane tone={rule.type === "income" ? "income" : "expense"}>
          <p className="text-xs font-semibold text-muted">Commitment</p>
          <p className="mt-3 font-mono text-2xl font-semibold tabular-nums text-text">
            {formatCurrency(rule.amount_cents)} {symbol}
          </p>
          <p className="mt-1 capitalize text-xs text-muted">{rule.type}</p>
        </MetricLane>
        <MetricLane tone="plan">
          <div className="flex items-center gap-2.5">
            <CategoryIcon
              icon={rule.category?.icon ?? null}
              label={rule.category?.name}
            />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-muted">Category</p>
              <p className="truncate font-semibold text-text">
                {rule.category?.name ?? "Uncategorized"}
              </p>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted">
            Every {rule.interval_count} {rule.interval_unit}
            {rule.interval_count > 1 ? "s" : ""}
          </p>
        </MetricLane>
        <MetricLane tone="warning">
          <p className="text-xs font-semibold text-muted">Next occurrence</p>
          <p className="mt-3 font-mono text-lg font-semibold text-text">
            {formatEuroDate(rule.next_occurrence)}
          </p>
          <p className="mt-1 text-xs text-muted">
            Started {formatEuroDate(rule.anchor_date)}
          </p>
        </MetricLane>
        <MetricLane tone="neutral">
          <p className="text-xs font-semibold text-muted">Posting</p>
          <p className="mt-3 font-semibold text-text">
            {rule.auto_post ? "Automatic" : "Manual"}
          </p>
          <p className="mt-1 text-xs text-muted">
            {rule.end_date
              ? `Ends ${formatEuroDate(rule.end_date)}`
              : "No end date"}
          </p>
        </MetricLane>
      </div>

      <FinancialPanel role="ledger" data-testid="recurring-occurrence-ledger">
        <SectionHeading>
          <div>
            <h2 className="font-head text-lg font-bold">Posted transactions</h2>
            <p className="mt-0.5 text-xs text-muted">
              Audit trail for this recurring commitment
            </p>
          </div>
          <span className="rounded-full bg-faint px-2.5 py-1 text-xs text-muted">
            {occurrences.length}
          </span>
        </SectionHeading>
        <div className="overflow-x-auto">
          {occurrences.length ? (
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {occurrences.map((txn) => (
                  <tr key={txn.id} className="transition-colors hover:bg-faint/60">
                    <td className="px-4 py-3 text-text">
                      {txn.occurrence_date
                        ? formatEuroDate(txn.occurrence_date)
                        : "-"}
                    </td>
                    <td className="px-4 py-3 font-mono text-text">
                      {formatCurrency(txn.amount_cents)} {symbol}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      <span className="inline-flex items-center gap-2">
                        <CategoryIcon
                          icon={null}
                          label={txn.category?.name}
                          className="h-8 w-8"
                        />
                        {txn.category?.name ?? "Uncategorized"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {txn.title ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {txn.created_at
                        ? formatEuroDateTime(txn.created_at)
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-4 py-6 text-center text-sm text-muted">
              No occurrences posted yet.
            </p>
          )}
        </div>
      </FinancialPanel>
    </section>
  )
}

export default RecurringOccurrencesPage
