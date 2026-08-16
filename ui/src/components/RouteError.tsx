import { Link } from "react-router-dom"
import PageIntro from "./PageIntro"
import { FinancialPanel } from "./product/ProductSurfaces"
import { AppButton } from "./ui/product-button"

type RouteErrorProps = {
  title: string
  message: string
  retryLabel?: string
  returnHref?: string
  returnLabel?: string
}

function RouteError({
  title,
  message,
  retryLabel = "Retry",
  returnHref,
  returnLabel = "Go back",
}: RouteErrorProps) {
  return (
    <section className="space-y-5 md:space-y-6 desk:space-y-4">
      <PageIntro title={title} />
      <FinancialPanel className="p-5 md:p-6">
        <div className="max-w-xl">
          <h2 className="font-head text-lg font-bold text-text">{message}</h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            {returnHref
              ? "Return to the previous workspace and choose another item."
              : "Check the connection and try loading this page again."}
          </p>
          <div className="mt-4">
            {returnHref ? (
              <AppButton asChild>
                <Link to={returnHref}>{returnLabel}</Link>
              </AppButton>
            ) : (
              <AppButton type="button" onClick={() => window.location.reload()}>
                {retryLabel}
              </AppButton>
            )}
          </div>
        </div>
      </FinancialPanel>
    </section>
  )
}

export default RouteError
