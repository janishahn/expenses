import { useState, type FormEvent } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { getApiErrorMessage, useAuth } from "../app/auth"
import { AppButton } from "../components/ui/product-button"
import { AppCard } from "../components/ui/product-card"
import { AppFieldLabel, AppInput } from "../components/ui/product-fields"

function SignupPage() {
  const { signup } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [errorMessage, setErrorMessage] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const redirectTarget = searchParams.get("redirect")
  const loginHref = redirectTarget
    ? `/login?redirect=${encodeURIComponent(redirectTarget)}`
    : "/login"

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrorMessage("")
    setSubmitting(true)
    try {
      await signup({ username, password })
      const nextParams = new URLSearchParams()
      nextParams.set("signup", "success")
      nextParams.set("username", username.trim())
      if (redirectTarget) {
        nextParams.set("redirect", redirectTarget)
      }
      navigate(`/login?${nextParams.toString()}`, { replace: true })
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, "Unable to create account."))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-app-screen flex items-center justify-center px-5 py-8">
      <AppCard className="w-full max-w-md space-y-5 p-5 md:p-6">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            New account
          </p>
          <h1 className="font-head text-2xl font-bold tracking-[-0.045em] text-text">
            Sign up
          </h1>
          <p className="text-sm text-muted">
            Create an ordinary user account.
          </p>
        </div>

        <form data-testid="signup-form" className="space-y-3.5" onSubmit={onSubmit}>
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
            {submitting ? "Creating account…" : "Create account"}
          </AppButton>
        </form>

        <div className="space-y-3.5">
          <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
          <AppButton
            data-testid="auth-switch-to-login"
            type="button"
            tone="ghost"
            className="w-full justify-center"
            onClick={() => navigate(loginHref)}
          >
            I already have an account
          </AppButton>
        </div>
      </AppCard>
    </main>
  )
}

export default SignupPage
