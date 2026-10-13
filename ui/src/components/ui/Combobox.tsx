import { useId, useMemo, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react"
import { CheckIcon } from "@phosphor-icons/react/Check"
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass"
import { PlusIcon } from "@phosphor-icons/react/Plus"
import clsx from "clsx"
import { Popover } from "./Popover"
import s from "./kit.module.css"

export type ComboboxOption<T extends string | number> = {
  value: T
  label: string
  // Glyph or swatch before the label.
  leading?: ReactNode
  // Secondary text on the right, such as an amount or a date.
  end?: ReactNode
  group?: string
}

type ComboboxProps<T extends string | number> = {
  trigger: ReactElement
  label: string
  options: ReadonlyArray<ComboboxOption<T>>
  // Single choice closes on pick; multiple choice toggles and stays open.
  selected: ReadonlyArray<T>
  onSelect: (value: T) => void
  multiple?: boolean
  placeholder?: string
  // Offers "Create “query”" when nothing matches exactly.
  onCreate?: (query: string) => void
  // Server-side search: called with the query instead of filtering locally.
  onQueryChange?: (query: string) => void
  emptyText?: string
  align?: "start" | "end"
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function Combobox<T extends string | number>({
  trigger,
  label,
  options,
  selected,
  onSelect,
  multiple = false,
  placeholder = "Search",
  onCreate,
  onQueryChange,
  emptyText = "No matches",
  align = "start",
  open,
  onOpenChange,
}: ComboboxProps<T>) {
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const listId = useId()
  const trimmed = query.trim()
  const filtered = useMemo(() => {
    if (onQueryChange || !trimmed) return options
    const needle = trimmed.toLowerCase()
    return options.filter((option) => option.label.toLowerCase().includes(needle))
  }, [onQueryChange, options, trimmed])
  const canCreate = Boolean(onCreate && trimmed && !options.some((o) => o.label.toLowerCase() === trimmed.toLowerCase()))
  const count = filtered.length + (canCreate ? 1 : 0)

  return (
    <Popover
      trigger={trigger}
      label={label}
      align={align}
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setQuery("")
          setActive(0)
          onQueryChange?.("")
        }
        onOpenChange?.(next)
      }}
      className={s.combo}
    >
      {(close) => {
        const pick = (index: number) => {
          if (index < filtered.length) {
            onSelect(filtered[index].value)
            if (!multiple) close()
          } else if (canCreate) {
            onCreate?.(trimmed)
            setQuery("")
            if (!multiple) close()
          }
        }
        const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault()
            if (!count) return
            setActive((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + count) % count)
          } else if (event.key === "Enter") {
            event.preventDefault()
            if (count) pick(Math.min(active, count - 1))
          }
        }
        let lastGroup: string | undefined
        return (
          <>
            <div className={s.comboQuery}>
              <MagnifyingGlassIcon aria-hidden="true" />
              <input
                autoFocus
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={count ? `${listId}-${Math.min(active, count - 1)}` : undefined}
                aria-label={label}
                placeholder={placeholder}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setActive(0)
                  onQueryChange?.(event.target.value)
                }}
                onKeyDown={onKeyDown}
              />
            </div>
            <div id={listId} role="listbox" aria-label={label} aria-multiselectable={multiple || undefined}>
              {filtered.map((option, index) => {
                const header = option.group && option.group !== lastGroup ? option.group : null
                lastGroup = option.group
                const isSelected = selected.includes(option.value)
                return (
                  <div key={String(option.value)}>
                    {header ? <div className={s.mhead}>{header}</div> : null}
                    <div
                      id={`${listId}-${index}`}
                      role="option"
                      aria-selected={isSelected}
                      data-highlighted={index === active ? "" : undefined}
                      className={s.mi}
                      onMouseMove={() => setActive(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => pick(index)}
                    >
                      {option.leading}
                      <span className={s.cell}>{option.label}</span>
                      {option.end != null ? <span className={s.miEnd}>{option.end}</span> : null}
                      {isSelected ? <CheckIcon aria-hidden="true" className={clsx(s.miCheck, option.end != null && s.miCheckAfter)} /> : null}
                    </div>
                  </div>
                )
              })}
              {canCreate ? (
                <div
                  id={`${listId}-${filtered.length}`}
                  role="option"
                  aria-selected={false}
                  data-highlighted={active === filtered.length ? "" : undefined}
                  className={s.mi}
                  onMouseMove={() => setActive(filtered.length)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(filtered.length)}
                >
                  <PlusIcon aria-hidden="true" />
                  Create “{trimmed}”
                </div>
              ) : null}
              {!count ? <div className={s.mhead}>{emptyText}</div> : null}
            </div>
          </>
        )
      }}
    </Popover>
  )
}
