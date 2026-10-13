import { useEffect, useSyncExternalStore } from "react"

const DESKTOP_QUERY = "(min-width: 861px)"

function subscribeDesktop(notify: () => void) {
  const media = window.matchMedia(DESKTOP_QUERY)
  media.addEventListener("change", notify)
  return () => media.removeEventListener("change", notify)
}

export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true
  )
}

// Mobile allows one bottom-anchored layer at a time: while a sheet or the bulk
// bar shows, the tab bar hides. Layers register here while they are visible.
let bottomLayers = 0
const layerSubscribers = new Set<() => void>()

function subscribeLayers(notify: () => void) {
  layerSubscribers.add(notify)
  return () => layerSubscribers.delete(notify)
}

export function useBottomLayerActive(): boolean {
  return useSyncExternalStore(subscribeLayers, () => bottomLayers > 0, () => false)
}

export function useBottomLayer(active: boolean) {
  useEffect(() => {
    if (!active) return
    bottomLayers += 1
    layerSubscribers.forEach((notify) => notify())
    return () => {
      bottomLayers -= 1
      layerSubscribers.forEach((notify) => notify())
    }
  }, [active])
}
