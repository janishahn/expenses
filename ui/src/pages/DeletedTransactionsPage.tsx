import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/ArrowCounterClockwise"
import { CaretLeftIcon } from "@phosphor-icons/react/CaretLeft"
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight"
import { TrashIcon } from "@phosphor-icons/react/Trash"
import { XIcon } from "@phosphor-icons/react/X"
import { Navigate, useSearchParams } from "react-router-dom"
import { apiFetch, getApiErrorMessage } from "../app/api"
import { invalidateTransactionData, shortDateLabel } from "../app/transactions"
import { confirmDialog } from "../components/confirm"
import { Amount } from "../components/ui/Amount"
import { BulkBar } from "../components/ui/BulkBar"
import { Button, IconButton } from "../components/ui/Button"
import { CategoryGlyph, UnknownGlyph } from "../components/ui/CategoryGlyph"
import { EmptyState } from "../components/ui/EmptyState"
import { useIsDesktop } from "../components/ui/layout-state"
import { AmountCell, Cell, List, ListFooter, Row, RowLead, type Columns } from "../components/ui/LedgerRow"
import { MenuItem } from "../components/ui/Menu"
import { Panel, PanelError, PanelLoading } from "../components/ui/Panel"
import { showToast } from "../components/ui/toast-store"
import { buildSearchParams } from "../lib/searchParams"

type DeletedTransaction = {
  id: number
  date: string
  type: "income" | "expense"
  amount_cents: number
  category: { id: number; name: string; icon: string | null } | null
  title: string | null
  description: string | null
  deleted_at: string | null
}

type DeletedResponse = { transactions: DeletedTransaction[]; total: number }

const LIMIT = 50

const COLUMNS: Columns = {
  columns: "14px 18px minmax(0, 1fr) 120px 110px 110px",
  narrowColumns: "14px 18px minmax(0, 1fr) 110px 110px",
  mobileColumns: "18px minmax(0, 1fr) auto auto",
}

function countLabel(count: number): string {
  return `${count} transaction${count === 1 ? "" : "s"}`
}

