import { Link } from "react-router-dom"
import PageIntro from "../components/PageIntro"
import { AppButton } from "../components/ui/product-button"
import { AppCard } from "../components/ui/product-card"

function NotFoundPage() {
  return (
    <section className="space-y-4">
      <PageIntro title="Page not found" />
      <AppCard className="max-w-md p-4">
        <p className="text-sm text-muted">Try heading back to your dashboard.</p>
        <AppButton asChild className="mt-3 inline-flex">
          <Link to="/">Back to dashboard</Link>
        </AppButton>
      </AppCard>
    </section>
  )
}

export default NotFoundPage
