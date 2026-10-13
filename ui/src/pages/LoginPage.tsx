import { useState, type FormEvent } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { getApiErrorMessage, getSafeRedirectTarget, useAuth } from "../app/auth"
import { AuthCard } from "../components/ui/Bare"
import { LinkButton } from "../components/ui/Button"
import { Field, FieldGrid, TextField } from "../components/ui/TextField"

function LoginPage() {
  const { login, signupAllowed } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [username, setUsername] = useState(() => searchParams.get("username") || "")
  const [password, setPassword] = useState("")
  const [errorMessage, setErrorMessage] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const redirectTarget = searchParams.get("redirect")
  const signupHref = redirectTarget ? `/signup?redirect=${encodeURIComponent(redirectTarget)}` : "/signup"

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
    <AuthCard
      title="Sign in"
      onSubmit={onSubmit}
      submitLabel={submitting ? "Signing in…" : "Sign in"}
      submitting={submitting}
      error={errorMessage}
      notice={searchParams.get("signup") === "success" ? "Account created. Sign in to continue." : undefined}
      footer={
        signupAllowed ? (
          <LinkButton variant="ghost" to={signupHref}>
            Create account
          </LinkButton>
        ) : null
      }
    >
      <FieldGrid stacked>
        <Field label="Username">
          <TextField value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required autoFocus />
        </Field>
        <Field label="Password">
          <TextField
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>
      </FieldGrid>
    </AuthCard>
  )
}

export default LoginPage
