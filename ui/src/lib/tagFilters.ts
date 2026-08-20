export function serializeTagIds(ids: number[]): string | null {
  const normalized = Array.from(new Set(ids)).sort((left, right) => left - right)
  return normalized.length ? normalized.join(",") : null
}
