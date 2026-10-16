import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowsDownUpIcon } from "@phosphor-icons/react/ArrowsDownUp"
import { CaretLeftIcon } from "@phosphor-icons/react/CaretLeft"
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight"
import { CheckSquareIcon } from "@phosphor-icons/react/CheckSquare"
import { ChecksIcon } from "@phosphor-icons/react/Checks"
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree"
import { DownloadSimpleIcon } from "@phosphor-icons/react/DownloadSimple"
import { EraserIcon } from "@phosphor-icons/react/Eraser"
import { FunnelIcon } from "@phosphor-icons/react/Funnel"
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass"
import { MinusIcon } from "@phosphor-icons/react/Minus"
import { PlusIcon } from "@phosphor-icons/react/Plus"
import { PrinterIcon } from "@phosphor-icons/react/Printer"
import { ShapesIcon } from "@phosphor-icons/react/Shapes"
import { SwapIcon } from "@phosphor-icons/react/Swap"
import { TagIcon } from "@phosphor-icons/react/Tag"
import { TrashIcon } from "@phosphor-icons/react/Trash"
import { XIcon } from "@phosphor-icons/react/X"
import { useLocation, useOutletContext, useSearchParams } from "react-router-dom"
import { apiFetch, getApiErrorMessage } from "../app/api"
import type { TagsResponse, TransactionsResponse, TransactionsSummary } from "../app/api-types"
import type { AppShellOutletContext } from "../app/AppShell"
import { dayLabel, dayNet, groupByDay, invalidateTransactionData, reimbursementOf, rowTitle, useSettledSearch } from "../app/transactions"
import { CategoryPicker } from "../components/CategoryPicker"
import { confirmDialog } from "../components/confirm"
import { TagFilterOptions, type TagMode } from "../components/TagFilterOptions"
import { TagPicker } from "../components/TagPicker"
import { Amount } from "../components/ui/Amount"
import { BulkBar } from "../components/ui/BulkBar"
import { Button, IconButton } from "../components/ui/Button"
import { CategoryGlyph } from "../components/ui/CategoryGlyph"
import { DayBand } from "../components/ui/DayBand"
import { Dialog } from "../components/ui/Dialog"
import { EmptyState } from "../components/ui/EmptyState"
import { EntryChips } from "../components/ui/EntryDialog"
import { useIsDesktop } from "../components/ui/layout-state"
import { LedgerRow, List, ListFooter, TransactionAmount } from "../components/ui/LedgerRow"
import { Menu, MenuItem, MenuLink, MenuSeparator } from "../components/ui/Menu"
import { Panel, PanelError, PanelLoading, ViewRow } from "../components/ui/Panel"
import { PeekLayout } from "../components/ui/Peek"
import { PeriodControl } from "../components/ui/PeriodControl"
import {
  DEFAULT_PERIOD_PRESETS,
  periodFromSearch,
  periodLabel,
  writePeriodToSearch,
  type PeriodSelection,
} from "../components/ui/period"
import { Pill } from "../components/ui/Pill"
import { Popover } from "../components/ui/Popover"
import { PrintLedger } from "../components/ui/PrintLedger"
import { SegmentedControl } from "../components/ui/SegmentedControl"
import { TagChip } from "../components/ui/TagChip"
import { Field, FieldGrid, Select, TextField } from "../components/ui/TextField"
import { showToast } from "../components/ui/toast-store"
import { buildSearchParams } from "../lib/searchParams"
import { canonicalizeTagScope, parseTagIds, serializeTagIds } from "../lib/tagFilters"
import { TransactionPeek } from "./TransactionRecord"

type TypeFilter = "income" | "expense"

type BulkOperation = {
  set_category_id: number | null
  tag_patch: null | { mode: "add" | "remove" | "replace" | "clear"; tags: string[] }
  lifecycle: "none" | "soft_delete" | "restore"
}

type BulkResponse = {
  resolved_count: number
  eligible_count: number
  skipped_count: number
}

// Every selected row, or every row matching the filters across pages.
type Selection = { mode: "ids"; ids: number[] } | { mode: "query" }

type TagPatchMode = "add" | "remove" | "replace"

