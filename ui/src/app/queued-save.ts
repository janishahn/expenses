import { useEffect, useRef, useState } from "react"
import { apiFetch, getApiErrorMessage } from "./api"

// Saves one record's edits at once with the full PUT body. Saves run one after another, each
// building on the last saved body, so quick edits to different fields do not undo each other.
// Errors are kept per field.
export function useQueuedSave<Source, Payload, Field extends string>({
  url,
  source,
  toPayload,
  onSaved,
}: {
  url: string
  // The record as last loaded; a refetch replaces the saved body.
  source: Source
  toPayload: (source: Source) => Payload
  onSaved: () => void
}) {
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const known = useRef<Payload>(toPayload(source))
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  useEffect(() => {
    known.current = toPayload(source)
  }, [source, toPayload])

  const setError = (field: Field, message: string | null) =>
    setErrors((current) => ({ ...current, [field]: message ?? undefined }))

  const save = (field: Field, changes: Partial<Payload>): Promise<boolean> => {
    setError(field, null)
    const run = queue.current.then(async () => {
      const payload = { ...known.current, ...changes }
      try {
        await apiFetch(url, { method: "PUT", body: JSON.stringify(payload) })
      } catch (failure) {
        setError(field, getApiErrorMessage(failure, "Unable to save the change."))
        return false
      }
      known.current = payload
      onSaved()
      return true
    })
    queue.current = run
    return run
  }
  return { errors, setError, save }
}
