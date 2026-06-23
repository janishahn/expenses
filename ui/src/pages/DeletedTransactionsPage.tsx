import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "../app/api"
import { formatCurrency, formatEuroDate, formatEuroDateTime } from "../app/format"
import PageIntro from "../components/PageIntro"
import TransactionDescription from "../components/TransactionDescription"
import { AppButton } from "../components/ui/product-button"
import { AppCard } from "../components/ui/product-card"

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
        <AppCard className="p-10 text-center">
          <p className="font-head text-lg font-bold text-text">No deleted transactions</p>
          <p className="text-sm text-muted">
            Deleted transactions will appear here for recovery.
          </p>
        </AppCard>
      ) : (
        <div className="space-y-3">
          {data.transactions.map((txn) => (
            <AppCard
              key={txn.id}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      txn.type === "income"
                        ? "bg-semantic-green/10 text-semantic-green"
                        : "bg-semantic-red/10 text-semantic-red"
                    }`}
                  >
                    {txn.type}
                  </span>
                  <span className="font-mono font-semibold text-text">
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
            </AppCard>
          ))}
        </div>
      )}
    </section>
  )
}

export default DeletedTransactionsPage