const LIST_KEYS = ["period", "start", "end", "type", "category", "tag", "tags", "exclude_tags", "q", "page"]
// Pages whose chart marks open the ledger scoped to a slice (`from` in the URL); the
// breadcrumb leads back to them.
const ORIGINS = {
  dashboard: { label: "Dashboard", to: "/" },
  insights: { label: "Insights", to: "/insights" },
  categories: { label: "Categories", to: "/categories" },
  digest: { label: "Digest", to: "/digest" },
}
const DEFAULT_PERIOD: PeriodSelection = { slug: "all" }
const MAC = navigator.userAgent.includes("Mac")

const TAG_PATCH_COPY: Record<TagPatchMode, { title: string; verb: string }> = {
  add: { title: "Add tags", verb: "Add tags to" },
  remove: { title: "Remove tags", verb: "Remove tags from" },
  replace: { title: "Replace tags", verb: "Replace tags on" },
}

function countLabel(count: number): string {
  return `${count} transaction${count === 1 ? "" : "s"}`
}

function TransactionsPage() {
  const { openAddTransaction } = useOutletContext<AppShellOutletContext>()
  const queryClient = useQueryClient()
  const location = useLocation()
  const isDesktop = useIsDesktop()
  const [searchParams, setSearchParams] = useSearchParams()
  const peekId = Number(searchParams.get("peek")) || null
  const searchQuery = searchParams.get("q") ?? ""
  const [searchOpen, setSearchOpen] = useState(false)
  const [tagPatch, setTagPatch] = useState<{ mode: TagPatchMode; tags: string[] } | null>(null)
  const [bulkPending, setBulkPending] = useState(false)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const searchButtonRef = useRef<HTMLButtonElement | null>(null)

  // The server sees only the list's own parameters, never the open peek.
  const listParams = useMemo(() => {
    const params = new URLSearchParams()
    for (const key of LIST_KEYS) {
      const value = searchParams.get(key)
      if (value) params.set(key, value)
    }
    const canonical = canonicalizeTagScope(params)
    if (!canonical.get("period")) canonical.set("period", "all")
    return canonical
  }, [searchParams])
  const settledSearch = useSettledSearch(searchQuery)
  const queryString = useMemo(() => {
    const params = new URLSearchParams(listParams)
    if (settledSearch) params.set("q", settledSearch)
    else params.delete("q")
    if (!params.get("page")) params.set("page", "1")
    return params.toString()
  }, [listParams, settledSearch])

  useEffect(() => {
    if (!searchParams.has("exclude_tags") || (!searchParams.has("tag") && !searchParams.has("tags"))) return
    setSearchParams(canonicalizeTagScope(searchParams), { replace: true })
  }, [searchParams, setSearchParams])

  // A selection belongs to the filters and page it was made on; a change starts a new one.
  // The typed search counts at once, before the debounced query catches up.
  const selectionKey = `${queryString}\n${searchQuery}`
  const [selectionState, setSelectionState] = useState<{ query: string; selection: Selection }>({
    query: selectionKey,
    selection: { mode: "ids", ids: [] },
  })
  const selection: Selection = selectionState.query === selectionKey ? selectionState.selection : { mode: "ids", ids: [] }
  const setSelection = (next: Selection) => setSelectionState({ query: selectionKey, selection: next })
  // Mobile rows have no hover checkbox; Select in the ⋯ menu turns row taps into toggles.
  const [selectMode, setSelectMode] = useState(false)
  const selecting = selectMode && !isDesktop
  // The URL holds no tag mode while no tag is chosen, so the chosen mode is kept here.
  const [emptyTagMode, setEmptyTagMode] = useState<TagMode>("include")

  const { data, isLoading, isFetching, isPlaceholderData, error } = useQuery({
    queryKey: ["transactions", queryString],
    queryFn: () => apiFetch<TransactionsResponse>(`/api/transactions?${queryString}`),
  })
  const { data: tagsData } = useQuery({
    queryKey: ["tags", "options"],
    queryFn: () => apiFetch<TagsResponse>("/api/tags/options"),
  })
  // Query-wide bulk edits trust only a count fetched for the current filters.
  const settled = isFetching || isPlaceholderData ? undefined : data

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  // Printing loads every row for the filters first; the ledger then opens the print dialog.
  const [printout, setPrintout] = useState<{ list: TransactionsResponse; summary: TransactionsSummary } | "loading" | null>(
    null
  )
  const endPrint = useCallback(() => setPrintout(null), [])
  const startPrint = useCallback(async () => {
    setPrintout("loading")
    const params = new URLSearchParams(listParams)
    params.delete("page")
    const listAll = async () => {
      const pages: TransactionsResponse[] = []
      do {
        const pageParams = new URLSearchParams(params)
        pageParams.set("page", String(pages.length + 1))
        pageParams.set("limit", "1000")
        pages.push(await apiFetch<TransactionsResponse>(`/api/transactions?${pageParams.toString()}`))
      } while (pages[pages.length - 1].has_more)
      return { ...pages[0], items: pages.flatMap((entry) => entry.items) }
    }
    try {
      const [list, summary] = await Promise.all([
        listAll(),
        apiFetch<TransactionsSummary>(`/api/transactions/summary?${params.toString()}`),
      ])
      setPrintout({ list, summary })
    } catch (failure) {
      setPrintout(null)
      showToast({ message: getApiErrorMessage(failure, "Unable to prepare the printout.") })
    }
  }, [listParams])
  // Cmd+P (Ctrl+P off the Mac, where Ctrl+P moves the text cursor) prints the whole ledger
  // rather than the screen, once there is a ledger to print.
  const printable = !error && (data?.total ?? 0) > 0
  useEffect(() => {
    if (!printable) return
    const onKeyDown = (event: KeyboardEvent) => {
      const command = MAC ? event.metaKey : event.ctrlKey
      if (event.key.toLowerCase() !== "p" || !command || event.altKey || event.shiftKey) return
      event.preventDefault()
      if (printout === null) void startPrint()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [printable, printout, startPrint])

  if (isLoading) {
    return <PanelLoading title="Transactions" label="Loading transactions…" />
  }
  if (error || !data) {
    return <PanelError title="Transactions" message="Unable to load transactions." />
  }

  const { items, has_more, page, limit, total, categories, tags } = data
  // Filters come from the URL, so controls show a change, and each tag tick builds on the last, before the list refetches.
  const typeParam = listParams.get("type")
  const typeFilter: TypeFilter | null = typeParam === "income" || typeParam === "expense" ? typeParam : null
  const categoryId = Number(listParams.get("category")) || null
  const categoryFilter = categoryId ? (categories.find((category) => category.id === categoryId) ?? null) : null
  const includedTagIds = parseTagIds(listParams, ["tag", "tags"])
  const excludedTagIds = parseTagIds(listParams, ["exclude_tags"])
  const tagMode: TagMode = excludedTagIds.length ? "exclude" : includedTagIds.length ? "include" : emptyTagMode
  const tagIds = tagMode === "exclude" ? excludedTagIds : includedTagIds
  const filterCount = (typeFilter ? 1 : 0) + (categoryId ? 1 : 0) + (tagIds.length ? 1 : 0)
  const period = periodFromSearch(searchParams, DEFAULT_PERIOD)
  const fromParam = searchParams.get("from")
  const origin =
    fromParam === "dashboard" || fromParam === "insights" || fromParam === "categories" || fromParam === "digest"
      ? ORIGINS[fromParam]
      : null
  // A drill-down names its slice, such as "Travel · Aug 2026".
  const title = origin
    ? [categoryFilter?.name, periodLabel(period, DEFAULT_PERIOD_PRESETS)].filter(Boolean).join(" · ")
    : "Transactions"
  const searchVisible = searchOpen || Boolean(searchQuery)

  const updateList = (updates: Record<string, string | null>, replace = false) =>
    setSearchParams(buildSearchParams(searchParams, { ...updates, page: "1" }), { replace })
  const setTypeFilter = (value: TypeFilter | null) => updateList({ type: value })
  const setCategoryFilter = (value: number | null) => updateList({ category: value ? String(value) : null })
  const setTagFilter = (mode: TagMode, ids: number[]) => {
    setEmptyTagMode(mode)
    updateList({
      tag: null,
      tags: mode === "include" ? serializeTagIds(ids) : null,
      exclude_tags: mode === "exclude" ? serializeTagIds(ids) : null,
    })
  }
  const clearFilters = () =>
    updateList({ type: null, category: null, tag: null, tags: null, exclude_tags: null, q: null })
  const setPeriod = (next: PeriodSelection) => {
    const params = writePeriodToSearch(searchParams, next)
    params.set("page", "1")
    setSearchParams(params)
  }
  const changePage = (nextPage: number) => setSearchParams(buildSearchParams(searchParams, { page: String(nextPage) }))

  const openPeek = (id: number) => {
    const next = new URLSearchParams(searchParams)
    next.set("peek", String(id))
    setSearchParams(next, { replace: peekId !== null })
  }
  const closePeek = () => {
    const next = new URLSearchParams(searchParams)
    next.delete("peek")
    setSearchParams(next, { replace: true })
  }
  // The full view's breadcrumb, and a delete there, return to the list without reopening the peek.
  const listSearch = new URLSearchParams(searchParams)
  listSearch.delete("peek")
  const listHref = `${location.pathname}${listSearch.toString() ? `?${listSearch.toString()}` : ""}`
  const peekLink = (id: number) => {
    const next = new URLSearchParams(searchParams)
    next.set("peek", String(id))
    return `${location.pathname}?${next.toString()}`
  }

  const exportParams = new URLSearchParams(listParams)
  exportParams.delete("page")
  const exportHref = `/api/transactions/export.csv?${exportParams.toString()}`

  // Selection
  const selectionCount = selection.mode === "ids" ? selection.ids.length : total
  const isChecked = (id: number) => selection.mode === "query" || selection.ids.includes(id)
  const setChecked = (id: number, checked: boolean) => {
    const current = selection.mode === "ids" ? selection.ids : items.map((row) => row.id)
    setSelection({
      mode: "ids",
      ids: checked ? [...current.filter((value) => value !== id), id] : current.filter((value) => value !== id),
    })
  }
  const clearSelection = () => {
    setSelection({ mode: "ids", ids: [] })
    setSelectMode(false)
  }

  const bulkPayload = (operation: BulkOperation) => {
    if (selection.mode === "ids") {
      return { selection: { mode: "ids", transaction_ids: selection.ids }, operation }
    }
    if (!settled) return null
    const settledTagMode: TagMode = settled.filters.excluded_tag_ids.length ? "exclude" : "include"
    return {
      selection: {
        mode: "query",
        query: {
          period: settled.period.slug,
          start: settled.period.slug === "custom" ? settled.period.start : null,
          end: settled.period.slug === "custom" ? settled.period.end : null,
          type: settled.filters.type === "income" || settled.filters.type === "expense" ? settled.filters.type : null,
          category: settled.filters.category_id,
          tag: null,
          tags: settledTagMode === "include" ? settled.filters.included_tag_ids : [],
          exclude_tags: settled.filters.excluded_tag_ids,
          q: settled.filters.query || null,
        },
      },
      operation,
    }
  }

  // Previews the change, confirms it with the affected count, then applies it.
  const runBulk = async (operation: BulkOperation, verb: string, confirmLabel: string): Promise<boolean> => {
    const payload = bulkPayload(operation)
    if (!payload) return false
    setBulkPending(true)
    try {
      const preview = await apiFetch<BulkResponse>("/api/transactions/bulk/preview", {
        method: "POST",
        body: JSON.stringify(payload),
      })
      const confirmed = await confirmDialog({
        title: `${verb} ${countLabel(preview.eligible_count)}?`,
        description: preview.skipped_count ? `${countLabel(preview.skipped_count)} will be skipped.` : undefined,
        tone: operation.lifecycle === "soft_delete" ? "danger" : "primary",
        confirmLabel,
      })
      if (!confirmed) return false
      const result = await apiFetch<BulkResponse>("/api/transactions/bulk/apply", {
        method: "POST",
        body: JSON.stringify(payload),
      })
      clearSelection()
      invalidateTransactionData(queryClient)
      void queryClient.invalidateQueries({ queryKey: ["transactions", "deleted"] })
      showToast({
        message:
          operation.lifecycle === "soft_delete"
            ? `Moved ${countLabel(result.eligible_count)} to Trash`
            : `Updated ${countLabel(result.eligible_count)}`,
      })
      return true
    } catch (failure) {
      showToast({ message: getApiErrorMessage(failure, "Unable to apply the bulk change.") })
      return false
    } finally {
      setBulkPending(false)
    }
  }
  const bulkCategory = (categoryId: number | null) =>
    void runBulk({ set_category_id: categoryId, tag_patch: null, lifecycle: "none" }, "Change the category of", "Apply")
  const bulkClearTags = () =>
    void runBulk({ set_category_id: null, tag_patch: { mode: "clear", tags: [] }, lifecycle: "none" }, "Clear tags on", "Clear tags")
  const bulkDelete = () =>
    void runBulk({ set_category_id: null, tag_patch: null, lifecycle: "soft_delete" }, "Delete", "Delete")
  const applyTagPatch = async () => {
    if (!tagPatch) return
    const applied = await runBulk(
      { set_category_id: null, tag_patch: { mode: tagPatch.mode, tags: tagPatch.tags }, lifecycle: "none" },
      TAG_PATCH_COPY[tagPatch.mode].verb,
      "Apply"
    )
    if (applied) setTagPatch(null)
  }

  // Rows by day. A band at a page edge may continue on the next or previous page, so it
  // shows no net rather than a partial one.
  const groups = groupByDay(items)
  const bandNet = (index: number): ReactNode => {
    if ((index === 0 && page > 1) || (index === groups.length - 1 && has_more)) return null
    return <Amount cents={dayNet(groups[index].rows)} kind="signed" />
  }

  const searchField = searchVisible ? (
    <TextField
      ref={searchInputRef}
      type="search"
      icon={MagnifyingGlassIcon}
      aria-label="Search transactions"
      placeholder="Search"
      value={searchQuery}
      onChange={(event) => updateList({ q: event.target.value || null }, true)}
      onBlur={() => setSearchOpen(false)}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return
        event.preventDefault()
        if (searchQuery) {
          // The first Esc clears; the field stays open for a second Esc, even when the query came from the URL.
          setSearchOpen(true)
          updateList({ q: null }, true)
        } else {
          setSearchOpen(false)
          searchButtonRef.current?.focus()
        }
      }}
    />
  ) : null

  const typePill = (
    <Menu
      label="Type"
      align="start"
      trigger={
        <Pill
          icon={ArrowsDownUpIcon}
          set={Boolean(typeFilter)}
          onClear={typeFilter ? () => setTypeFilter(null) : undefined}
          clearLabel="Clear type filter"
        >
          {typeFilter === "income" ? "Income" : typeFilter === "expense" ? "Expense" : "Type"}
        </Pill>
      }
    >
      <MenuItem checked={typeFilter === null} onSelect={() => setTypeFilter(null)}>
        All types
      </MenuItem>
      <MenuItem checked={typeFilter === "expense"} onSelect={() => setTypeFilter("expense")}>
        Expense
      </MenuItem>
      <MenuItem checked={typeFilter === "income"} onSelect={() => setTypeFilter("income")}>
        Income
      </MenuItem>
    </Menu>
  )
  const categoryPill = (
    <CategoryPicker
      grouped
      label="Category filter"
      categories={categories}
      selectedId={categoryId}
      onSelect={setCategoryFilter}
      trigger={
        <Pill
          icon={categoryFilter ? undefined : ShapesIcon}
          leading={
            categoryFilter ? (
              <CategoryGlyph categoryId={categoryFilter.id} icon={categoryFilter.icon} name={categoryFilter.name} />
            ) : undefined
          }
          set={Boolean(categoryFilter)}
          onClear={categoryFilter ? () => setCategoryFilter(null) : undefined}
          clearLabel="Clear category filter"
        >
          {categoryFilter?.name ?? "Category"}
        </Pill>
      }
    />
  )
  const tagLabel =
    tagIds.length === 1
      ? `${tagMode === "include" ? "Only" : "Excluding"}: ${tags.find((tag) => tag.id === tagIds[0])?.name ?? "1 tag"}`
      : `${tagMode === "include" ? "Only" : "Excluding"}: ${tagIds.length} tags`
  const tagPill = (
    <Popover
      form
      label="Tag filter"
      trigger={
        <Pill
          icon={TagIcon}
          set={tagIds.length > 0}
          onClear={tagIds.length ? () => setTagFilter(tagMode, []) : undefined}
          clearLabel="Clear tag filter"
        >
          {tagIds.length ? tagLabel : "Tag"}
        </Pill>
      }
    >
      <TagFilterOptions tags={tags} mode={tagMode} ids={tagIds} onChange={setTagFilter} />
    </Popover>
  )
  const filterSheet = (
    <Popover
      form
      label="Filter"
      align="end"
      trigger={
        <Pill icon={FunnelIcon} set={filterCount > 0}>
          {filterCount ? `Filter · ${filterCount}` : "Filter"}
        </Pill>
      }
    >
      <FieldGrid narrow>
        <Field label="Type">
          <SegmentedControl
            label="Type"
            fullWidth
            value={typeFilter ?? "all"}
            options={[
              { value: "all", label: "All" },
              { value: "expense", label: "Expense" },
              { value: "income", label: "Income" },
            ]}
            onChange={(next) => setTypeFilter(next === "all" ? null : next)}
          />
        </Field>
        <Field label="Category">
          <Select
            value={categoryId ?? ""}
            onChange={(event) => setCategoryFilter(event.target.value ? Number(event.target.value) : null)}
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </Field>
      </FieldGrid>
      <TagFilterOptions tags={tags} mode={tagMode} ids={tagIds} onChange={setTagFilter} />
    </Popover>
  )

  const first = (page - 1) * limit + 1
  const tagOptions = (tagsData?.tags ?? []).map((tag) => tag.name)

  return (
    <Panel
      title={title}
      parents={origin ? [origin] : undefined}
      peekOpen={peekId !== null}
      layout="fill"
      actions={
        <>
          <IconButton
            icon={MagnifyingGlassIcon}
            ref={searchButtonRef}
            label="Search"
            aria-expanded={searchVisible}
            onClick={() => {
              setSearchOpen(true)
              searchInputRef.current?.focus()
            }}
          />
          <Button variant="primary" icon={PlusIcon} aria-label="Add transaction" onClick={openAddTransaction}>
            {isDesktop ? "Add transaction" : "Add"}
          </Button>
          <Menu label="More actions" trigger={<IconButton icon={DotsThreeIcon} label="More actions" />}>
            {isDesktop ? null : (
              <MenuItem icon={CheckSquareIcon} onSelect={() => setSelectMode(true)}>
                Select
              </MenuItem>
            )}
            <MenuLink to="/transactions/deleted" icon={TrashIcon}>
              Trash
            </MenuLink>
            <MenuItem icon={DownloadSimpleIcon} onSelect={() => window.location.assign(exportHref)}>
              Export CSV
            </MenuItem>
            <MenuItem icon={PrinterIcon} disabled={printout !== null || total === 0} onSelect={() => void startPrint()}>
              Print…
            </MenuItem>
          </Menu>
        </>
      }
      viewRow={
        <ViewRow end={isDesktop ? null : filterSheet}>
          {searchField}
          <PeriodControl value={period} onChange={setPeriod} />
          {isDesktop ? (
            <>
              {typePill}
              {categoryPill}
              {tagPill}
              {filterCount || searchQuery ? (
                <Button variant="ghost" onClick={clearFilters}>
                  Clear
                </Button>
              ) : null}
            </>
          ) : (
            <>
              {typeFilter ? typePill : null}
              {categoryFilter ? categoryPill : null}
              {tagIds.length ? tagPill : null}
            </>
          )}
        </ViewRow>
      }
    >
      <PeekLayout
        main={
          <List
            label="Transactions"
            hasSelection={selectionCount > 0 || selecting}
            footer={
              items.length ? (
                <ListFooter>
                  {first}–{first + items.length - 1} of {total}
                  <IconButton icon={CaretLeftIcon} label="Previous page" disabled={page <= 1} onClick={() => changePage(page - 1)} />
                  <IconButton icon={CaretRightIcon} label="Next page" disabled={!has_more} onClick={() => changePage(page + 1)} />
                </ListFooter>
              ) : filterCount || searchQuery || period.slug !== "all" ? (
                <EmptyState
                  action={
                    filterCount || searchQuery ? (
                      <Button variant="quiet" onClick={clearFilters}>
                        Clear filters
                      </Button>
                    ) : (
                      <Button variant="quiet" onClick={() => setPeriod(DEFAULT_PERIOD)}>
                        Show all time
                      </Button>
                    )
                  }
                >
                  No matching transactions
                </EmptyState>
              ) : (
                <EmptyState>No transactions yet</EmptyState>
              )
            }
          >
            {groups.map((group, index) => (
              <Fragment key={`${group.date}-${index}`}>
                <DayBand ledger label={dayLabel(group.date)} end={bandNet(index)} />
                {group.rows.map((row) => (
                  <LedgerRow
                    key={row.id}
                    glyph={<CategoryGlyph categoryId={row.category?.id} icon={row.category?.icon} name={row.category?.name} />}
                    title={rowTitle(row)}
                    category={row.category?.name ?? "Uncategorized"}
                    tags={row.tags.map((tag) => tag.name)}
                    receipt={Boolean(row.has_attachments)}
                    location={row.latitude != null && row.longitude != null}
                    reimbursement={reimbursementOf(row)}
                    amount={<TransactionAmount row={row} markerColumn />}
                    selected={row.id === peekId}
                    checked={isChecked(row.id)}
                    selecting={selecting}
                    onCheckedChange={(checked) => setChecked(row.id, checked)}
                    onOpen={() => openPeek(row.id)}
                  />
                ))}
              </Fragment>
            ))}
          </List>
        }
        peek={
          peekId ? (
            <TransactionPeek
              key={peekId}
              id={peekId}
              onClose={closePeek}
              linkTo={peekLink}
              fullViewTo={`/transactions/${peekId}`}
              fullViewState={{ returnTo: listHref }}
            />
          ) : null
        }
      />
      <BulkBar
        count={selectionCount}
        active={selecting}
        onClear={clearSelection}
        selectionMenu={
          <>
            {selection.mode === "ids" && total > selectionCount ? (
              <MenuItem icon={ChecksIcon} disabled={!settled} onSelect={() => setSelection({ mode: "query" })}>
                Select all {total} matching
              </MenuItem>
            ) : null}
            <MenuItem icon={XIcon} onSelect={clearSelection}>
              Clear selection
            </MenuItem>
          </>
        }
      >
        {/* Bulk edits move rows to a category; they cannot clear one. */}
        <CategoryPicker
          grouped
          label="Set category"
          categories={categories}
          selectedId={undefined}
          onSelect={bulkCategory}
          trigger={
            <Button icon={ShapesIcon} aria-label="Category" disabled={bulkPending || selectionCount === 0}>
              {isDesktop ? "Category" : null}
            </Button>
          }
        />
        <Menu
          label="Tags"
          align="start"
          trigger={
            <Button icon={TagIcon} aria-label="Tags" disabled={bulkPending || selectionCount === 0}>
              {isDesktop ? "Tags" : null}
            </Button>
          }
        >
          <MenuItem icon={PlusIcon} onSelect={() => setTagPatch({ mode: "add", tags: [] })}>
            Add tags
          </MenuItem>
          <MenuItem icon={MinusIcon} onSelect={() => setTagPatch({ mode: "remove", tags: [] })}>
            Remove tags
          </MenuItem>
          <MenuItem icon={SwapIcon} onSelect={() => setTagPatch({ mode: "replace", tags: [] })}>
            Replace tags
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={EraserIcon} onSelect={bulkClearTags}>
            Clear tags
          </MenuItem>
        </Menu>
        <Button icon={TrashIcon} aria-label="Delete" disabled={bulkPending || selectionCount === 0} onClick={bulkDelete}>
          {isDesktop ? "Delete" : null}
        </Button>
      </BulkBar>
      <Dialog
        open={tagPatch !== null}
        onOpenChange={(open) => {
          if (!open) setTagPatch(null)
        }}
        title={tagPatch ? TAG_PATCH_COPY[tagPatch.mode].title : "Tags"}
        size="narrow"
        footer={
          <>
            <Button variant="ghost" onClick={() => setTagPatch(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!tagPatch?.tags.length || bulkPending}
              onClick={() => void applyTagPatch()}
            >
              Apply
            </Button>
          </>
        }
      >
        {tagPatch ? (
          <EntryChips>
            {tagPatch.tags.map((name) => (
              <TagChip
                key={name}
                onRemove={() => setTagPatch({ ...tagPatch, tags: tagPatch.tags.filter((entry) => entry !== name) })}
              >
                {name}
              </TagChip>
            ))}
            <TagPicker
              options={tagOptions}
              selected={tagPatch.tags}
              onChange={(next) => setTagPatch({ ...tagPatch, tags: next })}
              trigger={<Pill icon={TagIcon}>Choose tags</Pill>}
            />
          </EntryChips>
        ) : null}
      </Dialog>
      {printout !== null && printout !== "loading" ? (
        <PrintLedger list={printout.list} summary={printout.summary} onDone={endPrint} />
      ) : null}
    </Panel>
  )
}

export default TransactionsPage
