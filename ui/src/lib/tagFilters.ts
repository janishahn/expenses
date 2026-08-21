export function serializeTagIds(ids: number[]): string | null {
  const normalized = Array.from(new Set(ids)).sort((left, right) => left - right)
  return normalized.length ? normalized.join(",") : null
}

export function canonicalizeTagScope(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params)
  if (next.get("exclude_tags")) {
    next.delete("tag")
    next.delete("tags")
  }
  return next
}
