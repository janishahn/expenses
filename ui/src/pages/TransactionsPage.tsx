import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { MapPinIcon } from "@phosphor-icons/react/MapPin"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { DotsThreeVerticalIcon } from "@phosphor-icons/react/DotsThreeVertical"
import { PaperclipIcon } from "@phosphor-icons/react/Paperclip"
import { TrashIcon } from "@phosphor-icons/react/Trash"
import { XIcon } from "@phosphor-icons/react/X"
import { Link, useLocation, useNavigate, useOutletContext, useSearchParams } from "react-router-dom"
import type { AppShellOutletContext } from "../app/AppShell"
import { apiFetch } from "../app/api"
import { formatCoordinate, formatCurrency, formatEuroDate } from "../app/format"
import { mapTileAttribution, mapTileURL } from "../app/mapTiles"
import { CategoryIcon } from "../components/CategoryIcon"
import PageIntroAddButton from "../components/PageIntroAddButton"
import PageIntro from "../components/PageIntro"
import PeriodPicker from "../components/PeriodPicker"
import TransactionDescription from "../components/TransactionDescription"
import { AppButton } from "../components/ui/product-button"
import { AppCard } from "../components/ui/product-card"
import {
  AppFieldLabel,
  AppInput,
  AppNativeSelect,
} from "../components/ui/product-fields"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetClose,
  SheetHeader,
  SheetTitle,
} from "../components/ui/sheet"
import {
  buildCustomPeriodSearchParams,
  buildPresetPeriodSearchParams,
  buildSearchParams,
  type PresetPeriod,
} from "../lib/searchParams"
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png"
import markerIcon from "leaflet/dist/images/marker-icon.png"
import markerShadow from "leaflet/dist/images/marker-shadow.png"

type TransactionRow = {
  id: number
  date: string
  occurred_at: string
  type: string
  amount_cents: number
  net_amount_cents: number
  reimbursed_total_cents: number
  is_reimbursement: boolean
  category: { id: number; name: string; type: string; icon: string | null } | null
  title: string | null
  description: string | null
  latitude: number | null
  longitude: number | null
  tags: Array<{ id: number; name: string }>
  has_attachments: boolean
}

type TransactionsResponse = {
  items: TransactionRow[]
  page: number
  limit: number
  has_more: boolean
  period: { slug: string; start: string; end: string }
  filters: {
    type: string | null
    category_id: number | null
    tag_id: number | null
    query: string | null
  }
  categories: Array<{ id: number; name: string; type: string; icon: string | null }>
  tags: Array<{ id: number; name: string }>
}

type BulkOperation = {
  set_category_id: number | null
  tag_patch: null | { mode: "add" | "remove" | "replace" | "clear"; tags: string[] }
  lifecycle: "none" | "soft_delete" | "restore"
}

type BulkPayload = {
  selection:
    | { mode: "ids"; transaction_ids: number[] }
    | {
        mode: "query"
        query: {
          period: string
          start: string | null
          end: string | null
          type: "income" | "expense" | null
          category: number | null
          tag: number | null
          q: string | null
        }
      }
  operation: BulkOperation
}

type BulkResponse = {
  resolved_count: number
  eligible_count: number
  skipped_count: number
  sample_ids?: number[]
  changes: {
    category_changed: number
    tags_added: number
    tags_removed: number
    tags_replaced: number
    deleted: number
    restored: number
  }
}

type SearchTranslationResponse = {
  query: string
  confidence: number
  clarification_needed: boolean
  clarification_question?: string | null
}

function parseTagInput(raw: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const part of raw.split(",")) {
    const clean = part.trim()
    if (!clean) continue
    const lower = clean.toLowerCase()
    if (seen.has(lower)) continue
    seen.add(lower)
    out.push(clean)
  }
  return out
}

const transactionLocationMarkerIcon = L.icon({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  tooltipAnchor: [16, -28],
  shadowSize: [41, 41],
})

function TransactionLocationMap({
  latitude,
  longitude,
  title,
}: {
  latitude: number
  longitude: number
  title: string
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!containerRef.current) {
      return
    }

    const map = L.map(containerRef.current, {
      scrollWheelZoom: false,
      zoomControl: true,
    }).setView([latitude, longitude], 16)

    if (mapTileURL) {
      L.tileLayer(mapTileURL, {
        maxZoom: 19,
        attribution: mapTileAttribution,
      }).addTo(map)
    }

    L.marker([latitude, longitude], {
      title,
      icon: transactionLocationMarkerIcon,
    }).addTo(map)

    const invalidateTimer = window.setTimeout(() => {
      map.invalidateSize()
    }, 0)

    return () => {
      window.clearTimeout(invalidateTimer)
      map.remove()
    }
  }, [latitude, longitude, title])

  return (
    <div
      ref={containerRef}
      data-testid="transaction-location-map"
      className="h-full min-h-[18rem] w-full md:min-h-[28rem]"
    />
  )
}

