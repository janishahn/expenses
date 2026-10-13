import { Suspense, lazy, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Outlet, useNavigate } from "react-router-dom"
import { AppFrame } from "../components/ui/AppFrame"
import { apiFetch } from "./api"
import { useAuth } from "./auth"

const AddTransactionDialog = lazy(() => import("./AddTransactionDialog"))

export type AppShellOutletContext = {
  openAddTransaction: () => void
}

function AppShell() {
  const navigate = useNavigate()
  const { user, llmEnabled, logout } = useAuth()
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
      llmEnabled={llmEnabled}
      uncategorizedCount={uncategorizedQuery.data?.total ?? 0}
      onSignOut={() => void signOut()}
    >
      <Outlet context={{ openAddTransaction } satisfies AppShellOutletContext} />
      {addTransactionKey > 0 ? (
        <Suspense fallback={null}>
          <AddTransactionDialog key={addTransactionKey} open={addTransactionOpen} onClose={() => setAddTransactionOpen(false)} />
        </Suspense>
      ) : null}
    </AppFrame>
  )
}

export default AppShell
