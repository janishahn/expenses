import type { FormEvent, ReactNode } from "react"
import { WalletIcon } from "@phosphor-icons/react/Wallet"
import clsx from "clsx"
import { Button } from "./Button"
import { FieldError } from "./TextField"
import s from "./kit.module.css"

// Sign in, setup and the 404 page: no navigation, one centered column on the canvas.
export function BarePage({ children }: { children: ReactNode }) {
  return (
    <div className={clsx(s.frame, s.bare)}>
      <main className={s.bareMain}>{children}</main>
    </div>
  )
}

export function BareBrand() {
  return (
    <div className={s.bareBrand}>
      <WalletIcon aria-hidden="true" />
      Expenses
    </div>
  )
}

// A centered sheet with the app name, the fields, and one ink button.
export function AuthCard({
  title,
  onSubmit,
  submitLabel,
  submitting,
  error,
  notice,
  children,
  footer,
}: {
  title: string
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  submitLabel: string
  submitting: boolean
  error?: string
  // A confirmation from the previous step, such as a created account.
  notice?: string
  // Fields, in a stacked FieldGrid.
  children: ReactNode
  // Under the sheet, such as the switch between signing in and creating an account.
  footer?: ReactNode
}) {
  return (
    <BarePage>
      <div className={s.auth}>
        <BareBrand />
        <form className={clsx(s.card, s.authCard)} onSubmit={onSubmit}>
          <h1 className={s.authTitle}>{title}</h1>
          {notice ? (
            <p role="status" className={s.authNotice}>
              {notice}
            </p>
          ) : null}
          {children}
          {error ? <FieldError>{error}</FieldError> : null}
          <Button type="submit" variant="primary" className={s.authSubmit} disabled={submitting}>
            {submitLabel}
          </Button>
        </form>
        {footer ? <div className={s.authFoot}>{footer}</div> : null}
      </div>
    </BarePage>
  )
}

// A bare page that explains where the user ended up: decorative art, a title, a detail line, one action.
export function BareMessage({ art, title, detail, action }: { art: ReactNode; title: string; detail: string; action: ReactNode }) {
  return (
    <BarePage>
      <div className={s.bareMessage}>
        <BareBrand />
        <div className={s.bareArt} aria-hidden="true">
          {art}
        </div>
        <h1 className={s.authTitle}>{title}</h1>
        <p className={s.barePath}>{detail}</p>
        {action}
      </div>
    </BarePage>
  )
}
