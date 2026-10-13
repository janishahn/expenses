import { useState, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch, getApiErrorMessage } from "../app/api"
import { Button } from "./ui/Button"
import { Dialog } from "./ui/Dialog"
import { PropertyList } from "./ui/PropertyList"
import { Field, FieldError, FieldGrid, Select } from "./ui/TextField"

type Named = { id: number; name: string }
type MergeCounts = Record<string, number>

// Merges a category or tag into another: pick the target, see what moves, then confirm.
export function MergeDialog<T extends Named>({
  source,
  targets,
  noun,
  errorMessage,
  endpoint,
  body,
  invalidate,
  renderCounts,
  onClose,
  onMerged,
}: {
  source: T
  targets: T[]
  // "category" or "tag", for the empty choice.
  noun: string
  errorMessage: string
  // The merge endpoint; its preview lives at `${endpoint}/preview`.
  endpoint: string
  body: (targetId: number) => object
  // Query keys whose data the merge changes.
  invalidate: string[]
  renderCounts: (counts: MergeCounts) => ReactNode
  onClose: () => void
  onMerged: (target: T) => void
}) {
  const queryClient = useQueryClient()
  const [targetId, setTargetId] = useState<number | null>(null)
  const target = targets.find((entry) => entry.id === targetId)
  const preview = useQuery({
    queryKey: [endpoint, "preview", source.id, targetId],
    queryFn: () =>
      apiFetch<{ counts: MergeCounts }>(`${endpoint}/preview`, { method: "POST", body: JSON.stringify(body(targetId ?? 0)) }),
    enabled: targetId !== null,
    retry: 0,
  })
  const merge = useMutation({
    mutationFn: () => apiFetch<{ counts: MergeCounts }>(endpoint, { method: "POST", body: JSON.stringify(body(targetId ?? 0)) }),
    onSuccess: () => {
      for (const key of invalidate) void queryClient.invalidateQueries({ queryKey: [key] })
      if (target) onMerged(target)
    },
  })
  const counts = targetId !== null ? preview.data?.counts : undefined
  const failure = merge.error ?? preview.error
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !merge.isPending) onClose()
      }}
      title={`Merge ${source.name}`}
      size="narrow"
      warning={`${source.name} is archived after the merge.`}
      footer={
        <>
          <Button variant="ghost" disabled={merge.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!counts || merge.isPending} onClick={() => merge.mutate()}>
            {merge.isPending ? "Merging…" : "Merge"}
          </Button>
        </>
      }
    >
      <FieldGrid narrow>
        <Field label="Into">
          <Select autoFocus value={targetId ?? ""} onChange={(event) => setTargetId(event.target.value ? Number(event.target.value) : null)}>
            <option value="">Choose a {noun}</option>
            {targets.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </Select>
        </Field>
      </FieldGrid>
      {counts ? <PropertyList>{renderCounts(counts)}</PropertyList> : null}
      {failure ? <FieldError>{getApiErrorMessage(failure, errorMessage)}</FieldError> : null}
    </Dialog>
  )
}
