import { Link } from "react-router-dom"
import PageIntro from "../components/PageIntro"
import { AppButton } from "../components/legacy-ui/product-button"
import { AppCard } from "../components/legacy-ui/product-card"

function NotFoundPage() {
  return (
    <section className="space-y-4">
      <PageIntro title="Page not found" />
      <AppCard className="max-w-md p-4">
        <AppButton asChild className="inline-flex">
          <Link to="/">Back to dashboard</Link>
        </AppButton>
      </AppCard>
    </section>
  )
}

export default NotFoundPage
