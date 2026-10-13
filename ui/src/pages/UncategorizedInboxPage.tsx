import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { CaretLeftIcon } from "@phosphor-icons/react/CaretLeft"
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight"
import { CheckIcon } from "@phosphor-icons/react/Check"
import { CheckSquareIcon } from "@phosphor-icons/react/CheckSquare"
import { ChecksIcon } from "@phosphor-icons/react/Checks"
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree"
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass"
import { ShapesIcon } from "@phosphor-icons/react/Shapes"
import { XIcon } from "@phosphor-icons/react/X"
import { Navigate, useLocation, useSearchParams } from "react-router-dom"
import { apiFetch, getApiErrorMessage } from "../app/api"
import type { CategorySummary, TransactionListItem, TransactionsResponse } from "../app/api-types"
import { dayLabel, invalidateTransactionData } from "../app/transactions"
import { CategoryPicker } from "../components/CategoryPicker"
import { confirmDialog } from "../components/confirm"
import { Amount } from "../components/ui/Amount"
import { BulkBar } from "../components/ui/BulkBar"
import { Button, IconButton } from "../components/ui/Button"
import { CategoryGlyph, UnknownGlyph } from "../components/ui/CategoryGlyph"
import { EmptyState } from "../components/ui/EmptyState"
import { useIsDesktop } from "../components/ui/layout-state"
import {
  AmountCell,
  Cell,
  List,
  ListFooter,
  ListHead,
  Row,
  RowActions,
  RowLead,
  type Columns,
} from "../components/ui/LedgerRow"
import { Menu, MenuItem } from "../components/ui/Menu"
import { Panel, PanelError, PanelLoading, ViewRow } from "../components/ui/Panel"
import { PeekLayout } from "../components/ui/Peek"
import { PeriodControl } from "../components/ui/PeriodControl"
import { periodFromSearch, writePeriodToSearch, type PeriodSelection } from "../components/ui/period"
import { Pill } from "../components/ui/Pill"
import { Confidence, SuggestionBox } from "../components/ui/SuggestionBox"
import { TextField } from "../components/ui/TextField"
import { showToast } from "../components/ui/toast-store"
import { buildSearchParams } from "../lib/searchParams"
import { TransactionPeek } from "./TransactionRecord"

type Suggestion = { category_id: number; confidence: number }

type InboxItem = TransactionListItem & { suggestion: Suggestion | null }

type InboxResponse = Omit<TransactionsResponse, "items"> & {
  items: InboxItem[]
  definition: { category_name: string; matched_category_ids: number[] }
}

type BulkResponse = { eligible_count: number; skipped_count: number }

// Every selected row, or every row matching the search and period across pages.
type Selection = { mode: "ids"; ids: number[] } | { mode: "query" }

const LIST_KEYS = ["period", "start", "end", "q", "page"]
const DEFAULT_PERIOD: PeriodSelection = { slug: "all" }

// Suggestions add the Confidence and accept/reject columns. A narrow list, usually beside the peek,
// keeps only the glyph, title, confidence and amount; the peek holds the suggestion and its actions.
const SUGGESTION_COLUMNS: Columns = {
  columns: "14px 18px minmax(160px, 1fr) 80px 170px 76px 60px 110px",
  narrowColumns: "14px 18px minmax(0, 1fr) 72px 110px",
  mobileColumns: "18px minmax(0, 1fr) 72px auto",
}
const CATEGORY_COLUMNS: Columns = {
  columns: "14px 18px minmax(160px, 1fr) 80px 170px 110px",
  narrowColumns: "14px 18px minmax(0, 1fr) 110px",
  mobileColumns: "18px minmax(0, 1fr) auto",
}

function rowTitle(row: InboxItem): string {
  return row.title || "Untitled"
}

function countLabel(count: number): string {
  return `${count} transaction${count === 1 ? "" : "s"}`
}

