import { useState, type FormEvent } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { getApiErrorMessage, getSafeRedirectTarget, useAuth } from "../app/auth"
import { AppButton } from "../components/ui/product-button"
import { AppCard } from "../components/ui/product-card"
import { AppFieldLabel, AppInput } from "../components/ui/product-fields"

function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [username, setUsername] = useState(() => searchParams.get("username") || "")
  const [password, setPassword] = useState("")
  const [errorMessage, setErrorMessage] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const redirectTarget = searchParams.get("redirect")
  const signupHref = redirectTarget
    ? `/signup?redirect=${encodeURIComponent(redirectTarget)}`
    : "/signup"

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrorMessage("")
    setSubmitting(true)
    try {
      await login({ username, password })
      navigate(getSafeRedirectTarget(redirectTarget, "/"), { replace: true })
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, "Unable to sign in."))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-app-screen flex items-center justify-center px-5 py-8">
      <AppCard className="w-full max-w-md space-y-5 p-5 md:p-6">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Welcome back
          </p>
          <h1 className="font-head text-2xl font-bold tracking-[-0.045em] text-text">
            Sign in
          </h1>
          <p className="text-sm text-muted">
            Continue to your expense workspace.
          </p>
        </div>

        {searchParams.get("signup") === "success" ? (
          <p data-testid="auth-success" className="text-sm text-semantic-green">
            Account created. Sign in to continue.
          </p>
        ) : null}

        <form data-testid="login-form" className="space-y-3.5" onSubmit={onSubmit}>
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
              autoComplete="current-password"
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
            {submitting ? "Signing in…" : "Sign in"}
          </AppButton>
        </form>

        <p className="text-sm text-muted">
          Need an account?{" "}
          <Link className="font-semibold text-accent hover:text-accent-strong" to={signupHref}>
            Sign up
          </Link>
        </p>
      </AppCard>
    </main>
  )
}

export default LoginPage
