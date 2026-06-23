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
  const sizeClass = size === "mobile" ? "h-10 w-10" : "h-8 w-8"
  const iconClass = size === "mobile" ? "h-[18px] w-[18px]" : "h-4 w-4"
  const chromeClass =
    size === "mobile"
      ? "rounded-full bg-surface-hi/80 shadow-[0_16px_30px_-24px_rgba(0,0,0,0.82)]"
      : "rounded-[1rem] bg-surface/92 shadow-[var(--shadow-soft)] backdrop-blur-xl"

  return (
    <Button
      type="button"
      variant="unstyled"
      size="legacy"
      data-testid={testId}
      data-theme-icon={isDark ? "dark" : "light"}
      aria-label={`Switch to ${nextPreference} theme`}
      onClick={() => setPreference(nextPreference)}
      className={`inline-flex ${sizeClass} ${chromeClass} items-center justify-center border border-border/80 text-muted transition hover:border-border-hi hover:text-text ${className}`.trim()}
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