function UncategorizedInboxPage() {
  const queryClient = useQueryClient()
  const location = useLocation()
  const isDesktop = useIsDesktop()
  const [searchParams, setSearchParams] = useSearchParams()
  const peekId = Number(searchParams.get("peek")) || null
  const searchQuery = searchParams.get("q") ?? ""
  const [bulkPending, setBulkPending] = useState(false)

  // The server sees only the list's own parameters, never the open peek.
  const queryString = useMemo(() => {
    const params = new URLSearchParams()
    for (const key of LIST_KEYS) {
      const value = searchParams.get(key)
      if (value) params.set(key, value)
    }
    if (!params.get("period")) params.set("period", "all")
    if (!params.get("page")) params.set("page", "1")
    return params.toString()
  }, [searchParams])

  // A selection belongs to the search and page it was made on; a change starts a new one.
  const [selectionState, setSelectionState] = useState<{ query: string; selection: Selection }>({
    query: queryString,
    selection: { mode: "ids", ids: [] },
  })
  const selection: Selection = selectionState.query === queryString ? selectionState.selection : { mode: "ids", ids: [] }
  const setSelection = (next: Selection) => setSelectionState({ query: queryString, selection: next })
  // Mobile rows have no hover checkbox; Select in the ⋯ menu turns row taps into toggles.
  const [selectMode, setSelectMode] = useState(false)
  const selecting = selectMode && !isDesktop

  const { data, isLoading, isFetching, isPlaceholderData, error } = useQuery({
    queryKey: ["transactions", "uncategorized", queryString],
    queryFn: () => apiFetch<InboxResponse>(`/api/transactions/uncategorized?${queryString}`),
  })
  // Suggestions come from local automatic categorization; while it is off, every row offers the Category pill.
  const autoCategorization = useQuery({
    queryKey: ["settings", "auto-categorization"],
    queryFn: () => apiFetch<{ enabled: boolean }>("/api/settings/auto-categorization"),
  })
  // Query-wide bulk edits trust only a count fetched for the current search.
  const settled = isFetching || isPlaceholderData ? undefined : data

  if (isLoading || autoCategorization.isLoading) {
    return <PanelLoading title="Uncategorized" label="Loading uncategorized transactions…" />
  }
  if (error || !data) {
    return <PanelError title="Uncategorized" message="Unable to load uncategorized transactions." />
  }

  const { items, has_more, page, limit, total, categories, definition } = data
  // Categorizing the last rows of a later page moves to the last page that has rows.
  if (!items.length && page > 1 && total > 0 && !isPlaceholderData) {
    return (
      <>
        <Navigate replace to={{ search: buildSearchParams(searchParams, { page: String(Math.ceil(total / limit)) }).toString() }} />
        <PanelLoading title="Uncategorized" label="Loading uncategorized transactions…" />
      </>
    )
  }
  const suggestionsOn = autoCategorization.data?.enabled === true
  const columns = suggestionsOn ? SUGGESTION_COLUMNS : CATEGORY_COLUMNS
  // Moving a row to Uncategorized would leave it here, so pickers never offer it.
  const targets = categories.filter((category) => !definition.matched_category_ids.includes(category.id))
  const targetsFor = (row: InboxItem) => targets.filter((category) => category.type === row.type)
  const suggestionFor = (row: InboxItem): { category: CategorySummary; confidence: number } | null => {
    const category = row.suggestion ? targets.find((entry) => entry.id === row.suggestion?.category_id) : undefined
    return row.suggestion && category ? { category, confidence: row.suggestion.confidence } : null
  }
  const period = periodFromSearch(searchParams, DEFAULT_PERIOD)

  const updateList = (updates: Record<string, string | null>, replace = false) =>
    setSearchParams(buildSearchParams(searchParams, { ...updates, page: "1" }), { replace })
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
  const peekLink = (id: number) => {
    const next = new URLSearchParams(searchParams)
    next.set("peek", String(id))
    return `${location.pathname}?${next.toString()}`
  }
  // The full view's breadcrumb returns to this list without reopening the peek.
  const listSearch = new URLSearchParams(searchParams)
  listSearch.delete("peek")
  const listHref = `${location.pathname}${listSearch.toString() ? `?${listSearch.toString()}` : ""}`

  const applyCategory = (ids: number[], categoryId: number) =>
    apiFetch<BulkResponse>("/api/transactions/bulk/apply", {
      method: "POST",
      body: JSON.stringify({
        selection: { mode: "ids", transaction_ids: ids },
        operation: { set_category_id: categoryId, tag_patch: null, lifecycle: "none" },
      }),
    })

  // Files one row under a category; Undo puts it back under Uncategorized.
  const categorize = async (row: InboxItem, category: CategorySummary) => {
    const previousId = row.category?.id
    try {
      await applyCategory([row.id], category.id)
    } catch (failure) {
      showToast({ message: getApiErrorMessage(failure, "Unable to categorize the transaction.") })
      return
    }
    if (peekId === row.id) closePeek()
    invalidateTransactionData(queryClient)
    showToast({
      message: `Moved to ${category.name}`,
      action:
        previousId === undefined
          ? undefined
          : {
              label: "Undo",
              onClick: async () => {
                try {
                  await applyCategory([row.id], previousId)
                } catch (failure) {
                  showToast({ message: getApiErrorMessage(failure, "Unable to undo the change.") })
                  return
                }
                invalidateTransactionData(queryClient)
              },
            },
    })
  }
  // Keeps the row here and stops suggesting that category for it.
  const reject = async (row: InboxItem, category: CategorySummary) => {
    try {
      await apiFetch(`/api/transactions/${row.id}/category-suggestion/dismiss`, {
        method: "POST",
        body: JSON.stringify({ category_id: category.id }),
      })
    } catch (failure) {
      showToast({ message: getApiErrorMessage(failure, "Unable to reject the suggestion.") })
      return
    }
    void queryClient.invalidateQueries({ queryKey: ["transactions", "uncategorized"] })
  }

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
  const bulkSelection = () => {
    if (selection.mode === "ids") return { mode: "ids", transaction_ids: selection.ids }
    if (!settled) return null
    return {
      mode: "query",
      query: {
        period: settled.period.slug,
        start: settled.period.slug === "custom" ? settled.period.start : null,
        end: settled.period.slug === "custom" ? settled.period.end : null,
        type: null,
        category: null,
        matched_category_ids: settled.definition.matched_category_ids,
        tag: null,
        q: settled.filters.query || null,
      },
    }
  }
  // Previews the change, confirms it with the affected count, then applies it.
  const bulkCategory = async (categoryId: number | null) => {
    const bulk = bulkSelection()
    if (categoryId === null || !bulk) return
    const payload = { selection: bulk, operation: { set_category_id: categoryId, tag_patch: null, lifecycle: "none" } }
    setBulkPending(true)
    try {
      const preview = await apiFetch<BulkResponse>("/api/transactions/bulk/preview", {
        method: "POST",
        body: JSON.stringify(payload),
      })
      const confirmed = await confirmDialog({
        title: `Change the category of ${countLabel(preview.eligible_count)}?`,
        description: preview.skipped_count ? `${countLabel(preview.skipped_count)} will be skipped.` : undefined,
        tone: "primary",
        confirmLabel: "Apply",
      })
      if (!confirmed) return
      const result = await apiFetch<BulkResponse>("/api/transactions/bulk/apply", {
        method: "POST",
        body: JSON.stringify(payload),
      })
      clearSelection()
      invalidateTransactionData(queryClient)
      showToast({ message: `Updated ${countLabel(result.eligible_count)}` })
    } catch (failure) {
      showToast({ message: getApiErrorMessage(failure, "Unable to apply the bulk change.") })
    } finally {
      setBulkPending(false)
    }
  }

  const categoryPill = (row: InboxItem, suggested: CategorySummary | null) => (
    <CategoryPicker
      grouped={false}
      categories={targetsFor(row)}
      selectedId={undefined}
      onSelect={(categoryId) => {
        const category = targets.find((entry) => entry.id === categoryId)
        if (category) void categorize(row, category)
      }}
      trigger={
        suggested ? (
          <Pill
            leading={<CategoryGlyph categoryId={suggested.id} icon={suggested.icon} name={suggested.name} inline />}
            aria-label={`Suggested category ${suggested.name}, change`}
          >
            {suggested.name}
          </Pill>
        ) : (
          <Pill icon={ShapesIcon}>Category</Pill>
        )
      }
    />
  )

  const peekRow = items.find((row) => row.id === peekId)
  const peekSuggestion = peekRow && suggestionsOn ? suggestionFor(peekRow) : null
  const first = (page - 1) * limit + 1
  const filtered = Boolean(searchQuery) || period.slug !== "all"

  return (
    <Panel
      title="Uncategorized"
      parents={[{ label: "Transactions", to: "/transactions" }]}
      peekOpen={peekId !== null}
      layout="fill"
      actions={
        isDesktop ? null : (
          <Menu label="More actions" trigger={<IconButton icon={DotsThreeIcon} label="More actions" />}>
            <MenuItem icon={CheckSquareIcon} onSelect={() => setSelectMode(true)}>
              Select
            </MenuItem>
          </Menu>
        )
      }
      viewRow={
        <ViewRow>
          <PeriodControl value={period} onChange={setPeriod} />
          <TextField
            type="search"
            icon={MagnifyingGlassIcon}
            aria-label="Search uncategorized transactions"
            placeholder="Search"
            value={searchQuery}
            onChange={(event) => updateList({ q: event.target.value || null }, true)}
          />
        </ViewRow>
      }
    >
      <PeekLayout
        main={
          <List
            label="Uncategorized transactions"
            hasSelection={selectionCount > 0 || selecting}
            footer={
              items.length ? (
                <ListFooter>
                  {first}–{first + items.length - 1} of {total}
                  <IconButton icon={CaretLeftIcon} label="Previous page" disabled={page <= 1} onClick={() => changePage(page - 1)} />
                  <IconButton icon={CaretRightIcon} label="Next page" disabled={!has_more} onClick={() => changePage(page + 1)} />
                </ListFooter>
              ) : isPlaceholderData ? null : filtered ? (
                <EmptyState
                  action={
                    searchQuery ? (
                      <Button variant="quiet" onClick={() => updateList({ q: null })}>
                        Clear search
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
                <EmptyState>No uncategorized transactions</EmptyState>
              )
            }
          >
            {items.length ? (
              <ListHead {...columns}>
                <Cell hide="mobile" />
                <span />
                <span>Title</span>
                <Cell hide="narrow">Date</Cell>
                <Cell hide="narrow">{suggestionsOn ? "Suggestion" : "Category"}</Cell>
                {suggestionsOn ? (
                  <>
                    <Cell align="right">Confidence</Cell>
                    <Cell hide="narrow" />
                  </>
                ) : null}
                <Cell align="right">Amount</Cell>
              </ListHead>
            ) : null}
            {items.map((row) => {
              const suggestion = suggestionsOn ? suggestionFor(row) : null
              const title = rowTitle(row)
              return (
                <Row
                  key={row.id}
                  {...columns}
                  label={title}
                  selected={row.id === peekId || isChecked(row.id)}
                  onOpen={selecting ? () => setChecked(row.id, !isChecked(row.id)) : () => openPeek(row.id)}
                >
                  <RowLead
                    glyph={
                      suggestion ? (
                        <CategoryGlyph
                          categoryId={suggestion.category.id}
                          icon={suggestion.category.icon}
                          name={suggestion.category.name}
                        />
                      ) : (
                        <UnknownGlyph />
                      )
                    }
                    title={title}
                    checked={isChecked(row.id)}
                    selecting={selecting}
                    onCheckedChange={(checked) => setChecked(row.id, checked)}
                  />
                  <Cell strong>{title}</Cell>
                  <Cell tone="muted" hide="narrow">
                    {dayLabel(row.date)}
                  </Cell>
                  <Cell hide="narrow">{categoryPill(row, suggestion?.category ?? null)}</Cell>
                  {suggestionsOn ? (
                    <>
                      <Confidence value={suggestion?.confidence ?? null} />
                      <Cell hide="narrow">
                        {suggestion ? (
                          <RowActions>
                            <IconButton icon={CheckIcon} label="Accept" onClick={() => void categorize(row, suggestion.category)} />
                            <IconButton icon={XIcon} label="Reject" onClick={() => void reject(row, suggestion.category)} />
                          </RowActions>
                        ) : null}
                      </Cell>
                    </>
                  ) : null}
                  <AmountCell>
                    <Amount cents={row.amount_cents} kind={row.type === "income" ? "income" : "expense"} />
                  </AmountCell>
                </Row>
              )
            })}
          </List>
        }
        peek={
          peekId ? (
            <TransactionPeek
              key={peekId}
              id={peekId}
              parent="Uncategorized"
              onClose={closePeek}
              linkTo={peekLink}
              fullViewTo={`/transactions/${peekId}`}
              fullViewState={{ returnTo: listHref, returnLabel: "Uncategorized" }}
              lead={
                peekRow && peekSuggestion ? (
                  <SuggestionBox
                    leading={
                      <CategoryGlyph
                        categoryId={peekSuggestion.category.id}
                        icon={peekSuggestion.category.icon}
                        name={peekSuggestion.category.name}
                      />
                    }
                    name={peekSuggestion.category.name}
                    confidence={peekSuggestion.confidence}
                  >
                    <Button variant="primary" icon={CheckIcon} onClick={() => void categorize(peekRow, peekSuggestion.category)}>
                      Accept
                    </Button>
                    <Button variant="quiet" onClick={() => void reject(peekRow, peekSuggestion.category)}>
                      Reject
                    </Button>
                  </SuggestionBox>
                ) : null
              }
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
        <CategoryPicker
          grouped
          label="Set category"
          categories={targets}
          selectedId={undefined}
          onSelect={(categoryId) => void bulkCategory(categoryId)}
          trigger={
            <Button icon={ShapesIcon} aria-label="Category" disabled={bulkPending || selectionCount === 0}>
              {isDesktop ? "Category" : null}
            </Button>
          }
        />
      </BulkBar>
    </Panel>
  )
}

export default UncategorizedInboxPage
