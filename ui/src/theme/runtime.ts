export const THEME_PREFERENCE_STORAGE_KEY = "ew.theme.preference"

export type ThemePreference = "system" | "light" | "dark"
export type EffectiveTheme = "light" | "dark"

export type ThemeState = {
  preference: ThemePreference
  effectiveTheme: EffectiveTheme
}

const THEME_CHROME_DEFAULTS: Record<
  EffectiveTheme,
  { themeColor: string; backgroundColor: string }
> = {
  light: {
    themeColor: "#eeefe9",
    backgroundColor: "rgb(238 239 233)",
  },
  dark: {
    themeColor: "#111511",
    backgroundColor: "rgb(17 21 17)",
  },
}

const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)"
const THEME_META_KEY = "data-ew-theme-color"
const THEME_BACKGROUND_META_KEY = "data-ew-theme-background"

let initialized = false
let state: ThemeState = {
  preference: "system",
  effectiveTheme: "dark",
}
let systemMedia: MediaQueryList | null = null
let cleanupSystemListener: (() => void) | null = null
const subscribers = new Set<(nextState: ThemeState) => void>()

function parsePreference(value: string | null): ThemePreference | null {
  if (value === "system" || value === "light" || value === "dark") {
    return value
  }
  return null
}

function getSystemPreference(): EffectiveTheme {
  if (window.matchMedia(SYSTEM_DARK_QUERY).matches) {
    return "dark"
  }
  return "light"
}

function resolveEffectiveTheme(preference: ThemePreference): EffectiveTheme {
  if (preference === "system") {
    return getSystemPreference()
  }
  return preference
}

function readStoredPreference(): ThemePreference {
  const parsed = parsePreference(
    window.localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)
  )
  return parsed ?? "system"
}

function getThemeChrome(theme: EffectiveTheme): {
  themeColor: string
  backgroundColor: string
} {
  const fallback = THEME_CHROME_DEFAULTS[theme]
  const existing = document.querySelector<HTMLMetaElement>(
    `meta[name="theme-color"][${THEME_META_KEY}="${theme}"]`
  )
  return {
    themeColor: existing?.getAttribute("content") || fallback.themeColor,
    backgroundColor:
      existing?.getAttribute(THEME_BACKGROUND_META_KEY) || fallback.backgroundColor,
  }
}

function getThemeColorMeta(theme: EffectiveTheme): HTMLMetaElement {
  const existing = document.querySelector<HTMLMetaElement>(
    `meta[name="theme-color"][${THEME_META_KEY}="${theme}"]`
  )
  if (existing) {
    if (!existing.hasAttribute(THEME_BACKGROUND_META_KEY)) {
      existing.setAttribute(
        THEME_BACKGROUND_META_KEY,
        THEME_CHROME_DEFAULTS[theme].backgroundColor
      )
    }
    return existing
  }
  const chrome = getThemeChrome(theme)
  const created = document.createElement("meta")
  created.setAttribute("name", "theme-color")
  created.setAttribute(THEME_META_KEY, theme)
  created.setAttribute(THEME_BACKGROUND_META_KEY, chrome.backgroundColor)
  created.setAttribute("content", chrome.themeColor)
  document.head.appendChild(created)
  return created
}

function syncThemeColorMetas(activeTheme: EffectiveTheme): void {
  const activeMeta = getThemeColorMeta(activeTheme)
  const inactiveTheme = activeTheme === "dark" ? "light" : "dark"
  const inactiveMeta = getThemeColorMeta(inactiveTheme)
  const activeChrome = getThemeChrome(activeTheme)
  const inactiveChrome = getThemeChrome(inactiveTheme)

  activeMeta.setAttribute("content", activeChrome.themeColor)
  activeMeta.setAttribute(THEME_BACKGROUND_META_KEY, activeChrome.backgroundColor)
  activeMeta.setAttribute("media", "all")
  inactiveMeta.setAttribute("content", inactiveChrome.themeColor)
  inactiveMeta.setAttribute(
    THEME_BACKGROUND_META_KEY,
    inactiveChrome.backgroundColor
  )
  inactiveMeta.setAttribute("media", "not all")

  if (activeMeta.parentNode) {
    activeMeta.parentNode.appendChild(activeMeta)
  }

  window.requestAnimationFrame(() => {
    activeMeta.setAttribute("media", "all")
    inactiveMeta.setAttribute("media", "not all")
  })
}

