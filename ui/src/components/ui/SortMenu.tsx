import { useState } from "react"
import { ArrowDownIcon } from "@phosphor-icons/react/ArrowDown"
import { ArrowUpIcon } from "@phosphor-icons/react/ArrowUp"
import { Menu, MenuItem, MenuSeparator } from "./Menu"
import { Pill } from "./Pill"

export type SortDirection = "asc" | "desc"

export type SortKey<K extends string> = {
  key: K
  label: string
  // Direction names for this key, e.g. ["Lowest first", "Highest first"] for amounts.
  directions: { asc: string; desc: string }
  // Direction used the first time the key is chosen.
  defaultDirection: SortDirection
}

// Keys first, then two direction items named for the active key. Each key keeps its own
// direction. The pill shows the key and a direction arrow.
export function SortMenu<K extends string>({
  keys,
  value,
  direction,
  onChange,
}: {
  keys: ReadonlyArray<SortKey<K>>
  value: K
  direction: SortDirection
  onChange: (key: K, direction: SortDirection) => void
}) {
  const active = keys.find((item) => item.key === value) ?? keys[0]
  const [remembered, setRemembered] = useState<Partial<Record<K, SortDirection>>>({})
  const choose = (key: K, nextDirection: SortDirection) => {
    setRemembered((current) => ({ ...current, [value]: direction, [key]: nextDirection }))
    onChange(key, nextDirection)
  }
  const DirectionIcon = direction === "asc" ? ArrowUpIcon : ArrowDownIcon
  return (
    <Menu
      label="Sort"
      trigger={
        <Pill icon={DirectionIcon} aria-label={`Sort by ${active.label}, ${active.directions[direction]}`}>
          {active.label}
        </Pill>
      }
    >
      {keys.map((item) => (
        <MenuItem key={item.key} checked={item.key === value} onSelect={() => choose(item.key, item.key === value ? direction : remembered[item.key] ?? item.defaultDirection)}>
          {item.label}
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem checked={direction === "asc"} onSelect={() => choose(value, "asc")}>
        {active.directions.asc}
      </MenuItem>
      <MenuItem checked={direction === "desc"} onSelect={() => choose(value, "desc")}>
        {active.directions.desc}
      </MenuItem>
    </Menu>
  )
}