function DeletedTransactionsPage() {
  const queryClient = useQueryClient()
  const isDesktop = useIsDesktop()
  const [searchParams, setSearchParams] = useSearchParams()
  const page = Math.max(1, Number(searchParams.get("page")) || 1)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [pending, setPending] = useState(false)

  const { data, isLoading, isPlaceholderData, error } = useQuery({
    queryKey: ["transactions", "deleted", page],
    queryFn: () => apiFetch<DeletedResponse>(`/api/transactions/deleted?page=${page}&limit=${LIMIT}`),
  })

  if (isLoading) {
    return <PanelLoading title="Trash" parents={[{ label: "Transactions", to: "/transactions" }]} label="Loading trash…" />
  }
  if (error || !data) {
    return <PanelError title="Trash" message="Unable to load deleted transactions." />
  }

  const rows = data.transactions
  const total = data.total
  // A page past the end, from a bookmark or removals elsewhere, moves to the last page with rows.
  if (!rows.length && page > 1 && total > 0 && !isPlaceholderData) {
    const lastPage = Math.ceil(total / LIMIT)
    return (
      <>
        <Navigate replace to={{ search: buildSearchParams(searchParams, { page: lastPage > 1 ? String(lastPage) : null }).toString() }} />
        <PanelLoading title="Trash" parents={[{ label: "Transactions", to: "/transactions" }]} label="Loading trash…" />
      </>
    )
  }
  const first = (page - 1) * LIMIT + 1
  // Rows restored or purged elsewhere drop out of the selection.
  const selected = selectedIds.filter((id) => rows.some((row) => row.id === id))
  const isChecked = (id: number) => selected.includes(id)
  const setChecked = (id: number, checked: boolean) =>
    setSelectedIds(checked ? [...selected.filter((value) => value !== id), id] : selected.filter((value) => value !== id))
  const changePage = (nextPage: number) => {
    setSelectedIds([])
    setSearchParams(buildSearchParams(searchParams, { page: nextPage > 1 ? String(nextPage) : null }))
  }
  // A page emptied by the last action falls back to the previous one.
  const afterRemoval = (removed: number) => {
    setSelectedIds([])
    if (removed >= rows.length && page > 1) changePage(page - 1)
  }

  const restore = async () => {
    setPending(true)
    try {
      const result = await apiFetch<{ restored: number }>("/api/transactions/deleted/restore", {
        method: "POST",
        body: JSON.stringify({ ids: selected }),
      })
      afterRemoval(result.restored)
      invalidateTransactionData(queryClient)
      showToast({ message: `Restored ${countLabel(result.restored)}` })
    } catch (failure) {
      showToast({ message: getApiErrorMessage(failure, "Unable to restore the transactions.") })
    } finally {
      setPending(false)
    }
  }

  const purge = async () => {
    const confirmed = await confirmDialog({
      title: `Delete ${countLabel(selected.length)} forever?`,
      description: "This cannot be undone.",
      confirmLabel: "Delete forever",
    })
    if (!confirmed) return
    setPending(true)
    try {
      const result = await apiFetch<{ deleted: number }>("/api/transactions/deleted/purge", {
        method: "POST",
        body: JSON.stringify({ ids: selected }),
      })
      afterRemoval(result.deleted)
      void queryClient.invalidateQueries({ queryKey: ["transactions", "deleted"] })
      showToast({ message: `Deleted ${countLabel(result.deleted)} forever` })
    } catch (failure) {
      showToast({ message: getApiErrorMessage(failure, "Unable to delete the transactions.") })
    } finally {
      setPending(false)
    }
  }

  return (
    <Panel title="Trash" parents={[{ label: "Transactions", to: "/transactions" }]}>
      <List
        label="Deleted transactions"
        scroll={false}
        hasSelection
        footer={
          rows.length ? (
            total > LIMIT ? (
              <ListFooter>
                {first}–{first + rows.length - 1} of {total}
                <IconButton icon={CaretLeftIcon} label="Previous page" disabled={page <= 1} onClick={() => changePage(page - 1)} />
                <IconButton
                  icon={CaretRightIcon}
                  label="Next page"
                  disabled={first + rows.length - 1 >= total}
                  onClick={() => changePage(page + 1)}
                />
              </ListFooter>
            ) : null
          ) : isPlaceholderData ? null : (
            <EmptyState>Trash is empty</EmptyState>
          )
        }
      >
        {rows.map((row) => {
          const title = row.title || "Untitled"
          return (
            <Row
              key={row.id}
              {...COLUMNS}
              label={title}
              selected={isChecked(row.id)}
              onOpen={() => setChecked(row.id, !isChecked(row.id))}
            >
              <RowLead
                glyph={
                  row.category ? (
                    <CategoryGlyph categoryId={row.category.id} icon={row.category.icon} name={row.category.name} />
                  ) : (
                    <UnknownGlyph />
                  )
                }
                title={title}
                checked={isChecked(row.id)}
                selecting={!isDesktop}
                onCheckedChange={(checked) => setChecked(row.id, checked)}
              />
              <Cell strong>{title}</Cell>
              <Cell tone="muted" hide="narrow">
                {row.category?.name}
              </Cell>
              <Cell tone="muted">{row.deleted_at ? `Deleted ${shortDateLabel(row.deleted_at)}` : null}</Cell>
              <AmountCell>
                <Amount cents={row.amount_cents} kind={row.type} />
              </AmountCell>
            </Row>
          )
        })}
      </List>
      <BulkBar
        count={selected.length}
        onClear={() => setSelectedIds([])}
        selectionMenu={
          <MenuItem icon={XIcon} onSelect={() => setSelectedIds([])}>
            Clear selection
          </MenuItem>
        }
      >
        <Button icon={ArrowCounterClockwiseIcon} disabled={pending} onClick={() => void restore()}>
          Restore
        </Button>
        <Button variant="danger" icon={TrashIcon} disabled={pending} onClick={() => void purge()}>
          Delete forever
        </Button>
      </BulkBar>
    </Panel>
  )
}

export default DeletedTransactionsPage
