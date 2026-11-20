import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { IconContext } from "@phosphor-icons/react/dist/lib/context"
import "./index.css"
import "./theme/tokens.css"
import App from "./App"
import { initThemeRuntime } from "./theme/runtime"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
      placeholderData: (previousData: unknown) => previousData,
    },
  },
})

initThemeRuntime()

// Bottom sheets sit on the visible viewport, so an open on-screen keyboard does not cover them.
const visualViewport = window.visualViewport
if (visualViewport) {
  const syncViewport = () => {
    const style = document.documentElement.style
    style.setProperty("--kb", `${Math.max(0, window.innerHeight - visualViewport.height - visualViewport.offsetTop)}px`)
    style.setProperty("--vvh", `${visualViewport.height}px`)
  }
  visualViewport.addEventListener("resize", syncViewport)
  visualViewport.addEventListener("scroll", syncViewport)
  syncViewport()
}

const root = document.getElementById("root")
if (!root) throw new Error("index.html has no #root element.")

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <IconContext.Provider value={{ weight: "regular" }}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </IconContext.Provider>
    </QueryClientProvider>
  </StrictMode>
)
