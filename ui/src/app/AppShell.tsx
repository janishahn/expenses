import { Component, Suspense, lazy, useEffect, useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { Outlet, useLocation, useNavigate } from "react-router-dom"
import { AppFrame } from "../components/ui/AppFrame"
import { navLabel } from "../components/ui/nav"
import { ErrorBody, Panel, PanelLoading } from "../components/ui/Panel"
import { ServerReceipt } from "../components/ui/ServerReceipt"
import { showToast } from "../components/ui/toast-store"
import { apiFetch, serverAnswers } from "./api"
import { useAuth } from "./auth"

const AddTransactionDialog = lazy(() => import("./AddTransactionDialog"))

export type AppShellOutletContext = {
  openAddTransaction: () => void
}

// A page that failed to render, usually because its code could not load: the server is
// down, or an update renamed the files. React keeps a failed lazy import failed, so
// recovering reloads the page. Opening another page clears the failure.
class PageBoundary extends Component<{ pathname: string; children: ReactNode }, { pathname: string; failed: boolean }> {
  state = { pathname: this.props.pathname, failed: false }

  static getDerivedStateFromProps(props: { pathname: string }, state: { pathname: string }) {
    return props.pathname === state.pathname ? null : { pathname: props.pathname, failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? <PageFailed pathname={this.props.pathname} /> : this.props.children
  }
}

function PageFailed({ pathname }: { pathname: string }) {
  const [server, setServer] = useState<"checking" | "unreachable" | "answered">("checking")
  useEffect(() => {
    void serverAnswers().then((answers) => setServer(answers ? "answered" : "unreachable"))
  }, [])

  const title = navLabel(pathname) ?? "Expenses"
  if (server === "checking") return <PanelLoading title={title} label="Loading page…" />
  return (
    <Panel title={title}>
      {server === "unreachable" ? (
        <ServerReceipt onAnswered={() => window.location.reload()} />
      ) : (
        <ErrorBody message="Unable to load this page." />
      )}
    </Panel>
  )
}

// The add form failed to render, usually because its code could not load. React keeps a
// failed lazy import failed, so recovering reloads the page.
class AddTransactionBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    showToast({
      message: "Unable to open the add form.",
      action: { label: "Reload", onClick: () => window.location.reload() },
    })
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

function AppShell() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { user, aiFeatures, logout } = useAuth()
  const [addTransactionOpen, setAddTransactionOpen] = useState(false)
  // Each open mounts a fresh dialog under a new key; the dialog stays mounted after
  // closing so its exit animation can play.
  const [addTransactionKey, setAddTransactionKey] = useState(0)
  const openAddTransaction = () => {
    setAddTransactionKey((key) => key + 1)
    setAddTransactionOpen(true)
  }

  const uncategorizedQuery = useQuery({
    queryKey: ["transactions", "uncategorized", "count"],
    queryFn: () => apiFetch<{ total: number }>("/api/transactions/uncategorized?period=all&limit=1"),
  })

  const signOut = async () => {
    await logout()
    navigate("/login", { replace: true })
  }

  return (
    <AppFrame
      isAdmin={Boolean(user?.is_admin)}
      aiFeatures={aiFeatures}
      uncategorizedCount={uncategorizedQuery.data?.total ?? 0}
      onSignOut={() => void signOut()}
    >
      <PageBoundary pathname={pathname}>
        <Outlet context={{ openAddTransaction } satisfies AppShellOutletContext} />
      </PageBoundary>
      {addTransactionKey > 0 ? (
        <AddTransactionBoundary key={addTransactionKey}>
          <Suspense fallback={null}>
            <AddTransactionDialog open={addTransactionOpen} onClose={() => setAddTransactionOpen(false)} />
          </Suspense>
        </AddTransactionBoundary>
      ) : null}
    </AppFrame>
  )
}

export default AppShell
