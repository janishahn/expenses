import { useSyncExternalStore } from "react"

// Privacy mode hides amounts on screen but keeps the layout. It is a per-browser preference.
const STORAGE_KEY = "ew.privacy"
const subscribers = new Set<() => void>()

function readStored(): boolean {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    // Browsers that hid amounts with the previous dashboard toggle keep them hidden.
    return stored === null ? window.localStorage.getItem("ew.incognito") === "1" : stored === "on"
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

// Amounts in free text, such as assistant answers: "€1,234.56", "1 234,56 €", "-12 EUR".
const TEXT_AMOUNT =
  /(?:€|\$|\bEUR|\bUSD)\s?[-−]?\d(?:[\d.,\u00a0\u202f ]*\d)?|[-−]?\d(?:[\d.,\u00a0\u202f ]*\d)?\s?(?:€|\$|EUR\b|USD\b)/g

export function maskTextAmounts(text: string): string {
  return text.replace(TEXT_AMOUNT, "••••")
}
