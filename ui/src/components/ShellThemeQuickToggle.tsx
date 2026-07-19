import { MoonIcon } from "@phosphor-icons/react/Moon"
import { SunIcon } from "@phosphor-icons/react/Sun"
import { Button } from "./ui/button"
import { useThemePreference } from "../theme/useThemePreference"

type ShellThemeQuickToggleProps = {
  testId: string
  className?: string
  size?: "desktop" | "mobile"
}

function ShellThemeQuickToggle({
  testId,
  className = "",
  size = "desktop",
}: ShellThemeQuickToggleProps) {
  const { effectiveTheme, setPreference } = useThemePreference()
  const isDark = effectiveTheme === "dark"
  const nextPreference = isDark ? "light" : "dark"
  const sizeClass = "h-11 w-11"
  const iconClass = size === "mobile" ? "h-[18px] w-[18px]" : "h-4 w-4"
  const chromeClass = "rounded-md bg-surface shadow-[var(--shadow-soft)]"

  return (
    <Button
      type="button"
      variant="unstyled"
      size="legacy"
      data-testid={testId}
      data-theme-icon={isDark ? "dark" : "light"}
      aria-label={`Switch to ${nextPreference} theme`}
      onClick={() => setPreference(nextPreference)}
      className={`inline-flex ${sizeClass} ${chromeClass} items-center justify-center text-muted transition hover:bg-surface-hi hover:text-text ${className}`.trim()}
    >
      {isDark ? (
        <MoonIcon weight="fill" className={iconClass} aria-hidden="true" />
      ) : (
        <SunIcon weight="fill" className={iconClass} aria-hidden="true" />
      )}
    </Button>
  )
}

export default ShellThemeQuickToggle
