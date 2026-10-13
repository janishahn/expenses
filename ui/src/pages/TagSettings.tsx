import { useState, type ReactElement, type ReactNode } from "react"
import { ArchiveIcon } from "@phosphor-icons/react/Archive"
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/ArrowCounterClockwise"
import { GitMergeIcon } from "@phosphor-icons/react/GitMerge"
import { TrashIcon } from "@phosphor-icons/react/Trash"
import { formatDateRange } from "../app/format"
import { FormPopover } from "../components/FormPopover"
import { MergeDialog } from "../components/MergeDialog"
import { MenuItem, MenuSeparator } from "../components/ui/Menu"
import { Property, PropertyButton, PropertyList } from "../components/ui/PropertyList"
import { Switch } from "../components/ui/Switch"
import { Field, TextField } from "../components/ui/TextField"
import { type DateRange, type TagField, type TagRecord } from "./tag-record"

type Save = (field: TagField, changes: Partial<Pick<TagRecord, "is_hidden_from_budget" | "is_hidden_from_filters" | "auto_attach_period">>) => Promise<boolean>

export function AutoAddPopover({
  value,
  onSave,
  trigger,
}: {
  value: DateRange | null
  onSave: (next: DateRange | null) => void
  trigger: ReactElement
}) {
  const [draft, setDraft] = useState<DateRange>({ start: "", end: "" })
  const [error, setError] = useState<string | null>(null)
  return (
    <FormPopover
      label="Auto-add"
      error={error}
      extraAction={value ? { label: "Turn off", onClick: () => onSave(null) } : undefined}
      onOpen={() => {
        setDraft(value ?? { start: "", end: "" })
        setError(null)
      }}
      onSubmit={() => {
        if (!draft.start || !draft.end) {
          setError("Choose a start and an end date.")
          return false
        }
        if (draft.end < draft.start) {
          setError("The end must not be before the start.")
          return false
        }
        if (draft.start !== value?.start || draft.end !== value?.end) onSave(draft)
        return true
      }}
      trigger={trigger}
    >
      <Field label="From">
        <TextField type="date" autoFocus value={draft.start} onChange={(event) => setDraft({ ...draft, start: event.target.value })} />
      </Field>
      <Field label="Until">
        <TextField type="date" value={draft.end} onChange={(event) => setDraft({ ...draft, end: event.target.value })} />
      </Field>
    </FormPopover>
  )
}

// Budgets, filter menus, and the auto-add range, saved as they change; `lead` and `children` add rows around them.
export function TagSettingsList({
  tag,
  errors,
  save,
  lead,
  children,
}: {
  tag: TagRecord
  errors: Partial<Record<TagField, string>>
  save: Save
  lead?: ReactNode
  children?: ReactNode
}) {
  return (
    <PropertyList>
      {lead}
      <Property label="Budgets" error={errors.budgets}>
        <Switch
          label="Count in budgets"
          checked={!tag.is_hidden_from_budget}
          onCheckedChange={(checked) => void save("budgets", { is_hidden_from_budget: !checked })}
        />
        {tag.is_hidden_from_budget ? "Excluded" : "Included"}
      </Property>
      <Property label="Filter menus" error={errors.filters}>
        <Switch
          label="Show in filter menus"
          checked={!tag.is_hidden_from_filters}
          onCheckedChange={(checked) => void save("filters", { is_hidden_from_filters: !checked })}
        />
        {tag.is_hidden_from_filters ? "Hidden" : "Shown"}
      </Property>
      <Property label="Auto-add" editable error={errors.auto}>
        <AutoAddPopover
          value={tag.auto_attach_period}
          onSave={(next) => void save("auto", { auto_attach_period: next })}
          trigger={
            <PropertyButton empty={!tag.auto_attach_period}>
              {tag.auto_attach_period ? formatDateRange(tag.auto_attach_period.start, tag.auto_attach_period.end) : "Off"}
            </PropertyButton>
          }
        />
      </Property>
      {children}
    </PropertyList>
  )
}

export function TagMenuItems({
  archived,
  onMerge,
  onArchive,
  onRestore,
  onDelete,
}: {
  archived: boolean
  onMerge: () => void
  onArchive: () => void
  onRestore: () => void
  onDelete: () => void
}) {
  return (
    <>
      {archived ? (
        <MenuItem icon={ArrowCounterClockwiseIcon} onSelect={onRestore}>
          Restore
        </MenuItem>
      ) : (
        <>
          <MenuItem icon={GitMergeIcon} onSelect={onMerge}>
            Merge into…
          </MenuItem>
          <MenuItem icon={ArchiveIcon} onSelect={onArchive}>
            Archive
          </MenuItem>
        </>
      )}
      <MenuSeparator />
      <MenuItem icon={TrashIcon} danger onSelect={onDelete}>
        Delete
      </MenuItem>
    </>
  )
}

export function TagMergeDialog({
  source,
  targets,
  onClose,
  onMerged,
}: {
  source: TagRecord
  targets: TagRecord[]
  onClose: () => void
  onMerged: (target: TagRecord) => void
}) {
  return (
    <MergeDialog
      source={source}
      targets={targets}
      noun="tag"
      errorMessage="Unable to merge tags."
      endpoint="/api/tags/merge"
      body={(targetId) => ({ source_tag_id: source.id, target_tag_id: targetId })}
      invalidate={["tags", "tag", "transactions", "rules", "insights", "dashboard"]}
      renderCounts={(counts) => (
        <>
          <Property label="Transactions">{counts.transaction_links ?? 0}</Property>
          <Property label="Budget rules" empty={!counts.budget_exclude_rules}>
            {counts.budget_exclude_rules ?? 0}
          </Property>
        </>
      )}
      onClose={onClose}
      onMerged={onMerged}
    />
  )
}
