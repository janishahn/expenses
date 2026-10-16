import type {
  AIUsageSummary,
  AssistantChat,
  AssistantChatSummary,
  AssistantStreamEvent,
} from "./api-types"

let csrfToken: string | null = null
let csrfPromise: Promise<string> | null = null
let csrfFetchedAt: number | null = null
const CSRF_TOKEN_MAX_AGE_MS = 110 * 60 * 1000

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

// Whether the server is down: the last API request got no answer, or a proxy such as
// Tailscale Serve answered 502 or 504 and the server does not answer a probe either. A proxy
// also answers 504 when one slow request times out, and the app sends 502s of its own.
// Any other response, errors included, means the server answered.
const PROXY_DOWN_STATUSES = new Set([502, 504])
const PROBE_PATH = "/api/auth/bootstrap-status"
let serverUnreachable = false
const reachabilityListeners = new Set<() => void>()

function setServerUnreachable(unreachable: boolean): void {
  if (serverUnreachable === unreachable) return
  serverUnreachable = unreachable
  reachabilityListeners.forEach((listener) => listener())
}

export function isServerUnreachable(): boolean {
  return serverUnreachable
}

export function subscribeServerReachability(listener: () => void): () => void {
  reachabilityListeners.add(listener)
  return () => reachabilityListeners.delete(listener)
}

// Asks the server whether it is up. Only whether it answered matters, not what it answered.
export async function serverAnswers(): Promise<boolean> {
  await apiFetch(PROBE_PATH).catch(() => null)
  return !serverUnreachable
}

export function isApiErrorStatus(error: unknown, status: number): boolean {
  return error instanceof ApiError && error.status === status
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  const message =
    error instanceof Error
      ? error.message.trim()
      : typeof error === "string"
        ? error.trim()
        : ""
  if (!message) {
    return fallback
  }
  try {
    const payload: unknown = JSON.parse(message)
    if (!payload || typeof payload !== "object" || !("detail" in payload)) {
      return fallback
    }
    const detail = payload.detail
    if (typeof detail === "string" && detail.trim()) {
      return detail
    }
    if (Array.isArray(detail)) {
      const details = detail
        .map((item) => {
          if (!item || typeof item !== "object" || !("msg" in item)) return null
          const detailMessage = item.msg
          return typeof detailMessage === "string" && detailMessage.trim()
            ? detailMessage.trim()
            : null
        })
        .filter((detail): detail is string => detail !== null)
      if (details.length) {
        return details.join(" ")
      }
    }
    return fallback
  } catch (parseError) {
    if (!(parseError instanceof SyntaxError)) {
      throw parseError
    }
  }
  return message
}

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
    let response: Response
    try {
      response = await fetch(path, { ...init, headers })
    } catch (error) {
      if (error instanceof TypeError) setServerUnreachable(true)
      throw error
    }
    if (!PROXY_DOWN_STATUSES.has(response.status)) setServerUnreachable(false)
    else if (path === PROBE_PATH) setServerUnreachable(true)
    else await serverAnswers()
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
    throw new ApiError(text || `Request failed (${response.status})`, response.status)
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

export function fetchAssistantChats(): Promise<AssistantChatSummary[]> {
  return apiFetch<AssistantChatSummary[]>("/api/assistant/chats")
}

export function fetchAssistantChat(chatId: string): Promise<AssistantChat> {
  return apiFetch<AssistantChat>(`/api/assistant/chats/${chatId}`)
}

async function openAssistantStream(path: string, body: unknown, signal: AbortSignal): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/x-ndjson",
        "X-CSRF-Token": await getCsrfToken(attempt === 1),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
    if (response.ok) {
      return response
    }
    const text = await response.text().catch(() => "")
    if (attempt === 0 && response.status === 400 && text.includes("Invalid CSRF token")) {
      invalidateCsrfToken()
      continue
    }
    throw new Error(streamErrorMessage(text, response.status))
  }
  throw new Error("Request failed due to CSRF token validation")
}

async function* readAssistantStream(response: Response): AsyncGenerator<AssistantStreamEvent> {
  if (!response.body) {
    throw new Error("The Assistant stream returned no body")
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
          yield JSON.parse(line) as AssistantStreamEvent
        }
        newlineIndex = buffer.indexOf("\n")
      }
    }
    const tail = buffer.trim()
    if (tail) {
      yield JSON.parse(tail) as AssistantStreamEvent
    }
  } finally {
    void reader.cancel().catch(() => {})
  }
}

// Sends a message, starting a chat when chatId is null. Aborting the signal stops the answer.
export async function* streamAssistantMessage(
  chatId: string | null,
  message: string,
  signal: AbortSignal
): AsyncGenerator<AssistantStreamEvent> {
  const response = await openAssistantStream("/api/assistant/messages/stream", { chat_id: chatId, message }, signal)
  yield* readAssistantStream(response)
}

// Answers the chat's last message again, replacing its last turn.
export async function* streamAssistantRetry(chatId: string, signal: AbortSignal): AsyncGenerator<AssistantStreamEvent> {
  const response = await openAssistantStream(`/api/assistant/chats/${chatId}/retry/stream`, undefined, signal)
  yield* readAssistantStream(response)
}

// Approves or dismisses a proposed change; the turn then continues.
export async function* streamAssistantDecision(
  chatId: string,
  itemId: string,
  approve: boolean,
  signal: AbortSignal
): AsyncGenerator<AssistantStreamEvent> {
  const response = await openAssistantStream(`/api/assistant/chats/${chatId}/approvals/stream`, { item_id: itemId, approve }, signal)
  yield* readAssistantStream(response)
}
