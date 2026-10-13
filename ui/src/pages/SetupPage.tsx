import { useState, type FormEvent } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { getApiErrorMessage, getSafeRedirectTarget, useAuth } from "../app/auth"
import { AuthCard } from "../components/ui/Bare"
import { Field, FieldGrid, TextField } from "../components/ui/TextField"

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
    <AuthCard
      title="Create the admin account"
      onSubmit={onSubmit}
      submitLabel={submitting ? "Setting up…" : "Create account"}
      submitting={submitting}
      error={errorMessage}
    >
      <FieldGrid stacked>
        <Field label="Username">
          <TextField value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required autoFocus />
        </Field>
        {setupTokenRequired ? (
          <Field label="Setup token">
            <TextField
              type="password"
              value={setupToken}
              onChange={(event) => setSetupToken(event.target.value)}
              autoComplete="one-time-code"
              required
            />
          </Field>
        ) : null}
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

export default SetupPage
