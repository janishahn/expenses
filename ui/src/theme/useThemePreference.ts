import { useSyncExternalStore } from "react"
import {
  getThemeState,
  setThemePreference,
  subscribeThemeState,
  type ThemePreference,
} from "./runtime"

type UseThemePreferenceResult = {
  preference: ThemePreference
  effectiveTheme: "light" | "dark"
  setPreference: (preference: ThemePreference) => void
}

export function useThemePreference(): UseThemePreferenceResult {
  const state = useSyncExternalStore(
    subscribeThemeState,
    getThemeState,
    getThemeState
  )

  return {
    preference: state.preference,
    effectiveTheme: state.effectiveTheme,
    setPreference: setThemePreference,
  }
}
