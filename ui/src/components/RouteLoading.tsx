import { useEffect, useState } from "react"

import PageIntro from "./PageIntro"
import { FinancialPanel } from "./product/ProductSurfaces"

const ROUTE_LOADING_DELAY_MS = 250

type RouteLoadingProps = {
  title: string
  label: string
  rows?: number
}

/* Initial route loading keeps the page title and a panel-shaped frame in
   place, so arriving data fills a stable layout instead of replacing a bare
   text line. Skeleton rows are static: cheap to paint and calm on
   Pi-class hosts. Nothing renders (and nothing is announced to screen
   readers) for the first 250ms, so normal fast loads never flash a
   skeleton frame. */
function RouteLoading({ title, label, rows = 4 }: RouteLoadingProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timeout = window.setTimeout(() => setVisible(true), ROUTE_LOADING_DELAY_MS)
    return () => window.clearTimeout(timeout)
  }, [])

  if (!visible) {
    return null
  }

  return (
    <section data-testid="route-loading">
      {/* The status node sits outside the aria-busy subtree: live regions
          inside a busy subtree may never be announced. */}
      <div aria-busy="true" className="space-y-6">
        <PageIntro title={title} />
        <FinancialPanel className="space-y-3 p-5">
          {Array.from({ length: rows }, (_, index) => (
            <div
              key={index}
              className="h-11 rounded-lg bg-faint"
              style={{ width: `${100 - (index % 4) * 9}%` }}
            />
          ))}
        </FinancialPanel>
      </div>
      <p role="status" className="sr-only">
        {label}
      </p>
    </section>
  )
}

export default RouteLoading
