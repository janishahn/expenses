import { useEffect, useRef, useState } from "react"
import { apiFetch, getApiErrorMessage } from "./api"

type Entered<Payload> = { changes: Partial<Payload>; saved: boolean }

// Saves one record's edits at once with the full PUT body. Saves run one after another, each
// building on the last saved body, so quick edits to different fields do not undo each other.
// Errors are kept per field. `view` is the record with entered values applied: shown while they
// save, kept with the error when they fail, and replaced once the record reloads. Fields whose
// editors keep their own draft stay as stored, so the draft is compared with the stored value.
export function useQueuedSave<Source, Payload extends Partial<Source>, Field extends string>({
  url,
  source,
  toPayload,
  onSaved,
  draftFields = [],
}: {
  url: string
  // The record as last loaded; a refetch replaces the saved body.
  source: Source
  toPayload: (source: Source) => Payload
  onSaved: () => void
  draftFields?: readonly Field[]
}) {
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [entered, setEntered] = useState<ReadonlyMap<Field, Entered<Payload>>>(new Map())
  const known = useRef<Payload>(toPayload(source))
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  useEffect(() => {
    known.current = toPayload(source)
  }, [source, toPayload])
  // A reload shows the saved values itself.
  const [loaded, setLoaded] = useState(source)
  if (loaded !== source) {
    setLoaded(source)
    if ([...entered.values()].some((entry) => entry.saved)) {
      setEntered(new Map([...entered].filter(([, entry]) => !entry.saved)))
    }
  }

  const setError = (field: Field, message: string | null) =>
    setErrors((current) => ({ ...current, [field]: message ?? undefined }))

  const save = (field: Field, changes: Partial<Payload>): Promise<boolean> => {
    const shown = !draftFields.includes(field)
    if (shown) setEntered((current) => new Map(current).set(field, { changes, saved: false }))
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
      // Saves run in order, so this one supersedes an earlier failure of the field.
      setError(field, null)
      if (shown) {
        setEntered((current) =>
          current.get(field)?.changes === changes ? new Map(current).set(field, { changes, saved: true }) : current
        )
      }
      onSaved()
      return true
    })
    queue.current = run
    return run
  }
  const view = [...entered.values()].reduce<Source>((record, entry) => ({ ...record, ...entry.changes }), source)
  return { view, errors, setError, save }
}
