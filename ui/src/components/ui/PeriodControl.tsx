import { useState } from "react"
import { CalendarBlankIcon } from "@phosphor-icons/react/CalendarBlank"
import { CaretLeftIcon } from "@phosphor-icons/react/CaretLeft"
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight"
import clsx from "clsx"
import { Button, IconButton } from "./Button"
import { Dialog } from "./Dialog"
import { Menu, MenuItem, MenuSeparator } from "./Menu"
import {
  DEFAULT_PERIOD_PRESETS,
  periodDates,
  periodLabel,
  samePeriod,
  stepPeriod,
  type PeriodPreset,
  type PeriodSelection,
} from "./period"
import { Popover } from "./Popover"
import { Field, FieldGrid, TextField } from "./TextField"
import s from "./kit.module.css"

type CustomDraft = { start: string; end: string; error: string | null }

// The page period: ‹ label ›. The arrows step by month when the period is one calendar
// month; the label opens the presets and a custom range.
export function PeriodControl({
  value,
  onChange,
  presets = DEFAULT_PERIOD_PRESETS,
}: {
  value: PeriodSelection
  onChange: (next: PeriodSelection) => void
  presets?: PeriodPreset[]
}) {
  const [draft, setDraft] = useState<CustomDraft | null>(null)
  const previous = stepPeriod(value, -1)
  const next = stepPeriod(value, 1)
  const label = periodLabel(value, presets)

  const openCustom = () => {
    const dates = periodDates(value)
    setDraft({ start: dates?.start ?? "", end: dates?.end ?? "", error: null })
  }
  const applyCustom = () => {
    if (!draft) return
    if (!draft.start || !draft.end) {
      setDraft({ ...draft, error: "Select a start and end date." })
      return
    }
    if (draft.end < draft.start) {
      setDraft({ ...draft, error: "End date must be after start date." })
      return
    }
    onChange({ slug: "custom", start: draft.start, end: draft.end })
    setDraft(null)
  }

  return (
    <span role="group" aria-label="Period" className={clsx(s.pill, s.pillStepper)}>
      {previous ? (
        <button type="button" className={s.pillStep} aria-label="Previous month" onClick={() => onChange(previous)}>
          <CaretLeftIcon aria-hidden="true" />
        </button>
      ) : null}
      <Menu
        label="Period"
        align="start"
        trigger={
          <button type="button" className={s.pillInner} aria-label={`Period: ${label}`}>
            <span className={s.pillLabel}>{label}</span>
          </button>
        }
      >
        {presets.map((preset) => (
          <MenuItem
            key={preset.label}
            checked={samePeriod(preset.selection, value)}
            onSelect={() => onChange(preset.selection)}
          >
            {preset.label}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem icon={CalendarBlankIcon} onSelect={openCustom}>
          Custom range…
        </MenuItem>
      </Menu>
      {next ? (
        <button type="button" className={s.pillStep} aria-label="Next month" onClick={() => onChange(next)}>
          <CaretRightIcon aria-hidden="true" />
        </button>
      ) : null}
      <Dialog
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open) setDraft(null)
        }}
        title="Custom range"
        size="narrow"
        footer={
          <>
            <span className={s.sp} />
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={applyCustom}>
              Apply
            </Button>
          </>
        }
      >
        <FieldGrid narrow>
          <Field label="Start" error={draft?.error}>
            <TextField
              type="date"
              value={draft?.start ?? ""}
              onChange={(event) => draft && setDraft({ ...draft, start: event.target.value, error: null })}
            />
          </Field>
          <Field label="End">
            <TextField
              type="date"
              value={draft?.end ?? ""}
              onChange={(event) => draft && setDraft({ ...draft, end: event.target.value, error: null })}
            />
          </Field>
        </FieldGrid>
      </Dialog>
    </span>
  )
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const MONTH_LABEL = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })

function shiftMonth(month: string, delta: number): string {
  const [year, index] = month.split("-").map(Number)
  const date = new Date(Date.UTC(year, index - 1 + delta, 1))
  return date.toISOString().slice(0, 7)
}

// One month (YYYY-MM) for month-scoped pages such as Budgets: ‹ October 2026 › with a month grid.
export function MonthPicker({ value, onChange }: { value: string; onChange: (month: string) => void }) {
  const [year, setYear] = useState(() => Number(value.slice(0, 4)))
  const [valueYear, valueIndex] = value.split("-").map(Number)
  const label = MONTH_LABEL.format(new Date(Date.UTC(valueYear, valueIndex - 1, 1)))
  return (
    <span role="group" aria-label="Month" className={clsx(s.pill, s.pillStepper)}>
      <button type="button" className={s.pillStep} aria-label="Previous month" onClick={() => onChange(shiftMonth(value, -1))}>
        <CaretLeftIcon aria-hidden="true" />
      </button>
      <Popover
        label="Choose month"
        className={s.monthPicker}
        onOpenChange={(open) => {
          if (open) setYear(valueYear)
        }}
        trigger={
          <button type="button" className={s.pillInner} aria-label={`Month: ${label}`}>
            <span className={s.pillLabel}>{label}</span>
          </button>
        }
      >
        {(close) => (
          <>
            <div className={s.mpYear}>
              <IconButton icon={CaretLeftIcon} label="Previous year" size="small" onClick={() => setYear(year - 1)} />
              <span>{year}</span>
              <IconButton icon={CaretRightIcon} label="Next year" size="small" onClick={() => setYear(year + 1)} />
            </div>
            <div className={s.mpGrid}>
              {MONTH_NAMES.map((name, index) => {
                const month = `${year}-${String(index + 1).padStart(2, "0")}`
                return (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={month === value}
                    onClick={() => {
                      onChange(month)
                      close()
                    }}
                  >
                    {name}
                  </button>
                )
              })}
            </div>
          </>
        )}
      </Popover>
      <button type="button" className={s.pillStep} aria-label="Next month" onClick={() => onChange(shiftMonth(value, 1))}>
        <CaretRightIcon aria-hidden="true" />
      </button>
    </span>
  )
}

// One week for week-scoped pages such as the Digest: ‹ 12 – 18 Oct 2026 ›.
export function WeekStepper({ label, onStep }: { label: string; onStep: (direction: -1 | 1) => void }) {
  return (
    <span role="group" aria-label="Week" className={clsx(s.pill, s.pillStepper)}>
      <button type="button" className={s.pillStep} aria-label="Previous week" onClick={() => onStep(-1)}>
        <CaretLeftIcon aria-hidden="true" />
      </button>
      <span className={s.pillInner}>
        <span className={s.pillLabel}>{label}</span>
      </span>
      <button type="button" className={s.pillStep} aria-label="Next week" onClick={() => onStep(1)}>
        <CaretRightIcon aria-hidden="true" />
      </button>
    </span>
  )
}
