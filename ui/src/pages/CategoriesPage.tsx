import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArchiveIcon } from "@phosphor-icons/react/Archive"
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/ArrowCounterClockwise"
import { GitMergeIcon } from "@phosphor-icons/react/GitMerge"
import { ListNumbersIcon } from "@phosphor-icons/react/ListNumbers"
import { PlusIcon } from "@phosphor-icons/react/Plus"
import { ShapesIcon } from "@phosphor-icons/react/Shapes"
import { useNavigate, useSearchParams } from "react-router-dom"
import { apiFetch, getApiErrorMessage } from "../app/api"
import type { CategoryListItem, TransactionsResponse } from "../app/api-types"
import { formatShortDate } from "../app/format"
import { useQueuedSave } from "../app/queued-save"
import { categoryIconName, DEFAULT_CATEGORY_ICON_KEY } from "../components/categoryIconsCatalog"
import { ValuePopover } from "../components/FormPopover"
import { IconPickerPopover } from "../components/IconPickerPopover"
import { MergeDialog } from "../components/MergeDialog"
import { Amount } from "../components/ui/Amount"
import { Button } from "../components/ui/Button"
import { CategoryGlyph } from "../components/ui/CategoryGlyph"
import { DayBand } from "../components/ui/DayBand"
import { EmptyState } from "../components/ui/EmptyState"
import { EntryChips, EntryDialog, EntryName } from "../components/ui/EntryDialog"
import { useIsDesktop } from "../components/ui/layout-state"
import { AmountCell, Cell, List, Row, type Columns } from "../components/ui/LedgerRow"
import { MenuItem } from "../components/ui/Menu"
import { Panel, PanelError, PanelLoading, ViewRow } from "../components/ui/Panel"
import { Peek, PeekLayout, PeekSection } from "../components/ui/Peek"
import { PeriodControl } from "../components/ui/PeriodControl"
import { DEFAULT_PERIOD_PRESETS, periodFromSearch, periodLabel, writePeriodToSearch, type PeriodSelection } from "../components/ui/period"
import { Pill } from "../components/ui/Pill"
import { InlineText, Property, PropertyButton, PropertyList } from "../components/ui/PropertyList"
import { SegmentedControl } from "../components/ui/SegmentedControl"
import { SortMenu, type SortDirection, type SortKey } from "../components/ui/SortMenu"
import { showToast } from "../components/ui/toast-store"
import { buildSearchParams } from "../lib/searchParams"

type CategoriesPageResponse = {
  period: { slug: string; start: string; end: string }
  categories: CategoryListItem[]
}
type CategoryField = "name" | "icon" | "order"
// The body of PUT /api/categories/{id}; the type is fixed once created.
type CategoryPayload = { name: string; icon: string; order: number }
type SortField = "usage" | "name"

const DEFAULT_PERIOD: PeriodSelection = { slug: "all" }
const CATEGORY_COLUMNS: Columns = { columns: "18px minmax(0, 1fr) 100px" }
const RECENT_COLUMNS = "minmax(0, 1fr) auto"
const SORT_KEYS: ReadonlyArray<SortKey<SortField>> = [
  { key: "usage", label: "Usage", directions: { asc: "Least used first", desc: "Most used first" }, defaultDirection: "desc" },
  { key: "name", label: "Name", directions: { asc: "A to Z", desc: "Z to A" }, defaultDirection: "asc" },
]

function categoryPayload(category: CategoryListItem): CategoryPayload {
  return { name: category.name, icon: category.icon ?? DEFAULT_CATEGORY_ICON_KEY, order: category.order ?? 0 }
}

const ORDER_ERROR = "Enter a whole number."

function parseOrder(raw: string): number | null {
  const value = Number(raw.trim())
  return raw.trim() && Number.isInteger(value) ? value : null
}

function usesText(count: number): string {
  return count === 1 ? "1 use" : `${count} uses`
}

