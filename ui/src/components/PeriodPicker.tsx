import { useState } from "react"
import { formatEuroDate } from "../app/format"
import SegmentedControl from "./SegmentedControl"
import { AppButton } from "./ui/product-button"
import { AppCard } from "./ui/product-card"
import {
  AppFieldLabel,
  AppInput,
} from "./ui/product-fields"

type PeriodPickerProps = {
  periodSlug: string
  start: string
  end: string
  onSetPreset: (value: "this_month" | "last_month" | "all") => void
  onApplyCustom: (start: string, end: string) => void
}

function PeriodPicker({
  periodSlug,
  start,
  end,
  onSetPreset,
  onApplyCustom,
}: PeriodPickerProps) {
  const [customOpen, setCustomOpen] = useState(periodSlug === "custom")
  const [customStartDraft, setCustomStartDraft] = useState<string | null>(null)
  const [customEndDraft, setCustomEndDraft] = useState<string | null>(null)
  const [customError, setCustomError] = useState("")
  const customStart = customStartDraft ?? start
  const customEnd = customEndDraft ?? end

  const setPreset = (value: "this_month" | "last_month" | "all") => {
    setCustomError("")
    setCustomOpen(false)
    setCustomStartDraft(null)
    setCustomEndDraft(null)
    onSetPreset(value)
  }

  const openCustom = () => {
    setCustomError("")
    setCustomStartDraft(null)
    setCustomEndDraft(null)
    setCustomOpen(true)
  }

  const applyCustom = () => {
    setCustomError("")
    if (!customStart || !customEnd) {
      setCustomError("Select a start and end date.")
      return
    }
    if (customEnd < customStart) {
      setCustomError("End date must be after start date.")
      return
    }
    onApplyCustom(customStart, customEnd)
  }

  return (
    <div className="space-y-3">
      <SegmentedControl
        value={periodSlug}
        ariaLabel="Period"
        className="w-full sm:w-96"
        equalWidth
        items={[
          { value: "this_month", label: "This month" },
          { value: "last_month", label: "Last month" },
          { value: "all", label: "All time" },
          { value: "custom", label: "Custom" },
        ]}
        onValueChange={(value) => {
          if (value === "custom") openCustom()
          else setPreset(value as "this_month" | "last_month" | "all")
        }}
      />

      {customOpen ? (
          <AppCard className="space-y-3 p-4 md:p-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <AppFieldLabel>
                Start date
                <AppInput
                  type="date"
                  value={customStart}
                  onChange={(event) => setCustomStartDraft(event.target.value)}
                  className="mt-1"
                  required
                />
              </AppFieldLabel>
              <AppFieldLabel>
                End date
                <AppInput
                  type="date"
                  value={customEnd}
                  onChange={(event) => setCustomEndDraft(event.target.value)}
                  className="mt-1"
                  required
                />
              </AppFieldLabel>
            </div>
            <p className="text-xs text-muted">
              Period: {formatEuroDate(customStart)} – {formatEuroDate(customEnd)}
            </p>
            {customError ? (
              <p className="text-xs text-semantic-red">{customError}</p>
            ) : null}
            <div className="flex flex-col gap-2 sm:flex-row">
              <AppButton type="button" onClick={applyCustom} className="flex-1">
                Apply custom range
              </AppButton>
              <AppButton
                type="button"
                onClick={() => setCustomOpen(false)}
                tone="ghost"
              >
                Close
              </AppButton>
            </div>
          </AppCard>
      ) : null}
    </div>
  )
}

export default PeriodPicker
