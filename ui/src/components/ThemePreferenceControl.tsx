import { type ThemePreference } from "../theme/runtime"
import { useThemePreference } from "../theme/useThemePreference"
import SegmentedControl from "./SegmentedControl"

type ThemePreferenceControlProps = {
  testId: string
  className?: string
}

const options: Array<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
]

function ThemePreferenceControl({
  testId,
  className = "",
}: ThemePreferenceControlProps) {
  const { preference, setPreference } = useThemePreference()

  return (
    <div data-testid={testId} className={className}>
      <SegmentedControl
        value={preference}
        ariaLabel="Theme mode"
        className="w-full"
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