function sortCategories(rows: CategoryListItem[], field: SortField, direction: SortDirection): CategoryListItem[] {
  const sign = direction === "asc" ? 1 : -1
  return [...rows].sort((a, b) => {
    if (field === "usage" && (a.usage_count ?? 0) !== (b.usage_count ?? 0)) {
      return sign * ((a.usage_count ?? 0) - (b.usage_count ?? 0))
    }
    return (field === "name" ? sign : 1) * a.name.localeCompare(b.name)
  })
}

function invalidateCategories(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ["categories"] })
}

function AddCategoryDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const [type, setType] = useState<"expense" | "income">("expense")
  const [name, setName] = useState("")
  const [icon, setIcon] = useState(DEFAULT_CATEGORY_ICON_KEY)
  const [order, setOrder] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const create = useMutation({
    mutationFn: (payload: CategoryPayload & { type: string }) =>
      apiFetch<CategoryListItem>("/api/categories", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      invalidateCategories(queryClient)
      onClose()
    },
    onError: (failure) => setError(getApiErrorMessage(failure, "Unable to create category.")),
  })
  const submit = () => {
    setError(null)
    if (!name.trim()) return setError("Enter a category name.")
    create.mutate({ name: name.trim(), type, icon, order })
  }
  return (
    <EntryDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Add category"
      direction={
        <SegmentedControl
          label="Type"
          value={type}
          options={[
            { value: "expense", label: "Expense" },
            { value: "income", label: "Income" },
          ]}
          onChange={setType}
        />
      }
      submitLabel="Add category"
      onSubmit={submit}
      pending={create.isPending}
      error={error}
    >
      <EntryName autoFocus aria-label="Name" placeholder="Name" value={name} onChange={(event) => setName(event.target.value)} />
      <EntryChips>
        <IconPickerPopover
          value={icon}
          onChange={setIcon}
          trigger={
            <Pill leading={<CategoryGlyph categoryId={null} icon={icon} name={name} />} aria-label={`Icon ${categoryIconName(icon)}`}>
              {icon === DEFAULT_CATEGORY_ICON_KEY ? "Icon" : categoryIconName(icon)}
            </Pill>
          }
        />
        <ValuePopover
          label="Order"
          inputMode="numeric"
          submitLabel="Done"
          value={String(order)}
          onSave={(value) => {
            const next = parseOrder(value)
            if (next === null) return ORDER_ERROR
            setOrder(next)
            return null
          }}
          trigger={
            <Pill icon={ListNumbersIcon} set={order !== 0} aria-label={`Order ${order}`}>
              Order {order}
            </Pill>
          }
        />
      </EntryChips>
    </EntryDialog>
  )
}

function categoryMergeCounts(counts: Record<string, number>) {
  const count = (key: string) => counts[key] ?? 0
  const plural = (value: number, word: string) => `${value} ${word}${value === 1 ? "" : "s"}`
  return (
    <>
      <Property label="Transactions">{count("transactions")}</Property>
      <Property label="Recurring rules" empty={!count("recurring_rules")}>
        {count("recurring_rules")}
      </Property>
      <Property label="Rule actions" empty={!count("rules_set_category")}>
        {count("rules_set_category")}
      </Property>
      <Property label="Budgets" empty={!count("budget_templates") && !count("budget_overrides")}>
        {plural(count("budget_templates"), "plan")}, {plural(count("budget_overrides"), "adjustment")}
      </Property>
    </>
  )
}

