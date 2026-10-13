import { useEffect, useState, type FormEvent } from "react"
import { Navigate, useNavigate, useSearchParams } from "react-router-dom"
import { getApiErrorMessage, getSafeRedirectTarget, useAuth } from "../app/auth"
import { Button, LinkButton } from "../components/ui/Button"
import { LoadingBody } from "../components/ui/Panel"
import { LockedCard, SettingsShell } from "../components/ui/SettingsShell"
import { FieldError, TextField } from "../components/ui/TextField"
import { ADMIN_SECTIONS, useSettingsGroups, type AdminSectionKey } from "./settings-nav"

function toSafeAdminRedirect(raw: string | null): string {
  const target = getSafeRedirectTarget(raw, "/admin")
  return target.startsWith("/admin") ? target : "/admin"
}

// The server section the password unlocks, so the section list marks where the admin is going.
function sectionOf(target: string): AdminSectionKey {
  const segment = target.split(/[/?#]/)[2] ?? ""
  if (segment === "import") return "maintenance"
  return ADMIN_SECTIONS.includes(segment as AdminSectionKey) ? (segment as AdminSectionKey) : "health"
}

function AdminElevationPage() {
  const { user, ensureAdminElevation, elevateAdmin } = useAuth()
  const groups = useSettingsGroups()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [password, setPassword] = useState("")
  const [errorMessage, setErrorMessage] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [checking, setChecking] = useState(true)

  const redirectTarget = toSafeAdminRedirect(searchParams.get("redirect"))

  useEffect(() => {
    let active = true
    void ensureAdminElevation()
      .then((status) => {
        if (!active) return
        if (status === "elevated") {
          navigate(redirectTarget, { replace: true })
          return
        }
        setChecking(false)
      })
      .catch(() => {
        if (active) setChecking(false)
      })
    return () => {
      active = false
    }
  }, [ensureAdminElevation, navigate, redirectTarget])

  if (!user?.is_admin) {
    return <Navigate to="/" replace />
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setErrorMessage("")
    try {
      await elevateAdmin(password)
      navigate(redirectTarget, { replace: true })
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, "Unable to elevate admin access."))
    } finally {
      setSubmitting(false)
      setPassword("")
    }
  }

  return (
    <SettingsShell title="Admin" groups={groups} current={sectionOf(redirectTarget)}>
      {checking ? (
        <LoadingBody label="Checking admin access…" />
      ) : (
        <LockedCard
          title="Enter your password"
          onSubmit={onSubmit}
          actions={
            <>
              <LinkButton variant="ghost" to="/settings">
                Cancel
              </LinkButton>
              <Button type="submit" variant="primary" disabled={submitting}>
                {submitting ? "Checking…" : "Unlock"}
              </Button>
            </>
          }
        >
          <TextField
            type="password"
            aria-label="Password"
            placeholder="Password"
            autoComplete="current-password"
            autoFocus
            required
            invalid={Boolean(errorMessage)}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {errorMessage ? <FieldError>{errorMessage}</FieldError> : null}
        </LockedCard>
      )}
    </SettingsShell>
  )
}

export default AdminElevationPage
