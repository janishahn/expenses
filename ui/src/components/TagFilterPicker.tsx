import { useState } from "react"
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown"
import { TagIcon } from "@phosphor-icons/react/Tag"
import SegmentedControl from "./SegmentedControl"
import { AppButton } from "./ui/product-button"
import { AppCheckbox } from "./ui/product-fields"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu"

export type TagFilterMode = "include" | "exclude"

type TagOption = { id: number; name: string }

type TagFilterPickerProps = {
  tags: TagOption[]
  mode: TagFilterMode
  selectedIds: number[]
  onModeChange: (mode: TagFilterMode, ids: number[]) => void
  onChange: (ids: number[], mode: TagFilterMode) => void
  variant?: "menu" | "list" | "compact"
  className?: string
}

function toggleTag(selectedIds: number[], tagId: number, checked: boolean): number[] {
  if (checked) {
    return Array.from(new Set([...selectedIds, tagId])).sort((left, right) => left - right)
  }
  return selectedIds.filter((id) => id !== tagId)
}

function selectionLabel(
  tags: TagOption[],
  mode: TagFilterMode,
  selectedIds: number[],
): string {
  if (!selectedIds.length) return "All tags"
  const names = selectedIds
    .map((id) => tags.find((tag) => tag.id === id)?.name)
    .filter(Boolean) as string[]
  const prefix = mode === "include" ? "Only" : "Excluding"
  if (names.length === 1) return `${prefix} ${names[0]}`
  return `${prefix} ${names.length} tags`
}

function TagChoices({
  tags,
  mode,
  selectedIds,
  onModeChange,
  onChange,
  menu,
}: Omit<TagFilterPickerProps, "variant" | "className"> & { menu: boolean }) {
  return (
    <>
      {menu ? (
        <div className="border-b border-border p-2">
          <DropdownMenuRadioGroup
            value={mode}
            onValueChange={(value) => onModeChange(value as TagFilterMode, selectedIds)}
            className="grid grid-cols-2 gap-1 rounded-md bg-faint p-1"
            aria-label="Tag filter mode"
          >
            <DropdownMenuRadioItem
              value="include"
              onSelect={(event) => event.preventDefault()}
              className="min-h-9 rounded-[0.625rem] px-2 text-xs font-semibold"
            >
              Only include
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem
              value="exclude"
              onSelect={(event) => event.preventDefault()}
              className="min-h-9 rounded-[0.625rem] px-2 text-xs font-semibold"
            >
              Exclude
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </div>
      ) : (
        <div className="mb-3">
          <SegmentedControl
            value={mode}
            ariaLabel="Tag filter mode"
            equalWidth
            className="w-full [&_.segmented-control-button]:min-h-9 [&_.segmented-control-button]:px-2.5"
            items={[
              { value: "include", label: "Only include" },
              { value: "exclude", label: "Exclude" },
            ]}
            onValueChange={(value) => onModeChange(value, selectedIds)}
          />
        </div>
      )}
      {tags.length ? (
        menu ? (
          <div className="max-h-64 overflow-y-auto p-1">
            {tags.map((tag) => (
              <DropdownMenuCheckboxItem
                key={tag.id}
                checked={selectedIds.includes(tag.id)}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={(checked) =>
                  onChange(toggleTag(selectedIds, tag.id, checked === true), mode)
                }
              >
                {tag.name}
              </DropdownMenuCheckboxItem>
            ))}
          </div>
        ) : (
          <div className="max-h-52 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-surface-hi">
            {tags.map((tag) => (
              <label
                key={tag.id}
                className="flex min-h-11 cursor-pointer items-center gap-3 px-3 text-sm text-text"
              >
                <AppCheckbox
                  checked={selectedIds.includes(tag.id)}
                  onCheckedChange={(checked) =>
                    onChange(toggleTag(selectedIds, tag.id, checked === true), mode)
                  }
                />
                <span className="min-w-0 flex-1 truncate">{tag.name}</span>
              </label>
            ))}
          </div>
        )
      ) : (
        <p className={menu ? "px-3 py-2 text-sm text-muted" : "rounded-lg border border-border bg-surface-hi px-3 py-3 text-sm text-muted"}>
          No tags available
        </p>
      )}
    </>
  )
}

function TagFilterMenu({
  tags,
  mode,
  selectedIds,
  onModeChange,
  onChange,
  compact,
  className = "",
}: Omit<TagFilterPickerProps, "variant"> & { compact: boolean }) {
  const [open, setOpen] = useState(false)
  const [draftMode, setDraftMode] = useState(mode)
  const [draftIds, setDraftIds] = useState(selectedIds)

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) {
      setDraftMode(mode)
      setDraftIds(selectedIds)
    }
  }

  const chooseMode = (nextMode: TagFilterMode, ids: number[]) => {
    setDraftMode(nextMode)
    if (ids.length) onModeChange(nextMode, ids)
  }

  const changeSelection = (ids: number[], selectionMode: TagFilterMode) => {
    setDraftIds(ids)
    onChange(ids, selectionMode)
  }

  const label = selectionLabel(tags, mode, selectedIds)

  return (
    <div className={compact ? className : `min-w-40 space-y-1.5 ${className}`}>
      {!compact ? <span className="block text-xs font-semibold text-muted">Tags</span> : null}
      <DropdownMenu open={open} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>
          {compact ? (
            <AppButton
              type="button"
              tone="ghost"
              aria-label={selectedIds.length ? `Tag filter: ${label}` : "Filter dashboard by tags"}
              title={selectedIds.length ? label : "Filter dashboard by tags"}
              className="relative"
            >
              <TagIcon data-icon="inline-start" className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Tags</span>
              {selectedIds.length ? (
                <span className="grid min-h-4 min-w-4 place-items-center rounded-full bg-accent px-1 font-mono text-[9px] leading-none text-[rgb(var(--accent-contrast))]">
                  {selectedIds.length}
                </span>
              ) : null}
            </AppButton>
          ) : (
            <button
              type="button"
              aria-label={`Tags: ${label}`}
              className="field flex h-12 w-full min-w-0 items-center justify-between gap-3 rounded-lg border border-border bg-surface-hi px-3.5 py-2.5 text-left text-[0.95rem] text-text shadow-[inset_0_1px_0_rgb(var(--surface-highlight)_/_0.06),0_1px_0_rgb(255_255_255_/_0.02)] outline-none hover:border-border-hi focus-visible:border-accent focus-visible:shadow-[inset_0_1px_0_rgb(var(--surface-highlight)_/_0.08),var(--ring-focus)]"
            >
              <span className="min-w-0 flex-1 truncate">{label}</span>
              <CaretDownIcon className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
            </button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 overflow-hidden p-0">
          <TagChoices
            tags={tags}
            mode={draftMode}
            selectedIds={draftIds}
            onModeChange={chooseMode}
            onChange={changeSelection}
            menu
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export default function TagFilterPicker({
  variant = "menu",
  ...props
}: TagFilterPickerProps) {
  if (variant === "list") {
    return (
      <fieldset className={props.className}>
        <legend className="mb-2 text-xs font-semibold text-muted">Tags</legend>
        <TagChoices {...props} menu={false} />
      </fieldset>
    )
  }

  return <TagFilterMenu {...props} compact={variant === "compact"} />
}