function applyThemeToDocument(effectiveTheme: EffectiveTheme): void {
  const chrome = getThemeChrome(effectiveTheme)
  document.documentElement.dataset.theme = effectiveTheme
  document.documentElement.style.colorScheme = effectiveTheme
  document.documentElement.style.backgroundColor = chrome.backgroundColor
  if (document.body) {
    document.body.style.backgroundColor = chrome.backgroundColor
  }
  syncThemeColorMetas(effectiveTheme)
}

function emitThemeState(): void {
  const snapshot = getThemeState()
  subscribers.forEach((subscriber) => subscriber(snapshot))
}

function syncSystemListener(): void {
  cleanupSystemListener?.()
  cleanupSystemListener = null

  if (state.preference !== "system") {
    return
  }

  if (!systemMedia) {
    systemMedia = window.matchMedia(SYSTEM_DARK_QUERY)
  }
  const onSystemSchemeChange = () => {
    if (state.preference !== "system") {
      return
    }
    const nextEffectiveTheme = resolveEffectiveTheme(state.preference)
    if (nextEffectiveTheme === state.effectiveTheme) {
      return
    }
    state = {
      ...state,
      effectiveTheme: nextEffectiveTheme,
    }
    applyThemeToDocument(nextEffectiveTheme)
    emitThemeState()
  }
  systemMedia.addEventListener("change", onSystemSchemeChange)
  cleanupSystemListener = () =>
    systemMedia?.removeEventListener("change", onSystemSchemeChange)
}

function applyThemeState(nextPreference: ThemePreference, persist: boolean): void {
  const nextEffectiveTheme = resolveEffectiveTheme(nextPreference)
  state = {
    preference: nextPreference,
    effectiveTheme: nextEffectiveTheme,
  }

  if (persist) {
    window.localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, nextPreference)
  }

  applyThemeToDocument(nextEffectiveTheme)
  syncSystemListener()
  emitThemeState()
}

function isThemeStateShape(
  value: unknown
): value is { preference: ThemePreference; effectiveTheme: EffectiveTheme } {
  if (!value || typeof value !== "object") {
    return false
  }
  const maybeState = value as Partial<ThemeState>
  return (
    parsePreference(maybeState.preference ?? null) !== null &&
    (maybeState.effectiveTheme === "light" || maybeState.effectiveTheme === "dark")
  )
}

export function initThemeRuntime(): void {
  if (initialized) {
    return
  }
  initialized = true

  const bootstrapState = window.__EW_THEME_BOOTSTRAP__
  if (isThemeStateShape(bootstrapState)) {
    state = {
      preference: bootstrapState.preference,
      effectiveTheme: bootstrapState.effectiveTheme,
    }
  } else {
    const preference = readStoredPreference()
    state = {
      preference,
      effectiveTheme: resolveEffectiveTheme(preference),
    }
  }

  applyThemeToDocument(state.effectiveTheme)
  syncSystemListener()

  window.addEventListener("storage", (event) => {
    if (event.key !== THEME_PREFERENCE_STORAGE_KEY) {
      return
    }
    const nextPreference = parsePreference(event.newValue)
    if (!nextPreference || nextPreference === state.preference) {
      return
    }
    applyThemeState(nextPreference, false)
  })
}

export function getThemeState(): ThemeState {
  return state
}

export function setThemePreference(preference: ThemePreference): void {
  if (preference === state.preference) {
    return
  }
  applyThemeState(preference, true)
}

export function subscribeThemeState(
  callback: (nextState: ThemeState) => void
): () => void {
  subscribers.add(callback)
  return () => {
    subscribers.delete(callback)
  }
}

declare global {
  interface Window {
    __EW_THEME_BOOTSTRAP__?: ThemeState
  }
}
