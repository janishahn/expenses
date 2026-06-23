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
