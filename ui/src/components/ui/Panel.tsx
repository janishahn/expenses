import { Fragment, useCallback, useState, useSyncExternalStore, type ReactNode } from "react"
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight"
import { useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import clsx from "clsx"
import { isServerUnreachable, subscribeServerReachability } from "../../app/api"
import { Button, LinkButton } from "./Button"
import { EmptyState } from "./EmptyState"
import { useLoadingDelayElapsed } from "./layout-state"
import { ServerReceipt } from "./ServerReceipt"
import s from "./kit.module.css"

export type Crumb = { label: string; to: string }

// A page: the 44px header bar (title or breadcrumb, contextual actions), an optional
// view row, then content. "scroll" content is a padded grid of cards; "fill" content
// manages its own layout (a list with its peek, the settings shell, the assistant).
export function Panel({
  title,
  parents,
  actions,
  viewRow,
  layout = "scroll",
  peekOpen = false,
  children,
}: {
  title: ReactNode
  // Parent pages before the title, shown as a breadcrumb.
  parents?: Crumb[]
  actions?: ReactNode
  viewRow?: ReactNode
  layout?: "scroll" | "fill"
  // On mobile an open peek replaces the page, including the header bar.
  peekOpen?: boolean
  children: ReactNode
}) {
  return (
    <div className={clsx(s.page, peekOpen && s.peekOpen)}>
      <header className={s.bar}>
        {parents?.length ? (
          <nav aria-label="Breadcrumb" className={s.crumb}>
            {parents.map((crumb) => (
              <Fragment key={crumb.to}>
                <Link to={crumb.to}>{crumb.label}</Link>
                <CaretRightIcon aria-hidden="true" />
              </Fragment>
            ))}
            <h1 tabIndex={-1}>{title}</h1>
          </nav>
        ) : (
          <h1 tabIndex={-1}>{title}</h1>
        )}
        <span className={s.sp} />
        {actions ? <div className={s.barActions}>{actions}</div> : null}
      </header>
      {viewRow}
      {layout === "scroll" ? <div className={s.content}>{children}</div> : children}
    </div>
  )
}

// Left to right: page views, the period control, filter pills; `end` holds Filter and sort.
export function ViewRow({ children, end }: { children?: ReactNode; end?: ReactNode }) {
  return (
    <div className={s.viewrow}>
      {children}
      {end ? <div className={s.viewrowEnd}>{end}</div> : null}
    </div>
  )
}

// A page whose data is still loading: the header at once, placeholder rows only after
// 250 ms so fast loads never flash. The rows are static, which keeps Pi-class hosts calm.
export function PanelLoading({ title, parents, label }: { title: ReactNode; parents?: Crumb[]; label: string }) {
  return (
    <Panel title={title} parents={parents}>
      <LoadingBody label={label} />
    </Panel>
  )
}

// The placeholder rows of a loading page, for parts of a page that load on their own.
export function LoadingBody({ label }: { label: string }) {
  const visible = useLoadingDelayElapsed()
  if (!visible) return null
  return (
    <div data-testid="route-loading">
      <div aria-busy="true" className={clsx(s.card, s.cbody, s.skeleton)}>
        {[100, 91, 82, 73].map((width) => (
          <span key={width} className={s.skel} style={{ width: `${width}%` }} />
        ))}
      </div>
      <p role="status" className="sr-only">
        {label}
      </p>
    </div>
  )
}

// A page whose data failed to load: the reason and one way forward.
export function PanelError({
  title,
  parents,
  message,
  returnTo,
}: {
  title: ReactNode
  parents?: Crumb[]
  message: string
  // Where to go instead of retrying, for records that no longer exist.
  returnTo?: Crumb
}) {
  return (
    <Panel title={title} parents={parents}>
      <ErrorBody message={message} returnTo={returnTo} />
    </Panel>
  )
}

export function ErrorBody({ message, returnTo }: { message: string; returnTo?: Crumb }) {
  const queryClient = useQueryClient()
  const unreachable = useSyncExternalStore(subscribeServerReachability, isServerUnreachable)
  // The receipt stays after the server answers its retries, until the failed loads have run
  // again. If the server is gone again by then, a new receipt starts.
  const [receipt, setReceipt] = useState<number | null>(null)
  if (unreachable && receipt === null) setReceipt(0)
  const reload = useCallback(async () => {
    await queryClient.refetchQueries({ type: "active", predicate: (query) => query.state.status === "error" })
    setReceipt((current) => (isServerUnreachable() && current !== null ? current + 1 : null))
  }, [queryClient])

  if (receipt !== null) return <ServerReceipt key={receipt} onAnswered={reload} />
  return (
    <section className={s.card}>
      <EmptyState
        action={
          returnTo ? (
            <LinkButton to={returnTo.to} variant="quiet">
              {returnTo.label}
            </LinkButton>
          ) : (
            <Button variant="quiet" onClick={() => window.location.reload()}>
              Retry
            </Button>
          )
        }
      >
        <span role="alert">{message}</span>
      </EmptyState>
    </section>
  )
}
