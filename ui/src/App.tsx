import { Suspense, lazy, useEffect, useState } from "react"
import {
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useOutletContext,
  useParams,
  useSearchParams,
} from "react-router-dom"
import AppShell, { type AppShellOutletContext } from "./app/AppShell"
import { BareLoading } from "./components/ui/Bare"
import { PanelLoading } from "./components/ui/Panel"
import { AuthProvider, getSafeRedirectTarget, useAuth } from "./app/auth"

const AdminElevationPage = lazy(() => import("./pages/AdminElevationPage"))
const AdminImportPage = lazy(() => import("./pages/AdminImportPage"))
const AdminPage = lazy(() => import("./pages/AdminPage"))
const BudgetsPage = lazy(() => import("./pages/BudgetsPage"))
const CategoriesPage = lazy(() => import("./pages/CategoriesPage"))
const DashboardPage = lazy(() => import("./pages/DashboardPage"))
const DigestPage = lazy(() => import("./pages/DigestPage"))
const LoginPage = lazy(() => import("./pages/LoginPage"))
const DeletedTransactionsPage = lazy(() => import("./pages/DeletedTransactionsPage"))
const InsightsPage = lazy(() => import("./pages/InsightsPage"))
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"))
const ForecastPage = lazy(() => import("./pages/ForecastPage"))
const RecurringOccurrencesPage = lazy(
  () => import("./pages/RecurringOccurrencesPage")
)
const RecurringRulesPage = lazy(() => import("./pages/RecurringRulesPage"))
const ReconciliationPage = lazy(() => import("./pages/ReconciliationPage"))
const ReportBuilderPage = lazy(() => import("./pages/ReportBuilderPage"))
const RulesPage = lazy(() => import("./pages/RulesPage"))
const ScenariosPage = lazy(() => import("./pages/ScenariosPage"))
const SettingsPage = lazy(() => import("./pages/SettingsPage"))
const SetupPage = lazy(() => import("./pages/SetupPage"))
const SignupPage = lazy(() => import("./pages/SignupPage"))
const SpendingAssistantPage = lazy(() => import("./pages/SpendingAssistantPage"))
const TagDetailPage = lazy(() => import("./pages/TagDetailPage"))
const TagsPage = lazy(() => import("./pages/TagsPage"))
const TemplatesPage = lazy(() => import("./pages/TemplatesPage"))
const TransactionDetailPage = lazy(() => import("./pages/TransactionDetailPage"))
const TransactionsPage = lazy(() => import("./pages/TransactionsPage"))
const UncategorizedInboxPage = lazy(
  () => import("./pages/UncategorizedInboxPage")
)

function currentDestination({
  pathname,
  search,
  hash,
}: {
  pathname: string
  search: string
  hash: string
}): string {
  const target = `${pathname}${search}${hash}`
  return target || "/"
}

function toRedirectRoute(path: string, redirectTarget: string): string {
  return `${path}?redirect=${encodeURIComponent(redirectTarget)}`
}

function SetupRoute() {
  const { ready, setupRequired, authenticated } = useAuth()
  const [searchParams] = useSearchParams()

  if (!ready) {
    return <BareLoading />
  }
  if (setupRequired) {
    return <SetupPage />
  }
  if (authenticated) {
    return <Navigate to={getSafeRedirectTarget(searchParams.get("redirect"), "/")} replace />
  }

  const redirectTarget = searchParams.get("redirect")
  if (redirectTarget) {
    return <Navigate to={toRedirectRoute("/login", redirectTarget)} replace />
  }
  return <Navigate to="/login" replace />
}

function PublicAuthRoute({ mode }: { mode: "login" | "signup" }) {
  const { ready, setupRequired, signupAllowed, authenticated } = useAuth()
  const [searchParams] = useSearchParams()

  if (!ready) {
    return <BareLoading />
  }

  const redirectTarget = searchParams.get("redirect")

  if (setupRequired) {
    if (redirectTarget) {
      return <Navigate to={toRedirectRoute("/setup", redirectTarget)} replace />
    }
    return <Navigate to="/setup" replace />
  }

  if (authenticated) {
    return <Navigate to={getSafeRedirectTarget(redirectTarget, "/")} replace />
  }

  if (mode === "signup" && !signupAllowed) {
    return (
      <Navigate
        to={redirectTarget ? toRedirectRoute("/login", redirectTarget) : "/login"}
        replace
      />
    )
  }

  return mode === "login" ? <LoginPage /> : <SignupPage />
}