function TransactionLocationDialog({
  transaction,
  onClose,
}: {
  transaction: TransactionRow
  onClose: () => void
}) {
  if (transaction.latitude === null || transaction.longitude === null) {
    return null
  }

  const isExpense = transaction.type === "expense"
  const amount = isExpense ? transaction.net_amount_cents : transaction.amount_cents
  const title = transaction.title || transaction.category?.name || "Untitled"

  return (
    <Dialog open onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        aria-label="Transaction location"
        className="max-h-[calc(100vh-1rem)] w-[calc(100%-1rem)] max-w-4xl p-4 md:max-h-[88vh] md:w-[calc(100%-2rem)]"
      >
        <DialogHeader>
          <DialogTitle className="sr-only">Transaction location</DialogTitle>
          <div className="min-w-0">
            <h2 className="truncate font-head text-xl font-bold tracking-tight text-text">{title}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              <span>{formatEuroDate(transaction.date)}</span>
              <span aria-hidden="true">·</span>
              <span>{transaction.category?.name ?? "Uncategorized"}</span>
              <span aria-hidden="true">·</span>
              <span
                className={`font-mono font-semibold ${
                  isExpense ? "text-semantic-red" : "text-semantic-green"
                }`}
              >
                {isExpense ? "-" : "+"}
                {formatCurrency(amount)} €
              </span>
            </div>
          </div>
          <DialogClose asChild>
            <AppButton
              tone="ghost"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border p-0 text-muted hover:border-border-hi hover:text-text"
              aria-label="Close transaction location"
            >
              <XIcon className="h-4 w-4" />
            </AppButton>
          </DialogClose>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="overflow-hidden rounded-xl border border-border bg-surface-hi/55">
            <TransactionLocationMap
              latitude={transaction.latitude}
              longitude={transaction.longitude}
              title={title}
            />
          </div>
          <p className="mt-3 font-mono text-xs text-muted">
            {formatCoordinate(transaction.latitude)},{" "}
            {formatCoordinate(transaction.longitude)}
          </p>
        </div>

        <div className="mt-4 flex justify-end">
          <AppButton type="button" onClick={onClose} tone="ghost">
            Close
          </AppButton>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function TransactionsPage() {
  const { openAddTransaction } = useOutletContext<AppShellOutletContext>()
  const queryClient = useQueryClient()
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [mobileType, setMobileType] = useState("")
  const [mobileCategory, setMobileCategory] = useState("")
  const [mobileTag, setMobileTag] = useState("")
  const [mobileQuery, setMobileQuery] = useState("")
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [bulkSelectionMode, setBulkSelectionMode] = useState<"ids" | "query">("ids")
  const [bulkCategoryId, setBulkCategoryId] = useState("")
  const [bulkTagMode, setBulkTagMode] = useState<"none" | "add" | "remove" | "replace" | "clear">("none")
  const [bulkTags, setBulkTags] = useState("")
  const [bulkLifecycle, setBulkLifecycle] = useState<"none" | "soft_delete" | "restore">("none")
  const [bulkPreview, setBulkPreview] = useState<BulkResponse | null>(null)
  const [bulkActionsOpen, setBulkActionsOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [mobileSelectMode, setMobileSelectMode] = useState(false)
  const [locationTransaction, setLocationTransaction] = useState<TransactionRow | null>(null)
  const [naturalQuery, setNaturalQuery] = useState("")
  const [naturalSearchMessage, setNaturalSearchMessage] = useState("")
  const [naturalSearchResult, setNaturalSearchResult] = useState<SearchTranslationResponse | null>(null)
  const [isDesktop, setIsDesktop] = useState(() =>
    window.matchMedia("(min-width: 861px)").matches
  )

  const returnTo = `${location.pathname}${location.search}`
  const queryString = useMemo(() => {
    const params = new URLSearchParams(searchParams)
    if (!params.get("period")) {
      params.set("period", "all")
    }
    if (!params.get("page")) {
      params.set("page", "1")
    }
    return params.toString()
  }, [searchParams])

  useEffect(() => {
    const media = window.matchMedia("(min-width: 861px)")
    const syncDesktop = () => {
      setIsDesktop(media.matches)
      if (media.matches) {
        setMobileFiltersOpen(false)
      }
    }
    syncDesktop()
    media.addEventListener("change", syncDesktop)
    return () => media.removeEventListener("change", syncDesktop)
  }, [])

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["transactions", queryString],
    queryFn: () => apiFetch<TransactionsResponse>(`/api/transactions?${queryString}`),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/transactions/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] })
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      queryClient.invalidateQueries({ queryKey: ["insights"] })
      queryClient.invalidateQueries({ queryKey: ["tag"] })
    },
  })

  const bulkPreviewMutation = useMutation({
    mutationFn: (payload: BulkPayload) =>
      apiFetch<BulkResponse>("/api/transactions/bulk/preview", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (result) => setBulkPreview(result),
  })

  const bulkApplyMutation = useMutation({
    mutationFn: (payload: BulkPayload) =>
      apiFetch<BulkResponse>("/api/transactions/bulk/apply", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (result) => {
      setBulkPreview(result)
      setSelectedIds([])
      queryClient.invalidateQueries({ queryKey: ["transactions"] })
      queryClient.invalidateQueries({ queryKey: ["transactions", "deleted"] })
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      queryClient.invalidateQueries({ queryKey: ["insights"] })
      queryClient.invalidateQueries({ queryKey: ["tag"] })
    },
  })

  const naturalSearchMutation = useMutation({
    mutationFn: (query: string) =>
      apiFetch<SearchTranslationResponse>("/api/ai/search/translate", {
        method: "POST",
        body: JSON.stringify({ query }),
      }),
    onSuccess: (result) => {
      if (result.clarification_needed || !result.query) {
        setNaturalSearchMessage(
          result.clarification_question || "Search could not be translated."
        )
        return
      }
      setNaturalSearchMessage("")
      setNaturalSearchResult(result)
      setQuery(result.query)
    },
    onError: (mutationError) => {
      setNaturalSearchResult(null)
      setNaturalSearchMessage(String(mutationError))
    },
  })

  const updateParam = (key: string, value: string | null) => {
    setSearchParams(buildSearchParams(searchParams, { [key]: value, page: "1" }))
  }

  const setPresetPeriod = (value: PresetPeriod) =>
    setSearchParams(
      buildPresetPeriodSearchParams(searchParams, value, { page: "1" })
    )

  const applyCustomPeriod = (start: string, end: string) =>
    setSearchParams(
      buildCustomPeriodSearchParams(searchParams, start, end, { page: "1" })
    )

  const setType = (value: string) => updateParam("type", value || null)
  const setCategory = (value: string) => updateParam("category", value || null)
  const setTag = (value: string) => updateParam("tag", value || null)
  const setQuery = (value: string) => updateParam("q", value || null)

  const changePage = (nextPage: number) => {
    setSearchParams(buildSearchParams(searchParams, { page: String(nextPage) }))
  }

  if (isLoading) {
    return <div className="text-muted">Loading transactions…</div>
  }
  if (error || !data) {
    return <div className="text-semantic-red">Unable to load transactions.</div>
  }

  const { items, has_more, page, period, filters, categories, tags } = data
  const categoriesById = new Map(categories.map((category) => [category.id, category]))
  const searchQuery = searchParams.get("q") ?? ""
  const categoryLabel = filters.category_id
    ? categories.find((category) => category.id === filters.category_id)?.name
    : null
  const tagLabel = filters.tag_id ? tags.find((tag) => tag.id === filters.tag_id)?.name : null
  const activeFilters = [
    filters.type ? `Type: ${filters.type}` : null,
    categoryLabel ? `Category: ${categoryLabel}` : null,
    tagLabel ? `Tag: ${tagLabel}` : null,
    searchQuery ? `Search: ${searchQuery}` : null,
  ].filter(Boolean) as string[]
  const exportParams = new URLSearchParams(searchParams)
  exportParams.delete("page")
  exportParams.delete("limit")
  const exportHref = `/api/transactions/export.csv?${exportParams.toString()}`

  const openMobileFilters = () => {
    setMobileType(filters.type ?? "")
    setMobileCategory(filters.category_id ? String(filters.category_id) : "")
    setMobileTag(filters.tag_id ? String(filters.tag_id) : "")
    setMobileQuery(searchQuery)
    setMobileFiltersOpen(true)
  }

  const clearFilters = () => {
    const params = new URLSearchParams(searchParams)
    params.delete("type")
    params.delete("category")
    params.delete("tag")
    params.delete("q")
    params.set("page", "1")
    setSearchParams(params)
  }

  const applyMobileFilters = () => {
    const params = new URLSearchParams(searchParams)
    if (mobileType) {
      params.set("type", mobileType)
    } else {
      params.delete("type")
    }
    if (mobileCategory) {
      params.set("category", mobileCategory)
    } else {
      params.delete("category")
    }
    if (mobileTag) {
      params.set("tag", mobileTag)
    } else {
      params.delete("tag")
    }
    if (mobileQuery.trim()) {
      params.set("q", mobileQuery.trim())
    } else {
      params.delete("q")
    }
    params.set("page", "1")
    setSearchParams(params)
    setMobileFiltersOpen(false)
  }

  const runNaturalSearch = () => {
    const query = naturalQuery.trim()
    if (!query) {
      return
    }
    naturalSearchMutation.mutate(query)
  }

  const allPageSelected =
    items.length > 0 && items.every((txn) => selectedIds.includes(txn.id))

  const toggleSelected = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]
    )
  }

  const toggleSelectAllPage = () => {
    if (allPageSelected) {
      const pageIds = new Set(items.map((txn) => txn.id))
      setSelectedIds((prev) => prev.filter((id) => !pageIds.has(id)))
      return
    }
    const merged = new Set(selectedIds)
    for (const item of items) {
      merged.add(item.id)
    }
    setSelectedIds(Array.from(merged))
  }

  const shouldIgnoreRowNavigation = (
    event: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>
  ) => {
    if (!(event.target instanceof Element)) {
      return false
    }
    const interactiveAncestor = event.target.closest(
      "a, button, input, label, select, textarea, summary, [role='button'], [role='link']"
    )
    return interactiveAncestor !== null && interactiveAncestor !== event.currentTarget
  }

  const openTransactionDetail = (transactionId: number) => {
    navigate(`/transactions/${transactionId}`, { state: { returnTo } })
  }

  const operationValid =
    bulkLifecycle !== "none" ||
    bulkCategoryId !== "" ||
    bulkTagMode !== "none"

  const buildBulkPayload = (): BulkPayload | null => {
    if (!operationValid) {
      return null
    }

    const operation: BulkOperation = {
      set_category_id: bulkCategoryId ? Number(bulkCategoryId) : null,
      tag_patch:
        bulkTagMode === "none"
          ? null
          : {
              mode: bulkTagMode,
              tags: parseTagInput(bulkTags),
            },
      lifecycle: bulkLifecycle,
    }

    if (bulkLifecycle !== "none") {
      operation.set_category_id = null
      operation.tag_patch = null
    }

    if (bulkSelectionMode === "ids") {
      if (!selectedIds.length) {
        return null
      }
      return {
        selection: {
          mode: "ids",
          transaction_ids: selectedIds,
        },
        operation,
      }
    }

    return {
      selection: {
        mode: "query",
        query: {
          period: period.slug,
          start: period.slug === "custom" ? period.start : null,
          end: period.slug === "custom" ? period.end : null,
          type:
            filters.type === "income" || filters.type === "expense"
              ? filters.type
              : null,
          category: filters.category_id,
          tag: filters.tag_id,
          q: searchQuery || null,
        },
      },
      operation,
    }
  }

  const runBulkPreview = () => {
    const payload = buildBulkPayload()
    if (!payload) {
      setBulkPreview(null)
      return
    }
    bulkPreviewMutation.mutate(payload)
  }

  const runBulkApply = () => {
    const payload = buildBulkPayload()
    if (!payload) {
      return
    }
    if (!confirm("Apply bulk changes to selected transactions?")) {
      return
    }
    bulkApplyMutation.mutate(payload)
  }

  return (
    <section className="space-y-5 md:space-y-6 desk:space-y-4">
      <PageIntro
        title="Transactions"
        titleAccessoryAlign="end"
        titleAccessory={
          !isDesktop ? (
            <div className="relative self-center">
              <AppButton
                type="button"
                onClick={() => setMobileMenuOpen((prev) => !prev)}
                tone="ghost"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border p-0 text-muted hover:border-border-hi hover:text-text"
                aria-label="More actions"
              >
                <DotsThreeVerticalIcon className="h-4 w-4" />
              </AppButton>
              {mobileMenuOpen && (
                <>
                  <button
                    type="button"
                    className="fixed inset-0 z-[60]"
                    aria-label="Close menu"
                    onClick={() => setMobileMenuOpen(false)}
                  />
                  <div
                    data-testid="transactions-mobile-actions-menu"
                    className="absolute right-0 top-full z-[61] mt-1 w-44 rounded-xl border border-border bg-surface p-1 shadow-lg"
                  >
                    <Link
                      to="/transactions/inbox"
                      className="block rounded-lg px-3 py-2 text-sm text-text hover:bg-faint"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      Inbox
                    </Link>
                    <Link
                      to="/transactions/deleted"
                      className="block rounded-lg px-3 py-2 text-sm text-text hover:bg-faint"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      Trash
                    </Link>
                    <a
                      href={exportHref}
                      className="block rounded-lg px-3 py-2 text-sm text-text hover:bg-faint"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      Export CSV
                    </a>
                    <button
                      type="button"
                      className="w-full rounded-lg px-3 py-2 text-left text-sm text-text hover:bg-faint"
                      onClick={() => {
                        setMobileSelectMode(true)
                        setMobileMenuOpen(false)
                      }}
                    >
                      Select
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : null
        }
        actions={
          isDesktop || isFetching ? (
            <>
              {isFetching ? <span className="loading-hint">Updating…</span> : null}
              <AppButton asChild tone="inline" className="hidden desk:inline-flex">
                <Link to="/transactions/inbox">Inbox</Link>
              </AppButton>
              <AppButton asChild tone="inline" className="hidden desk:inline-flex">
                <Link to="/transactions/deleted">Trash</Link>
              </AppButton>
              <AppButton asChild tone="inline" className="hidden desk:inline-flex">
                <a href={exportHref}>Export CSV</a>
              </AppButton>
              <PageIntroAddButton onClick={openAddTransaction} />
            </>
          ) : null
        }
      />

      <PeriodPicker
        periodSlug={period.slug}
        start={period.start}
        end={period.end}
        onSetPreset={setPresetPeriod}
        onApplyCustom={applyCustomPeriod}
      />

      <AppCard className="hidden gap-4 p-4 desk:grid desk:grid-cols-4">
        <AppFieldLabel>
          <span>Type</span>
          <div className="pill-group">
            {[
              { value: "", label: "All" },
              { value: "income", label: "Income" },
              { value: "expense", label: "Expense" },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => setType(item.value)}
                className={`pill-button ${(filters.type ?? "") === item.value ? "pill-button-active" : ""}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </AppFieldLabel>
        <AppFieldLabel>
          <span>Category</span>
          <AppNativeSelect
            value={filters.category_id ?? ""}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name} ({category.type})
              </option>
            ))}
          </AppNativeSelect>
        </AppFieldLabel>
        <AppFieldLabel>
          <span>Tag</span>
          <AppNativeSelect
            value={filters.tag_id ?? ""}
            onChange={(event) => setTag(event.target.value)}
          >
            <option value="">All tags</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </AppNativeSelect>
        </AppFieldLabel>
        <AppFieldLabel>
          <span>Search</span>
          <AppInput
            type="text"
            value={searchQuery}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="title text or: tag:Work amount>20 has:receipt"
          />
        </AppFieldLabel>
        <div className="desk:col-span-4">
          <div className="flex flex-col gap-2 md:flex-row">
            <AppInput
              type="text"
              value={naturalQuery}
              onChange={(event) => setNaturalQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  runNaturalSearch()
                }
              }}
              placeholder="Ask in plain language"
            />
            <AppButton
              type="button"
              onClick={runNaturalSearch}
              disabled={naturalSearchMutation.isPending || !naturalQuery.trim()}
              className="shrink-0"
            >
              {naturalSearchMutation.isPending ? "Translating…" : "Translate"}
            </AppButton>
          </div>
          {naturalSearchMessage ? (
            <p className="mt-2 text-xs text-semantic-red">{naturalSearchMessage}</p>
          ) : null}
          {naturalSearchResult && !naturalSearchMessage ? (
            <p className="mt-2 text-xs text-muted">
              Applied: <span className="font-mono text-text">{naturalSearchResult.query}</span>
              {" · "}
              {Math.round(naturalSearchResult.confidence * 100)}% confidence
            </p>
          ) : null}
        </div>
      </AppCard>

      <div className="desk:hidden">
        <div className="flex items-center gap-2">
          <AppButton
            type="button"
            onClick={openMobileFilters}
            tone="ghost"
            className="flex-1 text-xs"
          >
            Filters {activeFilters.length ? `(${activeFilters.length})` : ""}
          </AppButton>
          {activeFilters.length > 0 && (
            <AppButton
              type="button"
              onClick={clearFilters}
              tone="ghost"
              className="text-xs text-muted"
            >
              Clear
            </AppButton>
          )}
        </div>
        {activeFilters.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {activeFilters.map((filter) => (
              <span key={filter} className="chip text-[11px]">
                {filter}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="hidden flex-wrap items-center gap-2 rounded-xl border border-border bg-faint px-3 py-2 desk:flex">
        <AppButton
          type="button"
          onClick={toggleSelectAllPage}
          tone="ghost"
          className="px-3 py-1 text-xs"
        >
          {allPageSelected ? "Unselect page" : "Select page"}
        </AppButton>
        <span className="text-xs text-muted">{selectedIds.length} selected</span>
        <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
          <AppButton
            type="button"
            onClick={() => setBulkSelectionMode("ids")}
            tone="ghost"
            className={bulkSelectionMode === "ids" ? "border-accent text-accent" : "text-muted"}
          >
            Selected only
          </AppButton>
          <AppButton
            type="button"
            onClick={() => setBulkSelectionMode("query")}
            tone="ghost"
            className={bulkSelectionMode === "query" ? "border-accent text-accent" : "text-muted"}
          >
            All filtered
          </AppButton>
          <AppButton
            type="button"
            onClick={() => setBulkActionsOpen((prev) => !prev)}
            tone="ghost"
            className={bulkActionsOpen ? "border-accent bg-accent/10 text-accent" : ""}
          >
            Bulk edit
          </AppButton>
        </div>
      </div>

      {(mobileSelectMode || selectedIds.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-faint px-3 py-2 desk:hidden">
          <AppButton
            type="button"
            onClick={toggleSelectAllPage}
            tone="ghost"
            className="px-3 py-1 text-xs"
          >
            {allPageSelected ? "Unselect page" : "Select page"}
          </AppButton>
          <span className="min-w-0 flex-1 truncate text-xs text-muted">
            {selectedIds.length} selected
          </span>
          <div className="ml-auto flex items-center gap-2">
            <AppButton
              type="button"
              onClick={() => setBulkActionsOpen(true)}
              tone="ghost"
              className="px-3 py-1 text-xs"
            >
              Bulk edit
            </AppButton>
            <AppButton
              type="button"
              onClick={() => {
                setMobileSelectMode(false)
                setSelectedIds([])
              }}
              tone="ghost"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full p-0 text-muted"
              aria-label="Exit selection"
            >
              <XIcon className="h-4 w-4" />
            </AppButton>
          </div>
        </div>
      )}

      {bulkActionsOpen && (
        <AppCard className="hidden p-4 desk:block">
          <div className="grid gap-3 desk:grid-cols-4">
            <AppFieldLabel>
              <span>Lifecycle</span>
              <AppNativeSelect
                value={bulkLifecycle}
                onChange={(event) => setBulkLifecycle(event.target.value as "none" | "soft_delete" | "restore")}
              >
                <option value="none">None</option>
                <option value="soft_delete">Soft delete</option>
                <option value="restore">Restore</option>
              </AppNativeSelect>
            </AppFieldLabel>
            <AppFieldLabel>
              <span>Set category</span>
              <AppNativeSelect
                value={bulkCategoryId}
                disabled={bulkLifecycle !== "none"}
                onChange={(event) => setBulkCategoryId(event.target.value)}
              >
                <option value="">No change</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name} ({category.type})
                  </option>
                ))}
              </AppNativeSelect>
            </AppFieldLabel>
            <AppFieldLabel>
              <span>Tag patch</span>
              <AppNativeSelect
                value={bulkTagMode}
                disabled={bulkLifecycle !== "none"}
                onChange={(event) =>
                  setBulkTagMode(
                    event.target.value as "none" | "add" | "remove" | "replace" | "clear"
                  )
                }
              >
                <option value="none">No change</option>
                <option value="add">Add tags</option>
                <option value="remove">Remove tags</option>
                <option value="replace">Replace tags</option>
                <option value="clear">Clear tags</option>
              </AppNativeSelect>
            </AppFieldLabel>
            <AppFieldLabel>
              <span>Tags (comma)</span>
              <AppInput
                type="text"
                value={bulkTags}
                disabled={bulkLifecycle !== "none" || bulkTagMode === "none" || bulkTagMode === "clear"}
                onChange={(event) => setBulkTags(event.target.value)}
                placeholder="work, travel"
              />
            </AppFieldLabel>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <AppButton
              type="button"
              onClick={runBulkPreview}
              disabled={bulkPreviewMutation.isPending || !operationValid}
              tone="ghost"
            >
              {bulkPreviewMutation.isPending ? "Previewing…" : "Preview"}
            </AppButton>
            <AppButton
              type="button"
              onClick={runBulkApply}
              disabled={bulkApplyMutation.isPending || !operationValid}
            >
              {bulkApplyMutation.isPending ? "Applying…" : "Apply"}
            </AppButton>
            {(bulkPreviewMutation.error || bulkApplyMutation.error) && (
              <span className="text-xs text-semantic-red">
                {String(bulkPreviewMutation.error || bulkApplyMutation.error)}
              </span>
            )}
          </div>
          {bulkPreview && (
            <div className="mt-3 rounded-lg border border-border bg-surface-hi/55 p-3 text-xs text-muted">
              <p>
                Resolved {bulkPreview.resolved_count}, skipped {bulkPreview.skipped_count}
              </p>
              <p>
                Category {bulkPreview.changes.category_changed}, tags +
                {bulkPreview.changes.tags_added}/-{bulkPreview.changes.tags_removed}, replaced{" "}
                {bulkPreview.changes.tags_replaced}
              </p>
              <p>
                Deleted {bulkPreview.changes.deleted}, restored {bulkPreview.changes.restored}
              </p>
            </div>
          )}
        </AppCard>
      )}

      {bulkActionsOpen && !isDesktop ? (
        <Sheet open={bulkActionsOpen} onOpenChange={setBulkActionsOpen}>
          <SheetContent aria-label="Bulk edit" side="bottom" className="max-h-[88vh]">
            <SheetHeader className="flex-row items-center justify-between px-5 pt-5 pb-0">
              <SheetTitle className="text-sm">Bulk edit</SheetTitle>
              <SheetClose asChild>
                <AppButton
                  tone="ghost"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border p-0 text-muted hover:border-border-hi hover:text-text"
                  aria-label="Close bulk edit"
                >
                  <XIcon className="h-4 w-4" />
                </AppButton>
              </SheetClose>
            </SheetHeader>
            <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-5 py-4">
              <AppFieldLabel>
                <span>Lifecycle</span>
                <AppNativeSelect
                  value={bulkLifecycle}
                  onChange={(event) => setBulkLifecycle(event.target.value as "none" | "soft_delete" | "restore")}
                >
                  <option value="none">None</option>
                  <option value="soft_delete">Soft delete</option>
                  <option value="restore">Restore</option>
                </AppNativeSelect>
              </AppFieldLabel>
              <AppFieldLabel>
                <span>Set category</span>
                <AppNativeSelect
                  value={bulkCategoryId}
                  disabled={bulkLifecycle !== "none"}
                  onChange={(event) => setBulkCategoryId(event.target.value)}
                >
                  <option value="">No change</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name} ({category.type})
                    </option>
                  ))}
                </AppNativeSelect>
              </AppFieldLabel>
              <AppFieldLabel>
                <span>Tag patch</span>
                <AppNativeSelect
                  value={bulkTagMode}
                  disabled={bulkLifecycle !== "none"}
                  onChange={(event) =>
                    setBulkTagMode(
                      event.target.value as "none" | "add" | "remove" | "replace" | "clear"
                    )
                  }
                >
                  <option value="none">No change</option>
                  <option value="add">Add tags</option>
                  <option value="remove">Remove tags</option>
                  <option value="replace">Replace tags</option>
                  <option value="clear">Clear tags</option>
                </AppNativeSelect>
              </AppFieldLabel>
              <AppFieldLabel>
                <span>Tags (comma)</span>
                <AppInput
                  type="text"
                  value={bulkTags}
                  disabled={bulkLifecycle !== "none" || bulkTagMode === "none" || bulkTagMode === "clear"}
                  onChange={(event) => setBulkTags(event.target.value)}
                  placeholder="work, travel"
                />
              </AppFieldLabel>
              {bulkPreview && (
                <div className="rounded-lg border border-border bg-surface-hi/55 p-3 text-xs text-muted">
                  <p>
                    Resolved {bulkPreview.resolved_count}, skipped {bulkPreview.skipped_count}
                  </p>
                  <p>
                    Category {bulkPreview.changes.category_changed}, tags +
                    {bulkPreview.changes.tags_added}/-{bulkPreview.changes.tags_removed}, replaced{" "}
                    {bulkPreview.changes.tags_replaced}
                  </p>
                  <p>
                    Deleted {bulkPreview.changes.deleted}, restored {bulkPreview.changes.restored}
                  </p>
                </div>
              )}
              {(bulkPreviewMutation.error || bulkApplyMutation.error) && (
                <p className="text-xs text-semantic-red">
                  {String(bulkPreviewMutation.error || bulkApplyMutation.error)}
                </p>
              )}
            </div>
            <div className="mt-1 flex shrink-0 gap-2 px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">
              <AppButton
                type="button"
                onClick={runBulkPreview}
                disabled={bulkPreviewMutation.isPending || !operationValid}
                tone="ghost"
              >
                {bulkPreviewMutation.isPending ? "Previewing…" : "Preview"}
              </AppButton>
              <AppButton
                type="button"
                onClick={() => setBulkActionsOpen(false)}
                tone="ghost"
              >
                Cancel
              </AppButton>
              <AppButton
                type="button"
                onClick={runBulkApply}
                disabled={bulkApplyMutation.isPending || !operationValid}
                className="flex-1"
              >
                {bulkApplyMutation.isPending ? "Applying…" : "Apply"}
              </AppButton>
            </div>
          </SheetContent>
        </Sheet>
      ) : null}

      {mobileFiltersOpen && !isDesktop ? (
        <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
          <SheetContent aria-label="Transaction filters" side="bottom" className="max-h-[88vh]">
            <SheetHeader className="flex-row items-center justify-between px-5 pt-5 pb-0">
              <SheetTitle className="text-sm">Transaction filters</SheetTitle>
              <SheetClose asChild>
                <AppButton
                  tone="ghost"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border p-0 text-muted hover:border-border-hi hover:text-text"
                  aria-label="Close filters"
                >
                  <XIcon className="h-4 w-4" />
                </AppButton>
              </SheetClose>
            </SheetHeader>
            <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-5 py-4">
              <AppFieldLabel>
                <span>Type</span>
                <div className="pill-group">
                  {[
                    { value: "", label: "All" },
                    { value: "income", label: "Income" },
                    { value: "expense", label: "Expense" },
                  ].map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => setMobileType(item.value)}
                      className={`pill-button ${mobileType === item.value ? "pill-button-active" : ""}`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </AppFieldLabel>
              <AppFieldLabel>
                <span>Category</span>
                <AppNativeSelect
                  value={mobileCategory}
                  onChange={(event) => setMobileCategory(event.target.value)}
                >
                  <option value="">All categories</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name} ({category.type})
                    </option>
                  ))}
                </AppNativeSelect>
              </AppFieldLabel>
              <AppFieldLabel>
                <span>Tag</span>
                <AppNativeSelect
                  value={mobileTag}
                  onChange={(event) => setMobileTag(event.target.value)}
                >
                  <option value="">All tags</option>
                  {tags.map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name}
                    </option>
                  ))}
                </AppNativeSelect>
              </AppFieldLabel>
              <AppFieldLabel>
                <span>Search</span>
                <AppInput
                  type="text"
                  value={mobileQuery}
                  onChange={(event) => setMobileQuery(event.target.value)}
                  placeholder="tag:Work amount>20"
                />
              </AppFieldLabel>
            </div>
            <div className="mt-1 flex shrink-0 gap-2 px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">
              <AppButton
                type="button"
                onClick={() => {
                  clearFilters()
                  setMobileFiltersOpen(false)
                }}
                tone="ghost"
              >
                Clear
              </AppButton>
              <AppButton
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                tone="ghost"
              >
                Cancel
              </AppButton>
              <AppButton
                type="button"
                onClick={applyMobileFilters}
                className="flex-1"
              >
                Apply
              </AppButton>
            </div>
          </SheetContent>
        </Sheet>
      ) : null}

      {locationTransaction ? (
        <TransactionLocationDialog
          transaction={locationTransaction}
          onClose={() => setLocationTransaction(null)}
        />
      ) : null}

      <div className="space-y-3">
        {items.length ? (
          items.map((txn) => {
            const isExpense = txn.type === "expense"
            const amount = isExpense ? txn.net_amount_cents : txn.amount_cents
            const category = txn.category
              ? (categoriesById.get(txn.category.id) ?? txn.category)
              : null
            return (
              <AppCard
                key={txn.id}
                role="link"
                tabIndex={0}
                onClick={(event) => {
                  if (
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.altKey ||
                    event.shiftKey ||
                    shouldIgnoreRowNavigation(event)
                  ) {
                    return
                  }
                  openTransactionDetail(txn.id)
                }}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget || event.key !== "Enter") {
                    return
                  }
                  event.preventDefault()
                  openTransactionDetail(txn.id)
                }}
                className={`cursor-pointer flex flex-col gap-3 p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 sm:flex-row sm:items-center sm:justify-between ${
                  isExpense ? "border-l-2 border-l-semantic-red/55" : "border-l-2 border-l-semantic-green/55"
                }`}
              >
                <div className="flex items-start gap-3 md:items-center">
                  <input
                    type="checkbox"
                    aria-label={`Select transaction ${txn.id}`}
                    checked={selectedIds.includes(txn.id)}
                    onChange={() => toggleSelected(txn.id)}
                    className={`control-check self-start md:self-center ${mobileSelectMode || selectedIds.length > 0 ? "" : "hidden desk:block"}`}
                  />
                  <CategoryIcon icon={category?.icon ?? null} />
                  <div>
                    <p className="font-semibold text-text">
                      {txn.title || category?.name || "Untitled"}
                    </p>
                    <TransactionDescription
                      markdown={txn.description}
                      compact
                      clamp
                      className="mt-1"
                    />
                    <p className="text-xs text-muted">
                      {formatEuroDate(txn.date)} · {category?.name ?? "Uncategorized"}
                    </p>
                    {(txn.latitude !== null && txn.longitude !== null) || txn.has_attachments ? (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {txn.latitude !== null && txn.longitude !== null ? (
                          <AppButton
                            type="button"
                            onClick={() => setLocationTransaction(txn)}
                            tone="inline"
                            aria-label={`View location for ${txn.title || category?.name || "Untitled"}`}
                          >
                            <MapPinIcon className="h-3.5 w-3.5" />
                            Location
                          </AppButton>
                        ) : null}
                        {txn.has_attachments ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-muted">
                            <PaperclipIcon className="h-3 w-3" />
                            Receipt
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    {txn.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {txn.tags.map((tag) => (
                          <span key={tag.id} className="chip">
                            {tag.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 sm:block sm:text-right">
                  <p
                    className={`font-mono text-sm font-semibold tabular-nums ${
                      isExpense ? "text-semantic-red" : "text-semantic-green"
                    }`}
                  >
                    {isExpense ? "-" : "+"}
                    {formatCurrency(amount)} €
                  </p>
                  {isExpense && txn.reimbursed_total_cents > 0 && (
                    <p className="font-mono text-xs text-semantic-green">
                      Reimb {formatCurrency(txn.reimbursed_total_cents)} €
                    </p>
                  )}
                  <div className="flex items-center gap-2 sm:mt-2 sm:justify-end">
                    <AppButton
                      type="button"
                      onClick={() => {
                        if (!confirm("Delete this transaction?")) {
                          return
                        }
                        deleteMutation.mutate(txn.id)
                      }}
                      disabled={deleteMutation.isPending}
                      tone="inlineDanger"
                      className="hidden desk:inline-flex"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                      Delete
                    </AppButton>
                  </div>
                </div>
              </AppCard>
            )
          })
        ) : (
          <AppCard className="p-6 text-center text-sm text-muted">No transactions found.</AppCard>
        )}
      </div>

      <div className="flex items-center justify-between">
        <AppButton
          type="button"
          onClick={() => changePage(Math.max(1, page - 1))}
          disabled={page <= 1}
          tone="ghost"
          className="px-4 py-2 text-xs text-muted disabled:opacity-40"
        >
          Previous
        </AppButton>
        <p className="text-xs text-muted">Page {page}</p>
        <AppButton
          type="button"
          onClick={() => changePage(page + 1)}
          disabled={!has_more}
          tone="ghost"
          className="px-4 py-2 text-xs text-muted disabled:opacity-40"
        >
          Next
        </AppButton>
      </div>
    </section>
  )
}

export default TransactionsPage
