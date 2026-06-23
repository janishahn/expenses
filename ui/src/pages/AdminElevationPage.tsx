import { useEffect, useState, type FormEvent } from "react"
import { Navigate, useNavigate, useSearchParams } from "react-router-dom"
import { getApiErrorMessage, getSafeRedirectTarget, useAuth } from "../app/auth"
import { AppButton } from "../components/ui/product-button"
import { AppCard } from "../components/ui/product-card"
import { AppFieldLabel, AppInput } from "../components/ui/product-fields"

function toSafeAdminRedirect(raw: string | null): string {
  const target = getSafeRedirectTarget(raw, "/admin")
  return target.startsWith("/admin") ? target : "/admin"
}

function AdminElevationPage() {
  const { user, ensureAdminElevation, elevateAdmin } = useAuth()
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
        if (!active) {
          return
        }
        if (status === "elevated") {
          navigate(redirectTarget, { replace: true })
          return
        }
        setChecking(false)
      })
      .catch(() => {
        if (!active) {
          return
        }
        setChecking(false)
      })
    return () => {
      active = false
    }
  }, [ensureAdminElevation, navigate, redirectTarget])

  if (!user?.is_admin) {
    return <Navigate to="/" replace />
  }

  if (checking) {
    return <div className="text-muted">Checking admin access…</div>
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
    <main className="mx-auto w-full max-w-2xl px-5 py-6 md:py-8" data-testid="admin-elevation-page">
      <AppCard className="space-y-5 p-5 md:p-6">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Admin access
          </p>
          <h1 className="font-head text-2xl font-bold tracking-[-0.045em] text-text">
            Re-enter your password
          </h1>
          <p className="text-sm text-muted">
            Confirm your account password to unlock admin tools for this session.
          </p>
        </div>

        <form data-testid="admin-elevation-form" className="space-y-3.5" onSubmit={onSubmit}>
          <AppFieldLabel>
            <span>Password</span>
            <AppInput
              data-testid="admin-elevation-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </AppFieldLabel>

          {errorMessage ? (
            <p data-testid="admin-elevation-error" className="text-sm text-semantic-red">
              {errorMessage}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <AppButton
              data-testid="admin-elevation-submit"
              type="submit"
              disabled={submitting}
            >
              {submitting ? "Checking…" : "Unlock admin tools"}
            </AppButton>
            <AppButton type="button" tone="ghost" onClick={() => navigate("/", { replace: true })}>
              Cancel
            </AppButton>
          </div>
        </form>
      </AppCard>
    </main>
  )
}

export default AdminElevationPage
