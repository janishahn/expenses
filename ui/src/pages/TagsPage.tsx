import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CalendarIcon } from "@phosphor-icons/react/Calendar"
import { FunnelIcon } from "@phosphor-icons/react/Funnel"
import { PlusIcon } from "@phosphor-icons/react/Plus"
import { ProhibitIcon } from "@phosphor-icons/react/Prohibit"
import { TagIcon } from "@phosphor-icons/react/Tag"
import { WalletIcon } from "@phosphor-icons/react/Wallet"
import { useNavigate, useSearchParams } from "react-router-dom"
import { apiFetch, getApiErrorMessage } from "../app/api"
import { formatDateRange, formatShortDate } from "../app/format"
import type { TransactionsResponse } from "../app/api-types"
import { Amount } from "../components/ui/Amount"
import { Button } from "../components/ui/Button"
import { CategoryGlyph } from "../components/ui/CategoryGlyph"
import { DayBand } from "../components/ui/DayBand"
import { EmptyState } from "../components/ui/EmptyState"
import { EntryChips, EntryDialog, EntryName } from "../components/ui/EntryDialog"
import { useIsDesktop } from "../components/ui/layout-state"
import { AmountCell, AmountPrefix, Cell, List, Row, RowFlags, type Columns } from "../components/ui/LedgerRow"
import { Panel, PanelError, PanelLoading, ViewRow } from "../components/ui/Panel"
import { Peek, PeekHeadline, PeekLayout, PeekSection, PeekSubline } from "../components/ui/Peek"
import { PeriodControl } from "../components/ui/PeriodControl"
import { DEFAULT_PERIOD_PRESETS, periodFromSearch, periodLabel, writePeriodToSearch, type PeriodSelection } from "../components/ui/period"
import { Pill } from "../components/ui/Pill"
import { InlineText, Property } from "../components/ui/PropertyList"
import { SortMenu, type SortDirection, type SortKey } from "../components/ui/SortMenu"
import { TagChip } from "../components/ui/TagChip"
import { showToast } from "../components/ui/toast-store"
import { Tooltip } from "../components/ui/Tooltip"
import { buildSearchParams } from "../lib/searchParams"
import {
  autoAddStatus,
  useTagLifecycle,
  useTagSave,
  type DateRange,
  type TagRecord,
} from "./tag-record"
import { AutoAddPopover, TagMenuItems, TagMergeDialog, TagSettingsList } from "./TagSettings"

type TagRow = TagRecord & { usage_count: number; expense_cents: number; income_cents: number }
type TagsResponse = { period: { slug: string; start: string; end: string }; tags: TagRow[] }
type SortField = "spent" | "usage" | "name" | "created"

const DEFAULT_PERIOD: PeriodSelection = { slug: "all" }
const TAG_COLUMNS: Columns = {
  columns: "minmax(0, 160px) minmax(0, 1fr) 24px 72px 190px",
  narrowColumns: "minmax(0, 1fr) 24px auto",
  mobileColumns: "minmax(0, 1fr) 24px auto",
}
const RECENT_COLUMNS = "18px minmax(0, 1fr) auto"
const SORT_KEYS: ReadonlyArray<SortKey<SortField>> = [
  { key: "spent", label: "Spent", directions: { asc: "Lowest first", desc: "Highest first" }, defaultDirection: "desc" },
  { key: "usage", label: "Usage", directions: { asc: "Least used first", desc: "Most used first" }, defaultDirection: "desc" },
  { key: "name", label: "Name", directions: { asc: "A to Z", desc: "Z to A" }, defaultDirection: "asc" },
  { key: "created", label: "Date created", directions: { asc: "Oldest first", desc: "Newest first" }, defaultDirection: "asc" },
]

function usesText(count: number): string {
  return count === 1 ? "1 use" : `${count} uses`
}

function sortTags(rows: TagRow[], field: SortField, direction: SortDirection): TagRow[] {
  const sign = direction === "asc" ? 1 : -1
  return [...rows].sort((a, b) => {
    const order =
      field === "spent"
        ? a.expense_cents - b.expense_cents
        : field === "usage"
          ? a.usage_count - b.usage_count
          : field === "created"
            ? a.created_at.localeCompare(b.created_at)
            : a.name.localeCompare(b.name)
    return order ? sign * order : a.name.localeCompare(b.name)
  })
}

// Spending in ink; income, when present, as a smaller + figure before it (desktop only), or alone.
function TagAmount({ tag }: { tag: TagRow }) {
  if (!tag.expense_cents && tag.income_cents) return <Amount cents={tag.income_cents} kind="income" />
  return (
    <>
      {tag.income_cents ? (
        <AmountPrefix>
          <Amount cents={tag.income_cents} kind="income" />
        </AmountPrefix>
      ) : null}
      <Amount cents={tag.expense_cents} />
    </>
  )
}

function AddTagDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState("")
  const [excluded, setExcluded] = useState(false)
  const [hiddenFromFilters, setHiddenFromFilters] = useState(false)
  const [autoAdd, setAutoAdd] = useState<DateRange | null>(null)
  const [error, setError] = useState<string | null>(null)
  const create = useMutation({
    mutationFn: () =>
      apiFetch<TagRecord>("/api/tags", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          is_hidden_from_budget: excluded,
          is_hidden_from_filters: hiddenFromFilters,
          auto_attach_period: autoAdd,
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tags"] })
      onClose()
    },
    onError: (failure) => setError(getApiErrorMessage(failure, "Unable to create tag.")),
  })
  const submit = () => {
    setError(null)
    if (!name.trim()) return setError("Enter a tag name.")
    create.mutate()
  }
  return (
    <EntryDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Add tag"
      submitLabel="Add tag"
      onSubmit={submit}
      pending={create.isPending}
      error={error}
    >
      <EntryName autoFocus aria-label="Name" placeholder="Name" value={name} onChange={(event) => setName(event.target.value)} />
      <EntryChips>
        <Pill icon={WalletIcon} set={excluded} aria-pressed={excluded} onClick={() => setExcluded(!excluded)}>
          Exclude from budgets
        </Pill>
        <Pill icon={FunnelIcon} set={hiddenFromFilters} aria-pressed={hiddenFromFilters} onClick={() => setHiddenFromFilters(!hiddenFromFilters)}>
          Hide from filters
        </Pill>
        <AutoAddPopover
          value={autoAdd}
          onSave={setAutoAdd}
          trigger={
            <Pill icon={CalendarIcon} set={autoAdd !== null} aria-label={`Auto-add ${autoAdd ? formatDateRange(autoAdd.start, autoAdd.end) : "off"}`}>
              {autoAdd ? `Auto-add ${formatDateRange(autoAdd.start, autoAdd.end)}` : "Auto-add"}
            </Pill>
          }
        />
      </EntryChips>
    </EntryDialog>
  )
}

function TagPeek({
  tag,
  tags,
  period,
  onClose,
  onMerged,
}: {
  tag: TagRow
  tags: TagRow[]
  period: PeriodSelection
  onClose: () => void
  onMerged: (target: TagRecord) => void
}) {
  const navigate = useNavigate()
  const [merging, setMerging] = useState(false)
  const { view, errors, setError, save } = useTagSave(tag, ["name"])
  const { archive, restore, confirmDelete } = useTagLifecycle(tag, onClose)
  const periodParams = writePeriodToSearch(new URLSearchParams(), period)
  const fullView = `/tags/${tag.id}?${periodParams.toString()}`
  const recentParams = writePeriodToSearch(new URLSearchParams({ tags: String(tag.id), limit: "5" }), period)
  const recent = useQuery({
    queryKey: ["transactions", "tag-recent", tag.id, recentParams.toString()],
    queryFn: () => apiFetch<TransactionsResponse>(`/api/transactions?${recentParams.toString()}`),
  })
  const recentItems = recent.data?.items ?? []

  return (
    <Peek
      parent="Tags"
      title={tag.name}
      onClose={onClose}
      fullViewTo={fullView}
      menu={
        <TagMenuItems
          archived={Boolean(tag.archived_at)}
          onMerge={() => setMerging(true)}
          onArchive={archive}
          onRestore={restore}
          onDelete={() => void confirmDelete()}
        />
      }
    >
      <InlineText
        variant="title"
        label="Name"
        value={tag.name}
        error={errors.name}
        onCancel={() => setError("name", null)}
        onSave={(next) => {
          if (!next.trim()) {
            setError("name", "Enter a tag name.")
            return false
          }
          return save("name", { name: next.trim() })
        }}
      />
      <PeekHeadline figure={<Amount cents={tag.expense_cents} />} detail="spent" />
      {tag.income_cents ? (
        <PeekSubline>
          <Amount cents={tag.income_cents} kind="income" /> income
        </PeekSubline>
      ) : null}
      <TagSettingsList tag={view} errors={errors} save={save}>
        <Property label={periodLabel(period, DEFAULT_PERIOD_PRESETS)}>{usesText(tag.usage_count)}</Property>
        <Property label="Created">{formatShortDate(tag.created_at)}</Property>
        {tag.archived_at ? <Property label="Archived">{formatShortDate(tag.archived_at)}</Property> : null}
      </TagSettingsList>
      <PeekSection
        title="Recent"
        action={
          // The tag page also has its totals and breakdown, and on mobile this is the only way there.
          recent.data?.total ? (
            <Button variant="ghost" size="small" onClick={() => navigate(fullView)}>
              All {recent.data.total}
            </Button>
          ) : undefined
        }
      >
        {recentItems.length ? (
          <List flat label="Recent transactions">
            {recentItems.map((item) => (
              <Row
                key={item.id}
                columns={RECENT_COLUMNS}
                label={item.title ?? "Untitled"}
                onOpen={() => navigate(`/transactions/${item.id}`)}
              >
                <CategoryGlyph categoryId={item.category?.id ?? null} icon={item.category?.icon} name={item.category?.name ?? "Uncategorized"} />
                <Cell>{item.title ?? "Untitled"}</Cell>
                <AmountCell>
                  <Amount cents={item.amount_cents} kind={item.type === "income" ? "income" : "expense"} />
                </AmountCell>
              </Row>
            ))}
          </List>
        ) : (
          <EmptyState inline>{recent.isLoading ? "Loading…" : recent.isError ? "Unable to load transactions." : "None"}</EmptyState>
        )}
      </PeekSection>
      {merging ? (
        <TagMergeDialog
          source={tag}
          targets={tags.filter((entry) => entry.id !== tag.id && !entry.archived_at)}
          onClose={() => setMerging(false)}
          onMerged={(target) => {
            setMerging(false)
            onMerged(target)
          }}
        />
      ) : null}
    </Peek>
  )
}

