import { createContext, useContext } from "react"

// Settings and Admin replace the sidebar on desktop with their section list. The
// frame exposes the sidebar element; the settings shell portals into it.
export type FrameSidebar = {
  element: HTMLElement | null
  setOverridden: (overridden: boolean) => void
}

export const FrameSidebarContext = createContext<FrameSidebar>({ element: null, setOverridden: () => {} })

export function useFrameSidebar(): FrameSidebar {
  return useContext(FrameSidebarContext)
}
