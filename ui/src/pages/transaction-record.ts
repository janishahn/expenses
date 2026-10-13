import { useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch, apiFetchFormData, getApiErrorMessage } from "../app/api"
import type {
  CategoriesResponse,
  CategorySummary,
  ReceiptAttachment,
  TagsResponse,
  TransactionDetail,
  TransactionReimbursements,
} from "../app/api-types"
import {
  applyTransactionChanges,
  invalidateTransactionData,
  transactionPayload,
  type TransactionChanges,
} from "../app/transactions"
import { confirmDialog } from "../components/confirm"
import type { ReceiptFile } from "../components/ui/receipt-file"
import { showToast } from "../components/ui/toast-store"

export type RecordField = "title" | "amount" | "type" | "date" | "category" | "tags" | "notes" | "reimbursement" | "durable"

export type DurableInput = { expected_lifespan_days: number; acquired_on: string }

// Pickers show their entered value while it saves and after it fails. Text editors keep
// their own draft instead, so the stored value stays what the draft is compared with.
const PICKER_FIELDS: ReadonlySet<RecordField> = new Set(["type", "date", "category", "tags", "reimbursement"])

// One transaction as a peek or full view edits it. Each change saves at once with the
// full PUT body; saves run one after another so each builds on the last.
export function useTransactionRecord(id: number) {
  const queryClient = useQueryClient()
  const key = ["transaction", String(id)]
  const detailQuery = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<TransactionDetail>(`/api/transactions/${id}`),
    // Never show another record while this one loads.
    placeholderData: undefined,
  })
  const categoriesQuery = useQuery({
    queryKey: ["categories", "all"],
    queryFn: () => apiFetch<CategoriesResponse>("/api/categories?period=all"),
  })
  const tagsQuery = useQuery({
    queryKey: ["tags", "all"],
    queryFn: () => apiFetch<TagsResponse>("/api/tags?period=all"),
  })
  const stored = detailQuery.data?.id === id ? detailQuery.data : undefined
  const reimbursementsQuery = useQuery({
    queryKey: ["transaction", id, "reimbursements"],
    queryFn: () => apiFetch<TransactionReimbursements>(`/api/transactions/${id}/reimbursements`),
    enabled: Boolean(stored && (stored.type === "expense" ? stored.reimbursed_total_cents > 0 : stored.is_reimbursement)),
    placeholderData: undefined,
  })

  // Values entered in pickers, shown while they save and kept with the error when they fail.
  const [entered, setEntered] = useState<Partial<Record<RecordField, TransactionChanges>>>({})
  const [errors, setErrors] = useState<Partial<Record<RecordField, string>>>({})
  const [receiptError, setReceiptError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const queue = useRef<Promise<unknown>>(Promise.resolve())

  const setError = (field: RecordField, message: string | null) =>
    setErrors((current) => ({ ...current, [field]: message ?? undefined }))

  const save = (field: RecordField, changes: TransactionChanges): Promise<boolean> => {
    if (PICKER_FIELDS.has(field)) setEntered((current) => ({ ...current, [field]: changes }))
    setError(field, null)
    const run = async () => {
      const current = queryClient.getQueryData<TransactionDetail>(key)
      if (!current) return false
      try {
        await apiFetch(`/api/transactions/${id}`, {
          method: "PUT",
          body: JSON.stringify(transactionPayload(current, changes)),
        })
      } catch (error) {
        setError(field, getApiErrorMessage(error, "Unable to save the change."))
        return false
      }
      queryClient.setQueryData(key, applyTransactionChanges(current, changes))
      setEntered((current) => {
        const next = { ...current }
        delete next[field]
        return next
      })
      invalidateTransactionData(queryClient)
      return true
    }
    const result = queue.current.then(run)
    queue.current = result
    return result
  }

  const view = stored
    ? Object.values(entered).reduce<TransactionDetail>((record, changes) => applyTransactionChanges(record, changes), stored)
    : undefined
  const categories = categoriesQuery.data?.categories ?? []
  const category: CategorySummary | null = view
    ? (categories.find((entry) => entry.id === view.category_id) ??
      (stored?.category && stored.category.id === view.category_id ? stored.category : null))
    : null

  const saveDurable = async (input: DurableInput | null): Promise<boolean> => {
    setError("durable", null)
    try {
      await apiFetch(`/api/transactions/${id}/durable`, {
        method: input ? "POST" : "DELETE",
        body: input ? JSON.stringify(input) : undefined,
      })
    } catch (error) {
      setError(
        "durable",
        getApiErrorMessage(error, input ? "Unable to save durable tracking." : "Unable to stop tracking this durable purchase.")
      )
      return false
    }
    void queryClient.invalidateQueries({ queryKey: key })
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] })
    void queryClient.invalidateQueries({ queryKey: ["durable-purchases"] })
    return true
  }

  const refreshReceipts = () => {
    void queryClient.invalidateQueries({ queryKey: key })
    void queryClient.invalidateQueries({ queryKey: ["transactions"] })
  }
  const uploadReceipt = async (file: File): Promise<boolean> => {
    setReceiptError(null)
    setUploading(true)
    try {
      const form = new FormData()
      form.append("file", file)
      await apiFetchFormData<ReceiptAttachment>(`/api/transactions/${id}/attachments`, { method: "POST", body: form })
      refreshReceipts()
      return true
    } catch (error) {
      setReceiptError(getApiErrorMessage(error, "Unable to upload the receipt."))
      return false
    } finally {
      setUploading(false)
    }
  }
  const replaceReceipt = async (target: ReceiptFile, file: File) => {
    if (!(await uploadReceipt(file))) return
    try {
      await apiFetch(`/api/attachments/${target.id}`, { method: "DELETE" })
    } catch (error) {
      setReceiptError(getApiErrorMessage(error, "The new file was added, but the old one could not be removed."))
    }
    refreshReceipts()
  }
  const removeReceipt = async (target: ReceiptFile) => {
    if (!(await confirmDialog({ title: "Remove this receipt?", description: target.name, confirmLabel: "Remove" }))) return
    setReceiptError(null)
    try {
      await apiFetch(`/api/attachments/${target.id}`, { method: "DELETE" })
    } catch (error) {
      setReceiptError(getApiErrorMessage(error, "Unable to remove the receipt."))
      return
    }
    refreshReceipts()
  }

  const removeAllocation = async (allocationId: number) => {
    if (!(await confirmDialog({ title: "Remove this reimbursement allocation?", confirmLabel: "Remove" }))) return
    setActionError(null)
    try {
      await apiFetch(`/api/reimbursements/allocations/${allocationId}`, { method: "DELETE" })
    } catch (error) {
      setActionError(getApiErrorMessage(error, "Unable to remove the allocation."))
      return
    }
    invalidateTransactionData(queryClient)
  }

  // Moves the transaction to Trash; the toast offers Undo. Returns whether it was deleted.
  const deleteRecord = async (): Promise<boolean> => {
    if (!(await confirmDialog({ title: "Delete this transaction?" }))) return false
    setActionError(null)
    try {
      await apiFetch(`/api/transactions/${id}`, { method: "DELETE" })
    } catch (error) {
      setActionError(getApiErrorMessage(error, "Unable to delete transaction."))
      return false
    }
    queryClient.removeQueries({ queryKey: key })
    invalidateTransactionData(queryClient)
    void queryClient.invalidateQueries({ queryKey: ["transactions", "deleted"] })
    showToast({
      message: "Moved to Trash",
      action: {
        label: "Undo",
        onClick: () => {
          void apiFetch("/api/transactions/deleted/restore", { method: "POST", body: JSON.stringify({ ids: [id] }) })
            .then(() => invalidateTransactionData(queryClient))
            .catch((error) => showToast({ message: getApiErrorMessage(error, "Unable to restore the transaction.") }))
        },
      },
    })
    return true
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/transactions/${id}`)
      showToast({ message: "Link copied" })
    } catch {
      showToast({ message: "Unable to copy the link" })
    }
  }

  return {
    id,
    query: detailQuery,
    view,
    category,
    categories,
    tagOptions: (tagsQuery.data?.tags ?? []).map((tag) => tag.name),
    reimbursements: reimbursementsQuery.data?.mode ? reimbursementsQuery.data : undefined,
    reimbursementsQuery,
    errors,
    setError,
    save,
    saveDurable,
    receipts: { uploading, error: receiptError, upload: uploadReceipt, replace: replaceReceipt, remove: removeReceipt },
    removeAllocation,
    actionError,
    deleteRecord,
    copyLink,
  }
}

export type TransactionRecordState = ReturnType<typeof useTransactionRecord>
