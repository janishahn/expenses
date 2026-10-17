import { useSearchParams } from "react-router-dom"
import type { AIFeature } from "../app/auth-context"

export const FEATURE_NAMES: Record<AIFeature, string> = {
  spending_chat: "Assistant",
  transaction_triage: "Categorization suggestions",
  rule_mining: "Rule suggestions",
}

// One model serving one feature; the URL names it so Back returns to the overview.
export type UsageScope = { feature: AIFeature; backend: string | null; model: string }

export function useUsageScope(): UsageScope | null {
  const [params] = useSearchParams()
  const feature = params.get("feature")
  const model = params.get("model")
  if (!model || !feature || !(feature in FEATURE_NAMES)) return null
  return { feature: feature as AIFeature, backend: params.get("backend"), model }
}

export function usageScopeTitle(scope: UsageScope): string {
  return `${FEATURE_NAMES[scope.feature]} · ${scope.model}`
}
