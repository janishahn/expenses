import { Suspense, lazy, useState } from "react"
import { PlusIcon } from "@phosphor-icons/react/Plus"
import { useQuery } from "@tanstack/react-query"
import { Outlet, useLocation, useNavigate } from "react-router-dom"
import { AppFrame } from "../components/ui/AppFrame"
import { apiFetch } from "./api"
import { useAuth } from "./auth"

const AddTransactionSheet = lazy(() => import("./AddTransactionSheet"))

export type AppShellOutletContext = {
  openAddTransaction: () => void
  setUtilityAction: (action: AppShellUtilityAction | null) => void
  utilityAction: AppShellUtilityAction | null
}

export type AppShellUtilityAction = {
  label: string
  onClick: () => void
  icon?: typeof PlusIcon
  presentation?: "primary" | "quiet"
}

function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, llmEnabled, logout } = useAuth()
  const [addTransactionOpen, setAddTransactionOpen] = useState(false)
  // Stays mounted after the first open so the dialog's exit animation can
  // play; Radix only animates content that is still in the tree on close.
  const [addTransactionMounted, setAddTransactionMounted] = useState(false)
  const openAddTransaction = () => {
    setAddTransactionMounted(true)
    setAddTransactionOpen(true)
  }
  const [utilityAction, setUtilityAction] = useState<AppShellUtilityAction | null>(null)

  const uncategorizedQuery = useQuery({
    queryKey: ["transactions", "uncategorized", "count"],
    queryFn: () => apiFetch<{ total: number }>("/api/transactions/uncategorized?period=all&limit=1"),
  })

  const addTransactionAvailable =
    location.pathname === "/" || location.pathname === "/transactions"
  const activeUtilityAction =
    utilityAction ??
    (addTransactionAvailable ? { label: "Add transaction", onClick: openAddTransaction } : null)

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
      <Outlet
        context={{
          openAddTransaction,
          setUtilityAction,
          utilityAction: activeUtilityAction,
        }}
      />
      {addTransactionMounted ? (
        <Suspense fallback={null}>
          <AddTransactionSheet
            open={addTransactionOpen}
            onClose={() => setAddTransactionOpen(false)}
          />
        </Suspense>
      ) : null}
    </AppFrame>
  )
}

export default AppShell