function TagsPage() {
  const isDesktop = useIsDesktop()
  const [searchParams, setSearchParams] = useSearchParams()
  const [adding, setAdding] = useState(false)
  const [sort, setSort] = useState<{ field: SortField; direction: SortDirection }>({ field: "spent", direction: "desc" })
  const [now] = useState(() => new Date())
  const period = periodFromSearch(searchParams, DEFAULT_PERIOD)
  const peekId = Number(searchParams.get("peek")) || null
  const queryParams = writePeriodToSearch(new URLSearchParams(), period)
  queryParams.set("include_archived", "1")
  const queryString = queryParams.toString()

  const { data, isLoading, error } = useQuery({
    queryKey: ["tags", queryString],
    queryFn: () => apiFetch<TagsResponse>(`/api/tags?${queryString}`),
  })

  if (isLoading) return <PanelLoading title="Tags" label="Loading tags…" />
  if (error || !data) return <PanelError title="Tags" message="Unable to load tags." />

  const update = (values: Record<string, string | null>, replace = false) =>
    setSearchParams(buildSearchParams(searchParams, values), { replace })
  const bands = [
    { label: "Active", rows: sortTags(data.tags.filter((tag) => !tag.archived_at), sort.field, sort.direction) },
    { label: "Archived", rows: sortTags(data.tags.filter((tag) => tag.archived_at), "name", "asc") },
  ].filter((band) => band.rows.length)
  const peekTag = data.tags.find((tag) => tag.id === peekId)
  const peek = peekTag ? (
    <TagPeek
      key={peekTag.id}
      tag={peekTag}
      tags={data.tags}
      period={period}
      onClose={() => update({ peek: null }, true)}
      onMerged={(target) => {
        showToast({ message: `Merged ${peekTag.name} into ${target.name}.` })
        update({ peek: String(target.id) }, true)
      }}
    />
  ) : null

  const main = bands.length ? (
    <List label="Tags">
      {bands.map((band) => [
        <DayBand key={`band-${band.label}`} label={band.label} end={band.rows.length} />,
        ...band.rows.map((tag) => (
          <Row
            key={tag.id}
            {...TAG_COLUMNS}
            label={tag.name}
            dim={Boolean(tag.archived_at)}
            selected={tag.id === peekId}
            onOpen={() => update({ peek: String(tag.id) })}
          >
            <Cell>
              <TagChip>{tag.name}</TagChip>
            </Cell>
            <Cell tone="muted" hide="narrow">
              {tag.archived_at
                ? `Archived ${formatShortDate(tag.archived_at)}`
                : tag.auto_attach_period
                  ? `Auto ${formatDateRange(tag.auto_attach_period.start, tag.auto_attach_period.end)} · ${autoAddStatus(tag.auto_attach_period, now)}`
                  : null}
            </Cell>
            <RowFlags>
              {tag.is_hidden_from_budget ? (
                <Tooltip label="Excluded from budgets">
                  <ProhibitIcon role="img" aria-label="Excluded from budgets" />
                </Tooltip>
              ) : null}
            </RowFlags>
            <Cell align="right" tone="muted" hide="narrow">
              {usesText(tag.usage_count)}
            </Cell>
            <AmountCell>
              <TagAmount tag={tag} />
            </AmountCell>
          </Row>
        )),
      ])}
    </List>
  ) : (
    <EmptyState
      icon={TagIcon}
      action={
        <Button variant="primary" icon={PlusIcon} onClick={() => setAdding(true)}>
          Add tag
        </Button>
      }
    >
      No tags yet.
    </EmptyState>
  )

  return (
    <Panel
      title="Tags"
      layout="fill"
      peekOpen={peek !== null}
      actions={
        <Button variant="primary" icon={PlusIcon} aria-label="Add tag" onClick={() => setAdding(true)}>
          {isDesktop ? "Add tag" : "Add"}
        </Button>
      }
      viewRow={
        <ViewRow
          end={
            <SortMenu
              keys={SORT_KEYS}
              value={sort.field}
              direction={sort.direction}
              onChange={(field, direction) => setSort({ field, direction })}
            />
          }
        >
          <PeriodControl value={period} onChange={(next) => setSearchParams(writePeriodToSearch(searchParams, next))} />
        </ViewRow>
      }
    >
      <PeekLayout peek={peek} main={main} />
      {adding ? <AddTagDialog onClose={() => setAdding(false)} /> : null}
    </Panel>
  )
}

export default TagsPage
