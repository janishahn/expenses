import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { apiFetch, getApiErrorMessage } from "../app/api"
import { FinancialPanel } from "./product/ProductSurfaces"
import { AppButton } from "./ui/product-button"
import { AppFieldLabel, AppInput } from "./ui/product-fields"

export type AutoCategorizationSettingsData = {
  enabled: boolean
  threshold: number
  training_status: "untrained" | "training" | "ready" | "insufficient_data" | "failed"
  trained_at: string | null
}

export default function AutoCategorizationSettings({ settings, onSaved }: {
  settings: AutoCategorizationSettingsData
  onSaved: (settings: AutoCategorizationSettingsData) => void
}) {
  const [draft, setDraft] = useState<{ enabled: boolean; threshold: string } | null>(null)
  const [saved, setSaved] = useState(false)
  const enabled = draft?.enabled ?? settings.enabled
  const threshold = draft?.threshold ?? String(settings.threshold)
  const mutation = useMutation({
    mutationFn: () => apiFetch<AutoCategorizationSettingsData>("/api/settings/auto-categorization", {
      method: "PUT",
      body: JSON.stringify({ enabled, threshold: Number(threshold) }),
    }),
    onSuccess: (result) => {
      onSaved(result)
      setDraft(null)
      setSaved(true)
    },
  })
  const status = {
    untrained: "Enable to train from your categorized expenses.",
    training: settings.trained_at ? "Updating your model. The previous model is still available." : "Training your model…",
    ready: "Model ready. Checks for new training data run weekly.",
    insufficient_data: "Training needs at least 60 categorized expenses across two categories, with titles.",
    failed: "Training failed. It will retry at the next weekly check.",
  }[settings.training_status]

  return (
    <FinancialPanel className="p-5" data-testid="auto-categorization-settings">
      <h2 className="font-head text-xl font-bold">Automatic categorization</h2>
      <p className="mt-2 text-sm text-muted">
        Learn from your categorized expenses on this server. Your chosen categories and deterministic rules always take priority.
      </p>
      <form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); mutation.mutate() }}>
        <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
          <input type="checkbox" checked={enabled} disabled={mutation.isPending}
            onChange={(event) => { setDraft({ enabled: event.target.checked, threshold }); setSaved(false) }} />
          Enable automatic categorization
        </label>
        <AppFieldLabel>
          Confidence threshold
          <AppInput type="number" min="0" max="1" step="0.01" required value={threshold}
            disabled={mutation.isPending} className="mt-1 max-w-40" inputMode="decimal"
            onChange={(event) => { setDraft({ enabled, threshold: event.target.value }); setSaved(false) }} />
        </AppFieldLabel>
        <p className="text-sm text-muted">Recommended: 0.80. Higher values leave more expenses uncategorized. Confidence is an estimate.</p>
        <AppButton type="submit" disabled={mutation.isPending || draft === null}>
          {mutation.isPending ? "Saving…" : "Save categorization settings"}
        </AppButton>
        {mutation.error && <p role="alert" className="text-sm text-semantic-red">{getApiErrorMessage(mutation.error, "Unable to save settings.")}</p>}
        {saved && <p role="status" className="text-sm text-semantic-green">Categorization settings saved.</p>}
      </form>
      <p className="mt-3 text-sm text-muted" aria-live="polite">{settings.enabled ? status : "Automatic categorization is off."}</p>
      {settings.enabled && settings.trained_at && settings.training_status !== "ready" && settings.training_status !== "training"
        && <p className="mt-1 text-sm text-muted">The previous model is still available.</p>}
    </FinancialPanel>
  )
}