function CategoryPeek({
  category: stored,
  period,
  categories,
  onClose,
  onMerged,
}: {
  category: CategoryListItem
  period: PeriodSelection
  categories: CategoryListItem[]
  onClose: () => void
  onMerged: (target: CategoryListItem) => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [merging, setMerging] = useState(false)
  const {
    view: category,
    errors,
    setError,
    save,
  } = useQueuedSave<CategoryListItem, CategoryPayload, CategoryField>({
    url: `/api/categories/${stored.id}`,
    source: stored,
    toPayload: categoryPayload,
    onSaved: () => invalidateCategories(queryClient),
    draftFields: ["name"],
  })
  const ledgerParams = writePeriodToSearch(new URLSearchParams({ category: String(category.id) }), period)
  const recent = useQuery({
    queryKey: ["transactions", "category-recent", category.id, ledgerParams.toString()],
    queryFn: () => apiFetch<TransactionsResponse>(`/api/transactions?${ledgerParams.toString()}&limit=5`),
  })
  const restore = useMutation({
    mutationFn: () => apiFetch(`/api/categories/${category.id}/restore`, { method: "POST" }),
    onSuccess: () => invalidateCategories(queryClient),
    onError: (failure) => showToast({ message: getApiErrorMessage(failure, "Unable to restore the category.") }),
  })
  const archive = useMutation({
    mutationFn: () => apiFetch(`/api/categories/${category.id}/archive`, { method: "POST" }),
    onSuccess: () => {
      invalidateCategories(queryClient)
      showToast({ message: `Archived ${category.name}.`, action: { label: "Undo", onClick: () => restore.mutate() } })
    },
    onError: (failure) => showToast({ message: getApiErrorMessage(failure, "Unable to archive the category.") }),
  })
  const archived = Boolean(category.archived_at)
  const sum = category.type === "income" ? category.income_cents : category.expense_cents
  const recentItems = recent.data?.items ?? []
  const fromParams = new URLSearchParams(ledgerParams)
  fromParams.set("from", "categories")

  return (
    <Peek
      parent="Categories"
      title={category.name}
      onClose={onClose}
      menu={
        archived ? (
          <MenuItem icon={ArrowCounterClockwiseIcon} onSelect={() => restore.mutate()}>
            Restore
          </MenuItem>
        ) : (
          <>
            <MenuItem icon={GitMergeIcon} onSelect={() => setMerging(true)}>
              Merge into…
            </MenuItem>
            <MenuItem icon={ArchiveIcon} onSelect={() => archive.mutate()}>
              Archive
            </MenuItem>
          </>
        )
      }
    >
      <InlineText
        variant="title"
        label="Name"
        value={category.name}
        error={errors.name}
        onCancel={() => setError("name", null)}
        onSave={(next) => {
          if (!next.trim()) {
            setError("name", "Enter a category name.")
            return false
          }
          return save("name", { name: next.trim() })
        }}
      />
      <PropertyList>
        <Property label="Type">{category.type === "income" ? "Income" : "Expense"}</Property>
        <Property label="Icon" editable error={errors.icon}>
          <IconPickerPopover
            value={category.icon}
            onChange={(icon) => {
              if (icon !== category.icon) void save("icon", { icon })
            }}
            trigger={
              <PropertyButton>
                <CategoryGlyph categoryId={category.id} icon={category.icon} name={category.name} />
                {categoryIconName(category.icon)}
              </PropertyButton>
            }
          />
        </Property>
        <Property label="Order" editable error={errors.order}>
          <ValuePopover
            label="Order"
            inputMode="numeric"
            value={String(category.order ?? 0)}
            onSave={(value) => {
              const order = parseOrder(value)
              if (order === null) return ORDER_ERROR
              void save("order", { order })
              return null
            }}
            trigger={<PropertyButton>{category.order ?? 0}</PropertyButton>}
          />
        </Property>
        <Property label={periodLabel(period, DEFAULT_PERIOD_PRESETS)}>
          <span>
            {usesText(category.usage_count ?? 0)}
            {sum ? (
              <>
                {" · "}
                <Amount cents={sum} kind={category.type === "income" ? "income" : "expense"} />
              </>
            ) : null}
          </span>
        </Property>
        {category.archived_at ? <Property label="Archived">{formatShortDate(category.archived_at)}</Property> : null}
      </PropertyList>
      <PeekSection
        title="Recent"
        action={
          recent.data && recent.data.total > recentItems.length ? (
            <Button variant="ghost" size="small" onClick={() => navigate(`/transactions?${fromParams.toString()}`)}>
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
        <MergeDialog
          source={category}
          targets={categories.filter((entry) => entry.id !== category.id && entry.type === category.type && !entry.archived_at)}
          noun="category"
          errorMessage="Unable to merge categories."
          endpoint="/api/categories/merge"
          body={(targetId) => ({ source_category_id: category.id, target_category_id: targetId })}
          invalidate={["categories", "transactions", "insights", "budgets", "recurring", "rules"]}
          renderCounts={categoryMergeCounts}
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

function CategoriesPage() {
  const isDesktop = useIsDesktop()
  const [searchParams, setSearchParams] = useSearchParams()
  const [adding, setAdding] = useState(false)
  const [sort, setSort] = useState<{ field: SortField; direction: SortDirection }>({ field: "usage", direction: "desc" })
  const period = periodFromSearch(searchParams, DEFAULT_PERIOD)
  const peekId = Number(searchParams.get("peek")) || null
  const queryString = writePeriodToSearch(new URLSearchParams(), period).toString()

  const { data, isLoading, error } = useQuery({
    queryKey: ["categories", queryString],
    queryFn: () => apiFetch<CategoriesPageResponse>(`/api/categories?${queryString}`),
  })

  if (isLoading) return <PanelLoading title="Categories" label="Loading categories…" />
  if (error || !data) return <PanelError title="Categories" message="Unable to load categories." />

  const update = (values: Record<string, string | null>, replace = false) =>
    setSearchParams(buildSearchParams(searchParams, values), { replace })
  const active = data.categories.filter((category) => !category.archived_at)
  const bands = [
    { label: "Expenses", rows: sortCategories(active.filter((category) => category.type !== "income"), sort.field, sort.direction) },
    { label: "Income", rows: sortCategories(active.filter((category) => category.type === "income"), sort.field, sort.direction) },
    { label: "Archived", rows: sortCategories(data.categories.filter((category) => category.archived_at), "name", "asc") },
  ].filter((band) => band.rows.length)
  const peekCategory = data.categories.find((category) => category.id === peekId)
  const peek = peekCategory ? (
    <CategoryPeek
      key={peekCategory.id}
      category={peekCategory}
      period={period}
      categories={data.categories}
      onClose={() => update({ peek: null }, true)}
      onMerged={(target) => {
        showToast({ message: `Merged ${peekCategory.name} into ${target.name}.` })
        update({ peek: String(target.id) }, true)
      }}
    />
  ) : null

  const main = bands.length ? (
    <List label="Categories">
      {bands.map((band) => [
        <DayBand key={`band-${band.label}`} label={band.label} end={band.rows.length} />,
        ...band.rows.map((category) => (
          <Row
            key={category.id}
            {...CATEGORY_COLUMNS}
            label={category.name}
            dim={Boolean(category.archived_at)}
            selected={category.id === peekId}
            onOpen={() => update({ peek: String(category.id) })}
          >
            <CategoryGlyph categoryId={category.id} icon={category.icon} name={category.name} />
            <Cell strong>{category.name}</Cell>
            <Cell align="right" tone="muted">
              {category.archived_at
                ? `Archived ${formatShortDate(category.archived_at)}`
                : usesText(category.usage_count ?? 0)}
            </Cell>
          </Row>
        )),
      ])}
    </List>
  ) : (
    <EmptyState
      icon={ShapesIcon}
      action={
        <Button variant="primary" icon={PlusIcon} onClick={() => setAdding(true)}>
          Add category
        </Button>
      }
    >
      No categories yet.
    </EmptyState>
  )

  return (
    <Panel
      title="Categories"
      layout="fill"
      peekOpen={peek !== null}
      actions={
        <Button variant="primary" icon={PlusIcon} aria-label="Add category" onClick={() => setAdding(true)}>
          {isDesktop ? "Add category" : "Add"}
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
      {adding ? <AddCategoryDialog onClose={() => setAdding(false)} /> : null}
    </Panel>
  )
}

export default CategoriesPage
