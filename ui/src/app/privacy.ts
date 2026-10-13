import { useSyncExternalStore } from "react"

// Privacy mode hides amounts on screen but keeps the layout. It is a per-browser preference.
const STORAGE_KEY = "ew.privacy"
const subscribers = new Set<() => void>()

function readStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "on"
  } catch {
    return false
  }
}

let privacyOn = readStored()

export function setPrivacy(next: boolean) {
  privacyOn = next
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "on" : "off")
  } catch {
    // Storage can be unavailable (private windows); the in-memory value still applies.
  }
  subscribers.forEach((notify) => notify())
}

function subscribe(notify: () => void) {
  subscribers.add(notify)
  return () => subscribers.delete(notify)
}

export function usePrivacy(): boolean {
  return useSyncExternalStore(subscribe, () => privacyOn, () => privacyOn)
}

export function isPrivacyOn(): boolean {
  return privacyOn
}
