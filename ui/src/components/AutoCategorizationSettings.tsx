import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle"
import { CircleNotchIcon } from "@phosphor-icons/react/CircleNotch"
import { HourglassIcon } from "@phosphor-icons/react/Hourglass"
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle"
import { WarningIcon } from "@phosphor-icons/react/Warning"
import { apiFetch, getApiErrorMessage } from "../app/api"
import { formatShortDate, formatShortDateTime } from "../app/format"
import { Status } from "./ui/EmptyState"
import { SettingRow } from "./ui/SettingsShell"
import { Sheet } from "./ui/Sheet"
import { Switch } from "./ui/Switch"
import { FieldError, TextField } from "./ui/TextField"

export type AutoCategorizationSettingsData = {
  enabled: boolean
  threshold: number
  training_status: "untrained" | "training" | "ready" | "insufficient_data" | "failed"
  trained_at: string | null
  min_history: number
}

// toPrecision drops float noise such as 0.07 * 100 = 7.000000000000001 without rounding stored values.
const toPercent = (threshold: number) => String(Number((threshold * 100).toPrecision(12)))

function TrainingStatus({ settings }: { settings: AutoCategorizationSettingsData }) {
  const { training_status, trained_at, min_history } = settings
  const previous = trained_at ? `using the model from ${formatShortDate(trained_at)}` : null
  switch (training_status) {
    case "ready":
      return (
        <Status icon={CheckCircleIcon} tone="ok">
          {trained_at ? `Active · trained ${formatShortDateTime(trained_at)}` : "Active"}
        </Status>
      )
    case "training":
      return <Status icon={CircleNotchIcon}>{previous ? "Active · retraining" : "Training"}</Status>
    case "insufficient_data":
      return (
        <Status icon={WarningCircleIcon} wrap>
          {previous ? `Not enough history to retrain · ${previous}` : "Not enough history"} · needs {min_history} categorized
          expenses with titles in 2 categories
        </Status>
      )
    case "failed":
      return (
        <Status icon={WarningIcon} tone="bad" wrap>
          {previous ? `Training failed · ${previous}` : "Training failed · retries at the next weekly check"}
        </Status>
      )
    case "untrained":
      return <Status icon={HourglassIcon}>Waiting for the first training</Status>
  }
}

// Both settings save as soon as they change. A failed save keeps the entered threshold next to the error.
export default function AutoCategorizationSettings({
  settings,
  onSaved,
}: {
  settings: AutoCategorizationSettingsData
  onSaved: (settings: AutoCategorizationSettingsData) => void
}) {
  const [percent, setPercent] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  const save = useMutation({
    mutationFn: (payload: { enabled: boolean; threshold: number }) =>
      apiFetch<AutoCategorizationSettingsData>("/api/settings/auto-categorization", {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess: (result) => {
      onSaved(result)
      setPercent(null)
    },
  })
  const savedPercent = toPercent(settings.threshold)
  const value = percent ?? savedPercent
  const enabled = save.isPending ? save.variables.enabled : settings.enabled
  const commitThreshold = () => {
    if (percent === null || percent === savedPercent) return
    if (!/^\d{1,3}$/.test(percent) || Number(percent) > 100) {
      setInvalid(true)
      return
    }
    save.mutate({ enabled: settings.enabled, threshold: Number(percent) / 100 })
  }

  return (
    <Sheet title="Automatic categorization" body="flush">
      <SettingRow label={<label htmlFor="auto-categorization-enabled">Categorize new expenses</label>}>
        <Switch
          id="auto-categorization-enabled"
          checked={enabled}
          disabled={save.isPending}
          onCheckedChange={(checked) => save.mutate({ enabled: checked, threshold: settings.threshold })}
        />
      </SettingRow>
      {settings.enabled ? (
        <SettingRow
          label={
            <span role="status">
              <TrainingStatus settings={settings} />
            </span>
          }
        />
      ) : null}
      <SettingRow label={<label htmlFor="auto-categorization-threshold">Minimum confidence</label>}>
        <TextField
          id="auto-categorization-threshold"
          short
          suffix="%"
          inputMode="numeric"
          value={value}
          invalid={invalid}
          readOnly={save.isPending}
          onChange={(event) => {
            setPercent(event.target.value)
            setInvalid(false)
            save.reset()
          }}
          onBlur={commitThreshold}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitThreshold()
            if (event.key === "Escape" && percent !== null) {
              event.stopPropagation()
              setPercent(null)
              setInvalid(false)
            }
          }}
        />
      </SettingRow>
      {invalid ? <SettingRow label={<FieldError>Enter a whole number from 0 to 100.</FieldError>} /> : null}
      {save.error ? (
        <SettingRow label={<FieldError>{getApiErrorMessage(save.error, "Unable to save automatic categorization.")}</FieldError>} />
      ) : null}
    </Sheet>
  )
}
