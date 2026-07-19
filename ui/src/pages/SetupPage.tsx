import { useState, type FormEvent } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { getApiErrorMessage, getSafeRedirectTarget, useAuth } from "../app/auth"
import ProductMark from "../components/ProductMark"
import { AppButton } from "../components/ui/product-button"
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
    <main className="min-h-app-screen flex items-center justify-center bg-bg p-3 sm:p-6">
      <section className="grid w-full max-w-5xl overflow-hidden rounded-xl bg-surface shadow-[var(--shadow-hero)] lg:min-h-[42rem] lg:grid-cols-[minmax(19rem,0.85fr)_minmax(26rem,1.15fr)]">
        <aside className="flex min-h-[13rem] flex-col justify-between bg-[#181d1a] p-6 text-[#fbfcf8] sm:p-8 lg:p-10">
          <div className="flex items-center gap-3">
            <ProductMark />
            <div>
              <p className="font-head text-sm font-bold tracking-[-0.02em]">expenses</p>
              <p className="mono-meta text-[#a7b0a9]">household ledger</p>
            </div>
          </div>
          <div className="mt-8 max-w-sm lg:mt-0">
            <p className="mono-meta uppercase text-[#a7b0a9]">First circuit</p>
            <h2 className="mt-3 font-head text-2xl font-bold tracking-[-0.035em] sm:text-3xl">
              Make this ledger yours.
            </h2>
            <div className="mt-6 grid grid-cols-3 gap-2" aria-hidden="true">
              <span className="h-2 rounded-full bg-[#15936d]" />
              <span className="h-2 rounded-full bg-[#3b4ee8]" />
              <span className="h-2 rounded-full bg-[#edbd35]" />
            </div>
          </div>
          <p className="mt-8 hidden max-w-xs text-xs leading-relaxed text-[#a7b0a9] lg:block">
            The first administrator owns access and system settings for this self-hosted workspace.
          </p>
        </aside>

        <div className="flex items-center justify-center p-5 sm:p-8 lg:p-12">
          <div className="w-full max-w-md space-y-6">
            <div className="space-y-2">
              <p className="mono-meta uppercase text-muted">First-time setup</p>
              <h1 className="font-head text-3xl font-bold tracking-[-0.045em] text-text">
                Create your admin account
              </h1>
              <p className="text-sm text-muted">Set up the first account to unlock the app.</p>
            </div>

            <form data-testid="setup-form" className="space-y-4" onSubmit={onSubmit}>
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
          </div>
        </div>
      </section>
    </main>
  )
}

export default SetupPage
