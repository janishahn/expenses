import { createContext, useContext } from "react"

export type AuthUser = {
  id: number
  username: string
  is_admin: boolean
}

export type AdminElevationState = "unknown" | "required" | "elevated"

export type AuthState = {
  ready: boolean
  setupRequired: boolean
  signupAllowed: boolean
  authenticated: boolean
  user: AuthUser | null
  adminElevation: AdminElevationState
}

type AuthCredentials = {
  username: string
  password: string
}

export type AuthContextValue = AuthState & {
  refreshAuthState: () => Promise<void>
  setup: (credentials: AuthCredentials) => Promise<void>
  login: (credentials: AuthCredentials) => Promise<void>
  signup: (credentials: AuthCredentials) => Promise<void>
  logout: () => Promise<void>
  ensureAdminElevation: (force?: boolean) => Promise<AdminElevationState>
  elevateAdmin: (password: string) => Promise<void>
}

const AUTH_ROUTE_PATHS = new Set(["/setup", "/login", "/signup"])

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider")
  }
  return context
}

export function getSafeRedirectTarget(rawTarget: string | null, fallback = "/"): string {
  if (!rawTarget || !rawTarget.startsWith("/") || rawTarget.startsWith("//")) {
    return fallback
  }
  try {
    const candidate = new URL(rawTarget, window.location.origin)
    if (candidate.origin !== window.location.origin) {
      return fallback
    }
    if (AUTH_ROUTE_PATHS.has(candidate.pathname)) {
      return fallback
    }
    const value = `${candidate.pathname}${candidate.search}${candidate.hash}`
    return value || fallback
  } catch (error) {
    if (!(error instanceof TypeError)) {
      throw error
    }
    return fallback
  }
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    try {
      const payload = JSON.parse(error.message) as { detail?: string }
      if (typeof payload.detail === "string" && payload.detail.trim()) {
        return payload.detail
      }
    } catch (parseError) {
      if (!(parseError instanceof SyntaxError)) {
        throw parseError
      }
    }
    if (error.message.trim()) {
      return error.message
    }
  }
  return fallback
}
