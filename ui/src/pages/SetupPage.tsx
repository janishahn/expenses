import { useState, type FormEvent } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { getApiErrorMessage, getSafeRedirectTarget, useAuth } from "../app/auth"
import { AppButton } from "../components/ui/product-button"
import { AppCard } from "../components/ui/product-card"
import { AppFieldLabel, AppInput } from "../components/ui/product-fields"

function SetupPage() {
  const { setup, setupTokenRequired } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [setupToken, setSetupToken] = useState("")
  const [errorMessage, setErrorMessage] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const redirectTarget = searchParams.get("redirect")

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrorMessage("")
    setSubmitting(true)
    try {
      await setup({ username, password, setupToken: setupToken.trim() })
      navigate(getSafeRedirectTarget(redirectTarget, "/"), { replace: true })
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, "Unable to complete setup."))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-app-screen flex items-center justify-center px-5 py-8">
      <AppCard className="w-full max-w-md space-y-5 p-5 md:p-6">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            First-time setup
          </p>
          <h1 className="font-head text-2xl font-bold tracking-[-0.045em] text-text">
            Create your admin account
          </h1>
          <p className="text-sm text-muted">
            Set up the first account to unlock the app.
          </p>
        </div>

        <form data-testid="setup-form" className="space-y-3.5" onSubmit={onSubmit}>
          <AppFieldLabel>
            <span>Username</span>
            <AppInput
              data-testid="auth-username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              required
            />
          </AppFieldLabel>

          {setupTokenRequired ? (
            <AppFieldLabel>
              <span>Setup token</span>
              <AppInput
                data-testid="auth-setup-token"
                type="password"
                value={setupToken}
                onChange={(event) => setSetupToken(event.target.value)}
                autoComplete="one-time-code"
                required
              />
            </AppFieldLabel>
          ) : null}

          <AppFieldLabel>
            <span>Password</span>
            <AppInput
              data-testid="auth-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </AppFieldLabel>

          {errorMessage ? (
            <p data-testid="auth-error" className="text-sm text-semantic-red">
              {errorMessage}
            </p>
          ) : null}

          <AppButton
            data-testid="auth-submit"
            type="submit"
            className="w-full justify-center"
            disabled={submitting}
          >
            {submitting ? "Setting up…" : "Create account"}
          </AppButton>
        </form>
      </AppCard>
    </main>
  )
}

export default SetupPage
