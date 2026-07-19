import { type ThemePreference } from "../theme/runtime"
import { useThemePreference } from "../theme/useThemePreference"
import SegmentedControl from "./SegmentedControl"

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
      <SegmentedControl
        value={preference}
        ariaLabel={groupLabel}
        items={options.map((option) => ({
          ...option,
          ariaLabel: option.label,
        }))}
        onValueChange={setPreference}
      />
    </div>
  )
}

export default ThemePreferenceControl
