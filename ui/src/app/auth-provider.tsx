import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { apiFetch, resetApiClientState } from "./api"
import {
  AuthContext,
  type AdminElevationState,
  type AuthContextValue,
  type AuthState,
  type AuthUser,
} from "./auth-context"

type AuthBootstrapStatus = {
  setup_required: boolean
  setup_token_required: boolean
  signup_allowed: boolean
  llm_enabled: boolean
  authenticated: boolean
  user: AuthUser | null
}

type AuthIdentity = {
  authenticated: boolean
  user: AuthUser | null
}

type AuthCredentials = {
  username: string
  password: string
  setupToken?: string
}

function toAuthState(
  payload: AuthBootstrapStatus,
  adminElevation: AdminElevationState = "unknown"
): AuthState {
  return {
    ready: true,
    setupRequired: payload.setup_required,
    setupTokenRequired: payload.setup_token_required ?? false,
    signupAllowed: payload.signup_allowed ?? false,
    llmEnabled: payload.llm_enabled ?? false,
    authenticated: payload.authenticated,
    user: payload.user,
    adminElevation,
  }
}

function errorDetail(responseText: string): string {
  if (!responseText.trim()) {
    return ""
  }
  try {
    const payload = JSON.parse(responseText) as { detail?: string }
    return typeof payload.detail === "string" ? payload.detail : responseText
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error
    }
    return responseText
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<AuthState>({
    ready: false,
    setupRequired: true,
    setupTokenRequired: false,
    signupAllowed: false,
    llmEnabled: false,
    authenticated: false,
    user: null,
    adminElevation: "unknown",
  })

  const clearClientState = useCallback(() => {
    resetApiClientState()
    queryClient.clear()
  }, [queryClient])

  const clearAdminClientState = useCallback(() => {
    resetApiClientState()
    queryClient.removeQueries({ queryKey: ["admin"] })
  }, [queryClient])

  const refreshAuthState = useCallback(async () => {
    const payload = await apiFetch<AuthBootstrapStatus>("/api/auth/bootstrap-status")
    setState(toAuthState(payload))
  }, [])

  useEffect(() => {
    let active = true
    void apiFetch<AuthBootstrapStatus>("/api/auth/bootstrap-status")
      .then((payload) => {
        if (!active) {
          return
        }
        setState(toAuthState(payload))
      })
      .catch(() => {
        if (!active) {
          return
        }
        setState((previous) => ({ ...previous, ready: true, adminElevation: "unknown" }))
      })
    return () => {
      active = false
    }
  }, [])

  const setup = useCallback(
    async (credentials: AuthCredentials) => {
      const payload = await apiFetch<AuthIdentity>("/api/auth/setup", {
        method: "POST",
        headers: credentials.setupToken
          ? { "X-Setup-Token": credentials.setupToken }
          : undefined,
        body: JSON.stringify({
          username: credentials.username,
          password: credentials.password,
        }),
      })
      clearClientState()
      await refreshAuthState()
      setState((previous) => ({
        ...previous,
        authenticated: payload.authenticated,
        user: payload.user,
        adminElevation: "unknown",
      }))
    },
    [clearClientState, refreshAuthState]
  )

  const login = useCallback(
    async (credentials: AuthCredentials) => {
      const payload = await apiFetch<AuthIdentity>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(credentials),
      })
      clearClientState()
      await refreshAuthState()
      setState((previous) => ({
        ...previous,
        authenticated: payload.authenticated,
        user: payload.user,
        adminElevation: "unknown",
      }))
    },
    [clearClientState, refreshAuthState]
  )

  const signup = useCallback(
    async (credentials: AuthCredentials) => {
      await apiFetch("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify(credentials),
      })
      await refreshAuthState()
    },
    [refreshAuthState]
  )

  const logout = useCallback(async () => {
    await apiFetch("/api/auth/logout", { method: "POST" })
    clearClientState()
    await refreshAuthState()
  }, [clearClientState, refreshAuthState])

  const ensureAdminElevation = useCallback(
    async (force = false): Promise<AdminElevationState> => {
      if (!state.authenticated || !state.user?.is_admin) {
        setState((previous) => ({ ...previous, adminElevation: "required" }))
        return "required"
      }
      if (!force && state.adminElevation === "elevated") {
        return "elevated"
      }

      const response = await fetch("/api/admin/info")
      if (response.ok) {
        setState((previous) => ({ ...previous, adminElevation: "elevated" }))
        return "elevated"
      }

      const text = await response.text()
      const detail = errorDetail(text)

      if (response.status === 403 && detail.includes("Admin elevation required")) {
        clearAdminClientState()
        setState((previous) => ({ ...previous, adminElevation: "required" }))
        return "required"
      }

      if (response.status === 401) {
        clearClientState()
        setState((previous) => ({
          ...previous,
          ready: true,
          setupRequired: false,
          authenticated: false,
          user: null,
          adminElevation: "unknown",
        }))
        return "required"
      }

      if (response.status === 403 && detail.includes("Admin access required")) {
        setState((previous) => ({ ...previous, adminElevation: "required" }))
        return "required"
      }

      throw new Error(text || `Request failed (${response.status})`)
    },
    [clearAdminClientState, clearClientState, state.adminElevation, state.authenticated, state.user]
  )

  const elevateAdmin = useCallback(
    async (password: string) => {
      await apiFetch("/api/auth/admin-elevation", {
        method: "POST",
        body: JSON.stringify({ password }),
      })
      clearAdminClientState()
      setState((previous) => ({ ...previous, adminElevation: "elevated" }))
    },
    [clearAdminClientState]
  )

  const contextValue = useMemo<AuthContextValue>(
    () => ({
      ...state,
      refreshAuthState,
      setup,
      login,
      signup,
      logout,
      ensureAdminElevation,
      elevateAdmin,
    }),
    [state, refreshAuthState, setup, login, signup, logout, ensureAdminElevation, elevateAdmin]
  )

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
}
