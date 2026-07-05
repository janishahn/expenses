import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { XIcon } from "@phosphor-icons/react/X"
import { Link } from "react-router-dom"
import { apiFetch } from "../app/api"
import { AppInput } from "./ui/product-fields"

const RECENT_LIMIT = 3
const SEARCH_LIMIT = 8

type TagOption = { id: number; name: string }
type TagsResponse = { tags: TagOption[] }

type TagSelectorProps = {
  selected: string[]
  onChange: (next: string[]) => void
}

function TagSelector({ selected, onChange }: TagSelectorProps) {
  const [query, setQuery] = useState("")
  const { data, isLoading } = useQuery({
    queryKey: ["tags", "all"],
    queryFn: () => apiFetch<TagsResponse>("/api/tags?period=all"),
  })

  const selectedLower = new Set(selected.map((name) => name.toLowerCase()))

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
      {isLoading ? (
        <p className="text-xs font-normal text-muted">Loading tags…</p>
      ) : data && data.tags.length === 0 && selected.length === 0 ? (
        <p className="text-xs font-normal text-muted">
          No tags yet.{" "}
          <Link to="/tags" className="text-accent underline-offset-2 hover:underline">
            Create tags
          </Link>{" "}
          to organize transactions.
        </p>
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
                  className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/15 px-3 py-1 text-xs font-semibold text-accent transition hover:border-accent/60"
                >
                  {name}
                  <XIcon className="h-3 w-3" />
                </button>
              ))}
            </div>
          )}

          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => add(name)}
                  aria-label={`Add tag ${name}`}
                  className="inline-flex items-center rounded-full border border-border bg-surface-hi/70 px-3 py-1 text-xs font-semibold text-muted transition hover:border-border-hi hover:text-text"
                >
                  {name}
                </button>
              ))}
            </div>
          )}

          <AppInput
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tags…"
            className="font-normal"
          />

          {trimmed && matches.length === 0 ? (
            <p className="text-xs font-normal text-muted">No tags match “{query}”.</p>
          ) : moreCount > 0 ? (
            <p className="text-xs font-normal text-muted">
              {trimmed
                ? "Keep typing to narrow the results."
                : `Search to find ${moreCount} more tag${moreCount === 1 ? "" : "s"}.`}
            </p>
          ) : null}
        </div>
      )}
    </div>
  )
}

export default TagSelector
