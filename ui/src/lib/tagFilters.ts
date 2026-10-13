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

// Mirrors the server's parsing of `tags`, `tag` and `exclude_tags`, so filters can be read from the URL before a refetch settles.
export function parseTagIds(params: URLSearchParams, keys: string[]): number[] {
  const parsed: number[] = []
  for (const key of keys) {
    for (const raw of params.getAll(key).flatMap((value) => value.split(","))) {
      const id = Number(raw.trim())
      if (Number.isInteger(id) && id > 0 && !parsed.includes(id)) parsed.push(id)
    }
  }
  return parsed
}