function ProtectedRoute() {
  const { ready, setupRequired, authenticated } = useAuth()
  const location = useLocation()
  const redirectTarget = currentDestination(location)

  if (!ready) {
    return <BareLoading />
  }

  if (setupRequired) {
    return <Navigate to={toRedirectRoute("/setup", redirectTarget)} replace />
  }

  if (!authenticated) {
    return <Navigate to={toRedirectRoute("/login", redirectTarget)} replace />
  }

  return <Outlet />
}

function AdminRoute() {
  const { user, ensureAdminElevation } = useAuth()
  const location = useLocation()
  const outletContext = useOutletContext<AppShellOutletContext>()
  const [checking, setChecking] = useState(true)
  const [requiresElevation, setRequiresElevation] = useState(false)

  useEffect(() => {
    let active = true

    if (!user?.is_admin) {
      return () => {
        active = false
      }
    }

    void ensureAdminElevation(true)
      .then((status) => {
        if (!active) {
          return
        }
        setRequiresElevation(status !== "elevated")
        setChecking(false)
      })
      .catch(() => {
        if (!active) {
          return
        }
        setRequiresElevation(true)
        setChecking(false)
      })

    return () => {
      active = false
    }
  }, [ensureAdminElevation, location.hash, location.pathname, location.search, user?.id, user?.is_admin])

  if (!user?.is_admin) {
    return <Navigate to="/" replace />
  }

  if (checking) {
    return <PanelLoading title="Admin" label="Checking admin access…" />
  }

  if (requiresElevation) {
    return (
      <Navigate
        to={toRedirectRoute("/admin/elevate", currentDestination(location))}
        replace
      />
    )
  }

  return <Outlet context={outletContext} />
}

// The edit page became inline editing in the full view; old links land there.
function TransactionEditRedirect() {
  const { transactionId } = useParams()
  return <Navigate to={`/transactions/${transactionId}`} replace />
}

function AppRoutes() {
  const { aiFeatures } = useAuth()
  return (
    <Routes>
      <Route path="/setup" element={<SetupRoute />} />
      <Route path="/login" element={<PublicAuthRoute mode="login" />} />
      <Route path="/signup" element={<PublicAuthRoute mode="signup" />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/budgets" element={<BudgetsPage />} />
          <Route path="/insights" element={<InsightsPage />} />
          <Route path="/forecast" element={<ForecastPage />} />
          <Route path="/scenarios" element={<ScenariosPage />} />
          <Route path="/recurring" element={<RecurringRulesPage />} />
          <Route path="/recurring/:ruleId/occurrences" element={<RecurringOccurrencesPage />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/rules" element={<RulesPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/tags" element={<TagsPage />} />
          <Route path="/tags/:tagId" element={<TagDetailPage />} />
          <Route path="/digest" element={<DigestPage />} />
          <Route path="/reports/builder" element={<ReportBuilderPage />} />
          <Route path="/transactions/inbox" element={<UncategorizedInboxPage />} />
          <Route path="/transactions/deleted" element={<DeletedTransactionsPage />} />
          <Route path="/transactions/:transactionId" element={<TransactionDetailPage />} />
          <Route path="/transactions/:transactionId/edit" element={<TransactionEditRedirect />} />
          <Route path="/assistant" element={aiFeatures.includes("spending_chat") ? <SpendingAssistantPage /> : <Navigate to="/" replace />} />
          <Route path="/settings/:section?" element={<SettingsPage />} />
          <Route path="/admin/elevate" element={<AdminElevationPage />} />
          <Route element={<AdminRoute />}>
            <Route path="/admin/import" element={<AdminImportPage />} />
            <Route path="/admin/:section?" element={<AdminPage />} />
          </Route>
          <Route path="/reconciliation" element={<ReconciliationPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}

function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<BareLoading />}>
        <AppRoutes />
      </Suspense>
    </AuthProvider>
  )
}

export default App
