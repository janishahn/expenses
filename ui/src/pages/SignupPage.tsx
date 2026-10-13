import { useState, type FormEvent } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { getApiErrorMessage, useAuth } from "../app/auth"
import { AuthCard } from "../components/ui/Bare"
import { LinkButton } from "../components/ui/Button"
import { Field, FieldGrid, TextField } from "../components/ui/TextField"

function SignupPage() {
  const { signup } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [errorMessage, setErrorMessage] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const redirectTarget = searchParams.get("redirect")
  const loginHref = redirectTarget ? `/login?redirect=${encodeURIComponent(redirectTarget)}` : "/login"

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
    <AuthCard
      title="Create account"
      onSubmit={onSubmit}
      submitLabel={submitting ? "Creating account…" : "Create account"}
      submitting={submitting}
      error={errorMessage}
      footer={
        <LinkButton variant="ghost" to={loginHref}>
          Sign in instead
        </LinkButton>
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
            autoComplete="new-password"
            required
          />
        </Field>
      </FieldGrid>
    </AuthCard>
  )
}

export default SignupPage
