import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "../app/api"
import { formatCurrency, formatEuroDate, formatEuroDateTime } from "../app/format"
import { CategoryIcon } from "../components/CategoryIcon"
import PageIntro from "../components/PageIntro"
import TransactionDescription from "../components/TransactionDescription"
import {
  FinancialPanel,
  SectionHeading,
} from "../components/product/ProductSurfaces"
import { AppButton } from "../components/ui/product-button"

type DeletedTransaction = {
  id: number
  date: string
  type: string
  amount_cents: number
  category: { id: number; name: string } | null
  title: string | null
  description: string | null
  deleted_at: string | null
}

type DeletedResponse = {
  transactions: DeletedTransaction[]
}

function DeletedTransactionsPage() {
  const queryClient = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ["transactions", "deleted"],
    queryFn: () => apiFetch<DeletedResponse>("/api/transactions/deleted"),
  })

  const restoreMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/transactions/${id}/restore`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] })
      queryClient.invalidateQueries({ queryKey: ["transactions", "deleted"] })
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      queryClient.invalidateQueries({ queryKey: ["insights"] })
      queryClient.invalidateQueries({ queryKey: ["budgets"] })
      queryClient.invalidateQueries({ queryKey: ["forecast"] })
    },
  })

  const permanentDeleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/transactions/${id}/permanent`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions", "deleted"] })
    },
  })

  const handleRestore = (id: number) => {
    restoreMutation.mutate(id)
  }

  const handlePermanentDelete = (id: number) => {
    if (!confirm("Permanently delete this transaction? This cannot be undone.")) {
      return
    }
    permanentDeleteMutation.mutate(id)
  }

  if (isLoading) {
    return <div className="text-muted">Loading deleted transactions…</div>
  }
  if (error || !data) {
    return <div className="text-semantic-red">Unable to load deleted transactions.</div>
  }

  return (
    <section className="space-y-6">
      <PageIntro
        title="Deleted Transactions"
        backHref="/transactions"
        backLabel="← Back to transactions"
      />

      {data.transactions.length === 0 ? (
        <FinancialPanel role="ledger" className="p-10 text-center">
          <p className="font-head text-lg font-bold text-text">No deleted transactions</p>
          <p className="text-sm text-muted">
            Deleted transactions will appear here for recovery.
          </p>
        </FinancialPanel>
      ) : (
        <FinancialPanel role="ledger">
          <SectionHeading>
            <div>
              <p className="mono-meta uppercase text-muted">Recovery queue</p>
              <h2 className="mt-1 font-head text-lg font-bold text-text">
                {data.transactions.length} deleted {data.transactions.length === 1 ? "entry" : "entries"}
              </h2>
            </div>
            <span className="chip">Restore or remove forever</span>
          </SectionHeading>
          {data.transactions.map((txn) => (
            <article
              key={txn.id}
              data-testid={`deleted-transaction-${txn.id}`}
              className="flex flex-col gap-4 border-b border-border p-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between md:p-5"
            >
              <div className="flex min-w-0 items-start gap-3">
                <CategoryIcon
                  icon={null}
                  label={txn.category?.name ?? "Uncategorized"}
                />
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-3">
                    <span className="mono-meta uppercase text-muted">{txn.type}</span>
                    <span
                      className={`font-mono font-semibold ${
                        txn.type === "income"
                          ? "text-semantic-green"
                          : "text-semantic-red"
                      }`}
                    >
                      {txn.type === "expense" ? "−" : "+"}
                      {formatCurrency(txn.amount_cents)} €
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-text">
                    {txn.title || txn.category?.name || "Untitled"}
                  </p>
                  <TransactionDescription
                    markdown={txn.description}
                    compact
                    clamp
                    className="mt-1"
                  />
                  <p className="text-xs text-muted">
                    {formatEuroDate(txn.date)}
                    {txn.category && ` · ${txn.category.name}`}
                    {txn.deleted_at && ` · Deleted ${formatEuroDateTime(txn.deleted_at)}`}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <AppButton
                  type="button"
                  onClick={() => handleRestore(txn.id)}
                  disabled={restoreMutation.isPending}
                  tone="ghost"
                  className="border-semantic-green/40 bg-semantic-green/10 px-4 py-2 text-xs text-semantic-green hover:bg-semantic-green/20"
                >
                  Restore
                </AppButton>
                <AppButton
                  type="button"
                  onClick={() => handlePermanentDelete(txn.id)}
                  disabled={permanentDeleteMutation.isPending}
                  tone="danger"
                >
                  Delete forever
                </AppButton>
              </div>
            </article>
          ))}
        </FinancialPanel>
      )}
    </section>
  )
}

export default DeletedTransactionsPage
