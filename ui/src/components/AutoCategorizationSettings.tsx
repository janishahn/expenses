import { useId, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { InfoIcon } from "@phosphor-icons/react/Info"
import { apiFetch, getApiErrorMessage } from "../app/api"
import { FinancialPanel } from "./product/ProductSurfaces"
import { AppButton } from "./ui/product-button"
import { AppNativeSelect, AppSwitch } from "./ui/product-fields"

export type AutoCategorizationSettingsData = {
  enabled: boolean
  threshold: number
  training_status: "untrained" | "training" | "ready" | "insufficient_data" | "failed"
  trained_at: string | null
}

// toPrecision drops float noise such as 0.07 * 100 = 7.000000000000001 without rounding stored values.
const toPercent = (threshold: number) => String(Number((threshold * 100).toPrecision(12)))

const historyRequirement = "60 categorized expenses with titles, in at least two categories"

function describeStatus({ enabled, training_status, trained_at }: AutoCategorizationSettingsData) {
  if (!enabled) return { label: "Off", dot: "bg-border-hi" }
  const previous = trained_at !== null
  switch (training_status) {
    case "ready":
      return null
    case "training":
      return previous
        ? { label: "Active · retraining…", dot: "bg-semantic-green" }
        : { label: "Training…", dot: "bg-accent" }
    case "insufficient_data":
      return previous
        ? { label: "Active · using previous model", dot: "bg-[rgb(var(--warning))]",
            detail: `Not enough history to retrain. Needs ${historyRequirement}.` }
        : { label: "Not enough history", dot: "bg-[rgb(var(--warning))]",
            detail: `Needs ${historyRequirement}.` }
    case "failed":
      return previous
        ? { label: "Active · using previous model", dot: "bg-[rgb(var(--warning))]",
            detail: "Retraining failed. It retries at the next weekly check." }
        : { label: "Training failed", dot: "bg-semantic-red",
            detail: "It retries at the next weekly check." }
    case "untrained":
      return { label: "Waiting for first training", dot: "bg-accent" }
  }
}

export default function AutoCategorizationSettings({ settings, onSaved }: {
  settings: AutoCategorizationSettingsData
  onSaved: (settings: AutoCategorizationSettingsData) => void
}) {
  const id = useId()
  const [draft, setDraft] = useState<{ enabled: boolean; percent: string } | null>(null)
  const [saved, setSaved] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const savedPercent = toPercent(settings.threshold)
  const enabled = draft?.enabled ?? settings.enabled
  const percent = draft?.percent ?? savedPercent
  // An unchanged selection preserves the stored threshold's precision.
  const thresholdChanged = percent !== savedPercent
  const dirty = enabled !== settings.enabled || thresholdChanged
  const mutation = useMutation({
    mutationFn: () => apiFetch<AutoCategorizationSettingsData>("/api/settings/auto-categorization", {
      method: "PUT",
      body: JSON.stringify({
        enabled,
        threshold: thresholdChanged ? Number(percent) / 100 : settings.threshold,
      }),
    }),
    onSuccess: (result) => {
      onSaved(result)
      setDraft(null)
      setSaved(true)
    },
  })
  const change = (next: { enabled: boolean; percent: string }) => {
    setDraft(next)
    setSaved(false)
    mutation.reset()
  }
  const status = describeStatus(settings)
  const feedback = mutation.error || mutation.isPending ? "" : dirty ? "Unsaved changes" : saved ? "Saved" : ""

  return (
    <FinancialPanel className="p-5" data-testid="auto-categorization-settings">
      <form
        aria-labelledby={`${id}-title`}
        onSubmit={(event) => {
          event.preventDefault()
          mutation.mutate()
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-0.5">
              <h2 id={`${id}-title`} className="font-head text-xl font-bold">Automatic categorization</h2>
              <button
                type="button"
                aria-label="How automatic categorization works"
                aria-expanded={helpOpen}
                aria-controls={`${id}-help`}
                onClick={() => setHelpOpen((open) => !open)}
                className="-my-2 inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:text-text aria-expanded:text-text"
              >
                <InfoIcon aria-hidden="true" className="size-5" />
              </button>
            </div>
            <div aria-live="polite" className="text-sm text-muted">
              {status && <>
                <p className="flex items-center gap-2">
                  <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${status.dot}`} />
                  {status.label}
                </p>
                {status.detail && <p className="mt-1">{status.detail}</p>}
              </>}
            </div>
          </div>
          <AppSwitch
            className="mt-2"
            aria-labelledby={`${id}-title`}
            checked={enabled}
            disabled={mutation.isPending}
            onCheckedChange={(checked) => change({ enabled: checked, percent })}
          />
        </div>

        <div id={`${id}-help`} hidden={!helpOpen} className="mt-3 max-w-prose space-y-2 text-sm text-muted">
          <p>
            Fills in a category for new expenses that are still uncategorized after your rules, when the model
            is at least as confident as your minimum. A higher minimum leaves more expenses uncategorized.
            Categories you choose are never changed.
          </p>
          <p>
            Training runs on this server when you turn it on, then weekly when your history changes. It needs{" "}
            {historyRequirement}.
          </p>
        </div>

        <div className="mt-4 flex items-center justify-between gap-4 border-t border-border pt-4">
          <div className="min-w-0">
            <label htmlFor={`${id}-threshold`} className="text-sm font-semibold">
              Minimum confidence<span className="sr-only"> in percent</span>
            </label>
            <p id={`${id}-hint`} className="text-xs text-muted">Recommended: 80%</p>
          </div>
          <AppNativeSelect
            id={`${id}-threshold`}
            value={percent}
            disabled={mutation.isPending}
            aria-describedby={`${id}-hint`}
            className="min-h-11 w-28 shrink-0 tabular-nums"
            onChange={(event) => change({ enabled, percent: event.target.value })}
          >
            {!Number.isInteger(Number(savedPercent)) && <option value={savedPercent}>{savedPercent}%</option>}
            {Array.from({ length: 101 }, (_, value) => <option key={value} value={value}>{value}%</option>)}
          </AppNativeSelect>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <AppButton type="submit" disabled={mutation.isPending || !dirty}>
            {mutation.isPending ? "Saving…" : "Save"}
          </AppButton>
          <p role="status" className={`text-sm ${saved && !dirty ? "font-semibold text-semantic-green" : "text-muted"}`}>
            {feedback}
          </p>
          {mutation.error && (
            <p role="alert" className="basis-full text-sm text-semantic-red">
              {getApiErrorMessage(mutation.error, "Unable to save automatic categorization.")}
            </p>
          )}
        </div>
      </form>
    </FinancialPanel>
  )
}
