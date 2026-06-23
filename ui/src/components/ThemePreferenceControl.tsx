import { type ThemePreference } from "../theme/runtime"
import { useThemePreference } from "../theme/useThemePreference"

type ThemePreferenceControlProps = {
  testId: string
  label: string
  helper?: string
  className?: string
}

const options: Array<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
]

function ThemePreferenceControl({
  testId,
  label,
  helper,
  className = "",
}: ThemePreferenceControlProps) {
  const { preference, setPreference } = useThemePreference()
  const groupLabel = `${label} mode`

  return (
    <div data-testid={testId} className={`space-y-2 ${className}`.trim()}>
      <p className="text-[10px] font-bold uppercase tracking-[1.3px] text-muted">
        {label}
      </p>
      {helper ? <p className="text-xs text-muted">{helper}</p> : null}
      <div className="pill-group" role="group" aria-label={groupLabel}>
        {options.map((option) => {
          return (
            <button
              key={option.value}
              type="button"
              className={`pill-button ${
                preference === option.value ? "pill-button-active" : ""
              }`}
              aria-pressed={preference === option.value}
              aria-label={option.label}
              onClick={() => setPreference(option.value)}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default ThemePreferenceControl
