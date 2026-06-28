import type {
  AIUsageSummary,
  SpendingChatStreamEvent,
  SpendingChatStreamRequest,
} from "./api-types"

let csrfToken: string | null = null
let csrfPromise: Promise<string> | null = null
let csrfFetchedAt: number | null = null
const CSRF_TOKEN_MAX_AGE_MS = 110 * 60 * 1000

function invalidateCsrfToken(): void {
  csrfToken = null
  csrfFetchedAt = null
}

export function resetApiClientState(): void {
  invalidateCsrfToken()
  csrfPromise = null
}

export async function getCsrfToken(forceRefresh = false): Promise<string> {
  if (forceRefresh) {
    invalidateCsrfToken()
    csrfPromise = null
  }
  if (
    csrfToken &&
    csrfFetchedAt !== null &&
    Date.now() - csrfFetchedAt < CSRF_TOKEN_MAX_AGE_MS
  ) {
    return csrfToken
  }
  if (!csrfPromise) {
    csrfPromise = fetch("/api/csrf")
      .then((response) => {
        if (!response.ok) {
          throw new Error("Failed to fetch CSRF token")
        }
        return response.json() as Promise<{ token: string }>
      })
      .then((payload) => {
        csrfToken = payload.token
        csrfFetchedAt = Date.now()
        return payload.token
      })
      .catch((error) => {
        invalidateCsrfToken()
        throw error
      })
      .finally(() => {
        csrfPromise = null
      })
  }
  return csrfPromise
}

async function apiRequest<T>(
  path: string,
  init: RequestInit,
  parse: (response: Response) => Promise<T>,
  {
    includeCsrfHeader,
    setJsonContentType,
  }: {
    includeCsrfHeader: boolean
    setJsonContentType: boolean
  }
): Promise<T> {
  const maxAttempts = includeCsrfHeader ? 2 : 1
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const headers = new Headers(init.headers)
    if (includeCsrfHeader) {
      headers.set("X-CSRF-Token", await getCsrfToken(attempt === 1))
    }
    if (setJsonContentType && !headers.has("Content-Type") && init.body) {
      headers.set("Content-Type", "application/json")
    }
    const response = await fetch(path, { ...init, headers })
    if (response.ok) {
      return parse(response)
    }
    const text = await response.text()
    if (
      includeCsrfHeader &&
      attempt === 0 &&
      response.status === 400 &&
      text.includes("Invalid CSRF token")
    ) {
      invalidateCsrfToken()
      continue
    }
    throw new Error(text || `Request failed (${response.status})`)
  }
  throw new Error("Request failed due to CSRF token validation")
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const method = (init.method || "GET").toUpperCase()
  return apiRequest(path, init, (response) => response.json() as Promise<T>, {
    includeCsrfHeader: method !== "GET" && method !== "HEAD",
    setJsonContentType: true,
  })
}

export async function apiFetchBlob(
  path: string,
  init: RequestInit = {}
): Promise<{ blob: Blob; filename: string | null }> {
  const method = (init.method || "GET").toUpperCase()
  return apiRequest(
    path,
    init,
    async (response) => {
      const blob = await response.blob()
      const contentDisposition = response.headers.get("Content-Disposition") || ""
      const filenameMatch = contentDisposition.match(/filename="([^"]+)"/)
      return { blob, filename: filenameMatch ? filenameMatch[1] : null }
    },
    {
      includeCsrfHeader: method !== "GET" && method !== "HEAD",
      setJsonContentType: true,
    }
  )
}

export async function apiFetchFormData<T>(
  path: string,
  init: Omit<RequestInit, "body" | "headers"> & { body: FormData }
): Promise<T> {
  return apiRequest(path, init, (response) => response.json() as Promise<T>, {
    includeCsrfHeader: true,
    setJsonContentType: false,
  })
}

export function fetchAIUsageSummary(
  period: AIUsageSummary["period"] = "week"
): Promise<AIUsageSummary> {
  return apiFetch<AIUsageSummary>(
    `/api/ai/usage/summary?feature=spending_chat&period=${period}`
  )
}

function streamErrorMessage(text: string, status: number): string {
  const trimmed = text.trim()
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed) as { detail?: unknown }
      if (typeof parsed.detail === "string" && parsed.detail.trim()) {
        return parsed.detail
      }
    } catch {
      // Non-JSON error body; surface the raw text below.
    }
    return trimmed
  }
  return `Request failed (${status})`
}

async function openSpendingChatStream(
  request: SpendingChatStreamRequest,
  signal: AbortSignal
): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch("/api/ai/spending-chat/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/x-ndjson",
        "X-CSRF-Token": await getCsrfToken(attempt === 1),
      },
      body: JSON.stringify(request),
      signal,
    })
    if (response.ok) {
      return response
    }
    const text = await response.text().catch(() => "")
    if (
      attempt === 0 &&
      response.status === 400 &&
      text.includes("Invalid CSRF token")
    ) {
      invalidateCsrfToken()
      continue
    }
    throw new Error(streamErrorMessage(text, response.status))
  }
  throw new Error("Request failed due to CSRF token validation")
}

export async function* streamSpendingChat(
  request: SpendingChatStreamRequest,
  signal: AbortSignal
): AsyncGenerator<SpendingChatStreamEvent> {
  const response = await openSpendingChatStream(request, signal)
  if (!response.body) {
    throw new Error("Spending chat stream returned no body")
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      buffer += decoder.decode(value, { stream: true })
      let newlineIndex = buffer.indexOf("\n")
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        if (line) {
          yield JSON.parse(line) as SpendingChatStreamEvent
        }
        newlineIndex = buffer.indexOf("\n")
      }
    }
    const tail = buffer.trim()
    if (tail) {
      yield JSON.parse(tail) as SpendingChatStreamEvent
    }
  } finally {
    void reader.cancel().catch(() => {})
  }
}
