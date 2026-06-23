import { useQuery } from "@tanstack/react-query"
import { useParams } from "react-router-dom"
import { apiFetch } from "../app/api"
import { formatCurrency, formatEuroDate, formatEuroDateTime } from "../app/format"
import PageIntro from "../components/PageIntro"
import { AppCard } from "../components/ui/product-card"

type OccurrenceRule = {
  id: number
  name: string | null
  type: string
  currency_code: string
  amount_cents: number
  category: { id: number; name: string; type: string } | null
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

      <AppCard className="p-4">
        <div className="grid gap-4 text-sm md:grid-cols-2 lg:grid-cols-3">
          <div>
            <p className="text-xs uppercase text-muted">Type</p>
            <p className="font-semibold text-text">{rule.type}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted">Amount</p>
            <p className="font-mono font-semibold text-text">
              {formatCurrency(rule.amount_cents)} {symbol}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted">Category</p>
            <p className="font-semibold text-text">
              {rule.category?.name ?? "-"}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted">Schedule</p>
            <p className="font-semibold text-text">
              Every {rule.interval_count} {rule.interval_unit}
              {rule.interval_count > 1 ? "s" : ""}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted">Start date</p>
            <p className="font-semibold text-text">
              {formatEuroDate(rule.anchor_date)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted">Next occurrence</p>
            <p className="font-semibold text-text">
              {formatEuroDate(rule.next_occurrence)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted">Auto post</p>
            <p className="font-semibold text-text">
              {rule.auto_post ? "Yes" : "No"}
            </p>
          </div>
          {rule.end_date && (
            <div>
              <p className="text-xs uppercase text-muted">End date</p>
              <p className="font-semibold text-text">
                {formatEuroDate(rule.end_date)}
              </p>
            </div>
          )}
        </div>
      </AppCard>

      <AppCard>
        <div className="border-b border-border px-4 py-3">
          <h2 className="font-head text-lg font-bold">
            Posted transactions ({occurrences.length})
          </h2>
        </div>
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
                  <tr key={txn.id}>
                    <td className="px-4 py-3 text-text">
                      {txn.occurrence_date
                        ? formatEuroDate(txn.occurrence_date)
                        : "-"}
                    </td>
                    <td className="px-4 py-3 font-mono text-text">
                      {formatCurrency(txn.amount_cents)} {symbol}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {txn.category?.name ?? "-"}
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
      </AppCard>
    </section>
  )
}

export default RecurringOccurrencesPage
