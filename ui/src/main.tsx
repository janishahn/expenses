import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { IconContext } from "@phosphor-icons/react/dist/lib/context"
import "./index.css"
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <IconContext.Provider value={{ weight: "bold" }}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </IconContext.Provider>
    </QueryClientProvider>
  </StrictMode>
)
