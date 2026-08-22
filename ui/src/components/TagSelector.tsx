import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { XIcon } from "@phosphor-icons/react/X"
import { Link } from "react-router-dom"
import { apiFetch } from "../app/api"
import { AppInput } from "./ui/product-fields"

const RECENT_LIMIT = 3
const SEARCH_LIMIT = 8

export type TagAutoAttachPeriod = { start: string; end: string }
export type TagOption = {
  id: number
  name: string
  auto_attach_period: TagAutoAttachPeriod | null
}
export type TagsResponse = { tags: TagOption[] }

type TagSelectorProps = {
  selected: string[]
  onChange: (next: string[]) => void
  scheduled?: string[]
}

function TagSelector({ selected, onChange, scheduled = [] }: TagSelectorProps) {
  const [query, setQuery] = useState("")
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["tags", "all"],
    queryFn: () => apiFetch<TagsResponse>("/api/tags?period=all"),
  })

  const selectedLower = new Set(selected.map((name) => name.toLowerCase()))
  const scheduledLower = new Set(scheduled.map((name) => name.toLowerCase()))

  // Unselected active tags, newest first, so a freshly created one-off (e.g. a
  // trip) surfaces as a recent chip. Already-selected tags — including any that
  // are no longer in the active list (e.g. archived) — show as removable chips.
  const unselected = (data?.tags ?? [])
    .slice()
    .sort((a, b) => b.id - a.id)
    .map((tag) => tag.name)
    .filter((name) => !selectedLower.has(name.toLowerCase()))

  const trimmed = query.trim().toLowerCase()
  const matches = trimmed
    ? unselected.filter((name) => name.toLowerCase().includes(trimmed))
    : unselected
  const suggestions = matches.slice(0, trimmed ? SEARCH_LIMIT : RECENT_LIMIT)
  const moreCount = matches.length - suggestions.length

  const add = (name: string) => {
    onChange([...selected, name])
    setQuery("")
  }
  const remove = (name: string) =>
    onChange(selected.filter((entry) => entry.toLowerCase() !== name.toLowerCase()))

  return (
    <div className="form-label">
      <span>Tags</span>
      {isLoading && !data ? (
        <p className="text-xs font-normal text-muted">Loading tags…</p>
      ) : (
        <div className="space-y-2">
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selected.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => remove(name)}
                  aria-label={`Remove tag ${name}`}
                  className="chip-action inline-flex items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/15 px-3 py-1 text-xs font-semibold text-accent transition hover:border-accent/60">
                    {name}
                    {scheduledLower.has(name.toLowerCase()) ? (
                      <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide">
                        Auto
                      </span>
                    ) : null}
                    <XIcon className="h-3 w-3" />
                  </span>
                </button>
              ))}
            </div>
          )}

          {isError ? (
            <p className="text-xs font-normal text-semantic-red">
              Couldn&apos;t load tags.{" "}
              <button
                type="button"
                className="font-semibold underline underline-offset-2"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                {isFetching ? "Retrying…" : "Retry"}
              </button>
            </p>
          ) : data && data.tags.length === 0 && selected.length === 0 ? (
            <p className="text-xs font-normal text-muted">
              No tags yet.{" "}
              <Link
                to="/tags"
                className="text-accent underline-offset-2 hover:underline"
              >
                Create tags
              </Link>
            </p>
          ) : null}

          {!isError && suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => add(name)}
                  aria-label={`Add tag ${name}`}
                  className="chip-action inline-flex items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="inline-flex items-center rounded-full border border-border bg-surface-hi/70 px-3 py-1 text-xs font-semibold text-muted transition hover:border-border-hi hover:text-text">
                    {name}
                  </span>
                </button>
              ))}
            </div>
          )}

          {!isError && data ? (
            <AppInput
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search tags…"
              className="font-normal"
            />
          ) : null}

          {!isError && trimmed && matches.length === 0 ? (
            <p className="text-xs font-normal text-muted">No tags match “{query}”.</p>
          ) : !isError && !trimmed && moreCount > 0 ? (
            <p className="text-xs font-normal text-muted">
              Search to find {moreCount} more tag{moreCount === 1 ? "" : "s"}.
            </p>
          ) : null}
        </div>
      )}
    </div>
  )
}

export default TagSelector
