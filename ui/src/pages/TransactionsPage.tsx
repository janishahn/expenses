import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { MapPinIcon } from "@phosphor-icons/react/MapPin"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FunnelSimpleIcon } from "@phosphor-icons/react/FunnelSimple"
import { DownloadSimpleIcon } from "@phosphor-icons/react/DownloadSimple"
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree"
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass"
import { PaperclipIcon } from "@phosphor-icons/react/Paperclip"
import { TrashIcon } from "@phosphor-icons/react/Trash"
import { TrayIcon } from "@phosphor-icons/react/Tray"
import { XIcon } from "@phosphor-icons/react/X"
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom"
import { apiFetch } from "../app/api"
import { formatCoordinate, formatCurrency, formatEuroDate } from "../app/format"
import { mapTileAttribution, mapTileURL } from "../app/mapTiles"
import { CategoryIcon } from "../components/CategoryIcon"
import PageIntro from "../components/PageIntro"
import PeriodPicker from "../components/PeriodPicker"
import { WorkspaceToolbar } from "../components/product/ProductSurfaces"
import SegmentedControl from "../components/SegmentedControl"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu"
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

type TransactionSummary = {
  income_cents: number
  expense_cents: number
  net_cents: number
  count: number
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
  const queryClient = useQueryClient()
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const searchQuery = searchParams.get("q") ?? ""
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [mobileType, setMobileType] = useState("")
  const [mobileCategory, setMobileCategory] = useState("")
  const [mobileTag, setMobileTag] = useState("")
  const [mobilePeriod, setMobilePeriod] = useState({
    slug: "all",
    start: "",
    end: "",
  })
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [bulkSelectionMode, setBulkSelectionMode] = useState<"ids" | "query">("ids")
  const [bulkCategoryId, setBulkCategoryId] = useState("")
  const [bulkTagMode, setBulkTagMode] = useState<"none" | "add" | "remove" | "replace" | "clear">("none")
  const [bulkTags, setBulkTags] = useState("")
  const [bulkLifecycle, setBulkLifecycle] = useState<"none" | "soft_delete" | "restore">("none")
  const [bulkPreview, setBulkPreview] = useState<BulkResponse | null>(null)
  const [bulkActionsOpen, setBulkActionsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const searchContainerRef = useRef<HTMLDivElement | null>(null)
  const [locationTransaction, setLocationTransaction] = useState<TransactionRow | null>(null)
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
  const summaryQueryString = useMemo(() => {
    const params = new URLSearchParams(searchParams)
    if (!params.get("period")) {
      params.set("period", "all")
    }
    params.delete("page")
    params.delete("limit")
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

  // Desktop keeps the bar open while a query is active (it shows the query inline).
  // Mobile closes freely; the active-search chip below the toolbar carries the query.
  const searchVisible = searchOpen || (isDesktop && Boolean(searchQuery))

  useEffect(() => {
    if (searchVisible) {
      searchInputRef.current?.focus()
    }
  }, [searchVisible])

  useEffect(() => {
    if (!searchOpen) {
      return
    }
    const handlePointerDown = (event: PointerEvent) => {
      const container = searchContainerRef.current
      if (container && !container.contains(event.target as Node)) {
        setSearchOpen(false)
      }
    }
    document.addEventListener("pointerdown", handlePointerDown)
    return () => document.removeEventListener("pointerdown", handlePointerDown)
  }, [searchOpen])

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["transactions", queryString],
    queryFn: () => apiFetch<TransactionsResponse>(`/api/transactions?${queryString}`),
  })
  const {
    data: summary,
    isError: summaryUnavailable,
    isPlaceholderData: summaryIsStale,
  } = useQuery({
    queryKey: ["transactions", "summary", summaryQueryString],
    queryFn: () =>
      apiFetch<TransactionSummary>(
        `/api/transactions/summary?${summaryQueryString}`,
      ),
  })
  // Placeholder data is the previous filter's summary; query-wide bulk edits
  // must only trust a count fetched for the current filters.
  const settledSummary = summaryIsStale ? undefined : summary

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/transactions/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] })
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      queryClient.invalidateQueries({ queryKey: ["insights"] })
      queryClient.invalidateQueries({ queryKey: ["budgets"] })
      queryClient.invalidateQueries({ queryKey: ["forecast"] })
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
      setBulkSelectionMode("ids")
      queryClient.invalidateQueries({ queryKey: ["transactions"] })
      queryClient.invalidateQueries({ queryKey: ["transactions", "deleted"] })
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      queryClient.invalidateQueries({ queryKey: ["insights"] })
      queryClient.invalidateQueries({ queryKey: ["budgets"] })
      queryClient.invalidateQueries({ queryKey: ["forecast"] })
      queryClient.invalidateQueries({ queryKey: ["tag"] })
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
  const categoryLabel = filters.category_id
    ? categories.find((category) => category.id === filters.category_id)?.name
    : null
  const tagLabel = filters.tag_id ? tags.find((tag) => tag.id === filters.tag_id)?.name : null
  const periodContext = `${formatEuroDate(period.start)} – ${formatEuroDate(period.end)}`
  const periodLabel =
    period.slug === "this_month"
      ? "This month"
      : period.slug === "last_month"
        ? "Last month"
        : period.slug === "custom"
          ? periodContext
          : null
  const activeFilters = [
    periodLabel
      ? { key: "period", label: `Period: ${periodLabel}` }
      : null,
    filters.type ? { key: "type", label: `Type: ${filters.type}` } : null,
    categoryLabel ? { key: "category", label: `Category: ${categoryLabel}` } : null,
    tagLabel ? { key: "tag", label: `Tag: ${tagLabel}` } : null,
    searchQuery ? { key: "q", label: `Search: ${searchQuery}` } : null,
  ].filter(Boolean) as Array<{ key: string; label: string }>
  const mobileFilterCount =
    Number(period.slug !== "all") +
    Number(Boolean(filters.type)) +
    Number(Boolean(filters.category_id)) +
    Number(Boolean(filters.tag_id))
  const exportParams = new URLSearchParams(searchParams)
  exportParams.delete("page")
  exportParams.delete("limit")
  const exportHref = `/api/transactions/export.csv?${exportParams.toString()}`

  const openMobileFilters = () => {
    setMobilePeriod(period)
    setMobileType(filters.type ?? "")
    setMobileCategory(filters.category_id ? String(filters.category_id) : "")
    setMobileTag(filters.tag_id ? String(filters.tag_id) : "")
    setMobileFiltersOpen(true)
  }

  const clearFilters = () => {
    const params = new URLSearchParams(searchParams)
    params.set("period", "all")
    params.delete("start")
    params.delete("end")
    params.delete("type")
    params.delete("category")
    params.delete("tag")
    params.delete("q")
    params.set("page", "1")
    setSearchParams(params)
  }

  const clearFilter = (key: string) => {
    if (key === "period") {
      setPresetPeriod("all")
      return
    }
    updateParam(key, null)
  }

  const applyMobileFilters = () => {
    const params = new URLSearchParams(searchParams)
    params.set("period", mobilePeriod.slug)
    if (mobilePeriod.slug === "custom") {
      params.set("start", mobilePeriod.start)
      params.set("end", mobilePeriod.end)
    } else {
      params.delete("start")
      params.delete("end")
    }
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
    params.set("page", "1")
    setSearchParams(params)
    setMobileFiltersOpen(false)
  }

  const allPageSelected =
    items.length > 0 && items.every((txn) => selectedIds.includes(txn.id))

  const toggleSelected = (id: number) => {
    const nextSelectedIds = selectedIds.includes(id)
      ? selectedIds.filter((value) => value !== id)
      : [...selectedIds, id]
    setSelectedIds(nextSelectedIds)
    setBulkPreview(null)
    if (!nextSelectedIds.length) {
      setBulkSelectionMode("ids")
      setBulkActionsOpen(false)
    }
  }

  const toggleSelectAllPage = () => {
    setBulkPreview(null)
    if (allPageSelected) {
      const pageIds = new Set(items.map((txn) => txn.id))
      const nextSelectedIds = selectedIds.filter((id) => !pageIds.has(id))
      setSelectedIds(nextSelectedIds)
      if (!nextSelectedIds.length) {
        setBulkSelectionMode("ids")
        setBulkActionsOpen(false)
      }
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
  const bulkScopeCountReady =
    bulkSelectionMode === "ids" || settledSummary !== undefined

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

    if (!settledSummary) {
      return null
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

  const dismissBulkPreview = () => {
    setBulkPreview(null)
    if (!selectedIds.length) {
      setBulkActionsOpen(false)
    }
  }

  return (
    <section className="min-w-0 space-y-3 md:space-y-4">
      <PageIntro
        title="Transactions"
        inlineActions
        actions={
          <>
            {isFetching ? <span className="loading-hint">Updating…</span> : null}
            <div className="relative z-20 flex shrink-0 items-center gap-2.5">
              <div ref={searchContainerRef} className="desk:relative">
                <AppButton
                  type="button"
                  onClick={() => {
                    if (!searchVisible) {
                      setSearchOpen(true)
                    } else if (isDesktop && searchQuery) {
                      searchInputRef.current?.focus()
                    } else {
                      setSearchOpen(false)
                    }
                  }}
                  tone="secondary"
                  className="transaction-search-trigger relative z-40 h-11 w-11 shrink-0 p-0"
                  aria-label="Search transactions"
                  aria-controls="transaction-search"
                  aria-expanded={searchVisible}
                >
                  <MagnifyingGlassIcon className="h-4 w-4" aria-hidden="true" />
                </AppButton>
                <div
                  id="transaction-search"
                  data-open={searchVisible}
                  aria-hidden={!searchVisible}
                  className="transaction-search-popover absolute z-30"
                >
                  <div className="flex min-w-0 items-center gap-2 desk:absolute desk:inset-y-0 desk:right-0 desk:w-[var(--search-bar-width)] desk:gap-1.5 desk:pr-12">
                    <AppInput
                      ref={searchInputRef}
                      type="search"
                      aria-label="Search transactions"
                      disabled={!searchVisible}
                      value={searchQuery}
                      onChange={(event) => setQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault()
                          if (searchQuery) {
                            setQuery("")
                          } else {
                            setSearchOpen(false)
                          }
                        }
                      }}
                      placeholder="Search titles and descriptions…"
                      className="min-w-0 flex-1"
                    />
                    {searchQuery ? (
                      <AppButton
                        type="button"
                        onClick={() => {
                          setSearchOpen(true)
                          setQuery("")
                          searchInputRef.current?.focus()
                        }}
                        tone="ghost"
                        className="h-11 w-11 shrink-0 p-0 desk:h-9 desk:min-h-0 desk:w-9"
                        aria-label="Clear search"
                      >
                        <XIcon className="h-4 w-4" aria-hidden="true" />
                      </AppButton>
                    ) : null}
                  </div>
                </div>
              </div>
              <AppButton
                type="button"
                onClick={openMobileFilters}
                tone="secondary"
                className="relative h-11 w-11 shrink-0 p-0 desk:hidden"
                aria-label={
                  mobileFilterCount
                    ? `Filters, ${mobileFilterCount} active`
                    : "Filters"
                }
              >
                <FunnelSimpleIcon className="h-4 w-4" aria-hidden="true" />
                {mobileFilterCount ? (
                  <span
                    className="absolute -right-1 -top-1 grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-full bg-accent px-1 font-mono text-[10px] text-[rgb(var(--accent-contrast))]"
                    aria-hidden="true"
                  >
                    {mobileFilterCount}
                  </span>
                ) : null}
              </AppButton>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <AppButton
                    tone="secondary"
                    className="h-11 w-11 shrink-0 p-0 desk:hidden"
                    aria-label="More actions"
                  >
                    <DotsThreeIcon weight="bold" className="h-5 w-5" aria-hidden="true" />
                  </AppButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link to="/transactions/inbox">
                      <TrayIcon className="h-4 w-4" aria-hidden="true" />
                      Inbox
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/transactions/deleted">
                      <TrashIcon className="h-4 w-4" aria-hidden="true" />
                      Trash
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={exportHref}>
                      <DownloadSimpleIcon className="h-4 w-4" aria-hidden="true" />
                      Export CSV
                    </a>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <AppButton asChild tone="secondary" className="hidden desk:inline-flex">
                <Link to="/transactions/inbox">
                  <TrayIcon className="h-4 w-4" aria-hidden="true" />
                  Inbox
                </Link>
              </AppButton>
              <AppButton asChild tone="secondary" className="hidden desk:inline-flex">
                <Link to="/transactions/deleted">
                  <TrashIcon className="h-4 w-4" aria-hidden="true" />
                  Trash
                </Link>
              </AppButton>
              <AppButton asChild tone="secondary" className="hidden desk:inline-flex">
                <a href={exportHref}>
                  <DownloadSimpleIcon className="h-4 w-4" aria-hidden="true" />
                  Export CSV
                </a>
              </AppButton>
            </div>
          </>
        }
      />

      <WorkspaceToolbar
        data-testid="transactions-control-zone"
        className="hidden gap-3 p-3 desk:flex md:p-4"
      >
        <div className="hidden w-full min-w-0 flex-wrap items-end gap-3 desk:flex">
          <div className="w-96 min-w-0 space-y-1.5">
            <span className="text-xs font-semibold text-muted">Period</span>
            <PeriodPicker
              periodSlug={period.slug}
              start={period.start}
              end={period.end}
              onSetPreset={setPresetPeriod}
              onApplyCustom={applyCustomPeriod}
            />
          </div>
          <AppFieldLabel className="w-fit min-w-0">
            <span>Type</span>
            <SegmentedControl
              value={filters.type ?? ""}
              ariaLabel="Transaction type"
              className="w-fit"
              items={[
                { value: "", label: "All" },
                { value: "income", label: "Income" },
                { value: "expense", label: "Expense" },
              ]}
              onValueChange={(value) => updateParam("type", value || null)}
            />
          </AppFieldLabel>
          <div className="flex flex-1 items-end gap-3">
            <AppFieldLabel className="min-w-40 max-w-72 flex-1">
              <span>Category</span>
              <AppNativeSelect
                className="h-12"
                value={filters.category_id ?? ""}
                onChange={(event) => updateParam("category", event.target.value || null)}
              >
                <option value="">All categories</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </AppNativeSelect>
            </AppFieldLabel>
            <AppFieldLabel className="min-w-40 max-w-72 flex-1">
              <span>Tag</span>
              <AppNativeSelect
                className="h-12"
                value={filters.tag_id ?? ""}
                onChange={(event) => updateParam("tag", event.target.value || null)}
              >
                <option value="">All tags</option>
                {tags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </AppNativeSelect>
            </AppFieldLabel>
            {activeFilters.length ? (
              <AppButton
                type="button"
                onClick={clearFilters}
                tone="ghost"
                className="h-12 w-12 shrink-0 gap-1.5 p-0 xl:w-auto xl:px-3"
                aria-label="Clear filters"
                title="Clear filters"
              >
                <XIcon className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="sr-only xl:not-sr-only">Clear filters</span>
              </AppButton>
            ) : null}
          </div>
        </div>

      </WorkspaceToolbar>

      {activeFilters.length ? (
        <div className="flex min-w-0 flex-wrap gap-1.5 desk:hidden">
          {activeFilters.map((filter) => (
            <button
              key={filter.key}
              type="button"
              onClick={() => clearFilter(filter.key)}
              className="chip inline-flex max-w-full items-center gap-1.5 text-[11px]"
              aria-label={`Remove ${filter.label}`}
            >
              <span className="truncate">{filter.label}</span>
              <XIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : null}

      <div
        data-testid="transactions-register"
        className="financial-panel financial-panel-ledger min-w-0"
      >
        <div
          data-testid="transactions-selection-controls"
          className="flex min-h-14 items-center gap-2 border-b border-border bg-faint/70 px-3 py-1.5 md:px-4"
        >
          <label className="-ml-2 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center">
            <input
              type="checkbox"
              aria-label={allPageSelected ? "Unselect current page" : "Select current page"}
              checked={allPageSelected}
              disabled={!items.length}
              onChange={toggleSelectAllPage}
              className="control-check disabled:opacity-40"
            />
          </label>
          <span className="min-w-0 flex-1 truncate text-xs text-muted">
            {selectedIds.length
              ? `${selectedIds.length} selected`
              : summary
                ? `${summary.count} matching transactions`
                : summaryUnavailable
                  ? "Matching count unavailable"
                  : "Counting matching transactions…"}
          </span>

          {selectedIds.length ? (
            <>
              <div className="hidden flex-wrap items-center gap-2 text-xs desk:flex">
                <SegmentedControl
                  value={bulkSelectionMode}
                  ariaLabel="Bulk edit scope"
                  className="[&_.segmented-control-button]:min-h-9 [&_.segmented-control-button]:px-3"
                  items={[
                    { value: "ids", label: "Selected only" },
                    {
                      value: "query",
                      label: settledSummary
                        ? `All ${settledSummary.count} filtered`
                        : "Counting filtered…",
                      disabled: !settledSummary,
                    },
                  ]}
                  onValueChange={(value) => {
                    setBulkSelectionMode(value)
                    setBulkPreview(null)
                  }}
                />
                <AppButton
                  type="button"
                  onClick={() => setBulkActionsOpen((prev) => !prev)}
                  tone="primary"
                  aria-expanded={bulkActionsOpen}
                >
                  Bulk edit
                </AppButton>
                <AppButton
                  type="button"
                  onClick={() => {
                    setSelectedIds([])
                    setBulkSelectionMode("ids")
                    setBulkPreview(null)
                    setBulkActionsOpen(false)
                  }}
                  tone="ghost"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full p-0 text-muted"
                  aria-label="Clear selection"
                >
                  <XIcon className="h-4 w-4" aria-hidden="true" />
                </AppButton>
              </div>
              <div className="flex shrink-0 items-center gap-1.5 desk:hidden">
                <AppButton
                  type="button"
                  onClick={() => setBulkActionsOpen(true)}
                  tone="primary"
                >
                  Bulk edit
                </AppButton>
                <AppButton
                  type="button"
                  onClick={() => {
                    setSelectedIds([])
                    setBulkSelectionMode("ids")
                    setBulkPreview(null)
                    setBulkActionsOpen(false)
                  }}
                  tone="ghost"
                  className="h-11 w-11 p-0"
                  aria-label="Clear selection"
                >
                  <XIcon className="h-4 w-4" aria-hidden="true" />
                </AppButton>
              </div>
            </>
          ) : (
            <span className="shrink-0 text-xs text-muted">Page {page}</span>
          )}
        </div>

        {bulkActionsOpen && (selectedIds.length > 0 || bulkPreview !== null) && (
          <div className="hidden border-b border-border p-4 desk:block">
          {selectedIds.length > 0 && (
          <>
          <div className="grid gap-3 desk:grid-cols-4">
            <AppFieldLabel>
              <span>Lifecycle</span>
              <AppNativeSelect
                value={bulkLifecycle}
                onChange={(event) => {
                  setBulkLifecycle(event.target.value as "none" | "soft_delete" | "restore")
                  setBulkPreview(null)
                }}
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
                onChange={(event) => {
                  setBulkCategoryId(event.target.value)
                  setBulkPreview(null)
                }}
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
                onChange={(event) => {
                  setBulkTagMode(
                    event.target.value as "none" | "add" | "remove" | "replace" | "clear"
                  )
                  setBulkPreview(null)
                }}
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
                onChange={(event) => {
                  setBulkTags(event.target.value)
                  setBulkPreview(null)
                }}
                placeholder="work, travel"
              />
            </AppFieldLabel>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <AppButton
              type="button"
              onClick={runBulkPreview}
              disabled={
                bulkPreviewMutation.isPending ||
                !operationValid ||
                !bulkScopeCountReady
              }
              tone="ghost"
            >
              {bulkPreviewMutation.isPending ? "Previewing…" : "Preview"}
            </AppButton>
            <AppButton
              type="button"
              onClick={runBulkApply}
              disabled={
                bulkApplyMutation.isPending ||
                !operationValid ||
                !bulkScopeCountReady
              }
            >
              {bulkApplyMutation.isPending ? "Applying…" : "Apply"}
            </AppButton>
            {(bulkPreviewMutation.error || bulkApplyMutation.error) && (
              <span className="text-xs text-semantic-red">
                {String(bulkPreviewMutation.error || bulkApplyMutation.error)}
              </span>
            )}
          </div>
          </>
          )}
          {bulkPreview && (
            <div
              className={`${selectedIds.length ? "mt-3 " : ""}rounded-lg border border-border bg-surface-hi/55 p-3 text-xs text-muted`}
            >
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
              <AppButton
                type="button"
                tone="inline"
                className="mt-2"
                onClick={dismissBulkPreview}
              >
                Dismiss
              </AppButton>
            </div>
          )}
          </div>
        )}

        {bulkActionsOpen && (selectedIds.length > 0 || bulkPreview !== null) && !isDesktop ? (
        <Sheet open={bulkActionsOpen} onOpenChange={setBulkActionsOpen}>
          <SheetContent aria-label="Bulk edit" side="bottom" className="max-h-[88vh]">
            <SheetHeader>
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
              {selectedIds.length > 0 && (
              <>
              <AppFieldLabel>
                <span>Apply to</span>
                <SegmentedControl
                  value={bulkSelectionMode}
                  ariaLabel="Bulk edit scope"
                  equalWidth
                  items={[
                    { value: "ids", label: `${selectedIds.length} selected` },
                    {
                      value: "query",
                      label: settledSummary
                        ? `All ${settledSummary.count} matching`
                        : summaryUnavailable
                          ? "Count unavailable"
                          : "Counting matching…",
                      disabled: !settledSummary,
                    },
                  ]}
                  onValueChange={(value) => {
                    setBulkSelectionMode(value as "ids" | "query")
                    setBulkPreview(null)
                  }}
                />
              </AppFieldLabel>
              <AppFieldLabel>
                <span>Lifecycle</span>
                <AppNativeSelect
                  value={bulkLifecycle}
                  onChange={(event) => {
                    setBulkLifecycle(event.target.value as "none" | "soft_delete" | "restore")
                    setBulkPreview(null)
                  }}
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
                  onChange={(event) => {
                    setBulkCategoryId(event.target.value)
                    setBulkPreview(null)
                  }}
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
                  onChange={(event) => {
                    setBulkTagMode(
                      event.target.value as "none" | "add" | "remove" | "replace" | "clear"
                    )
                    setBulkPreview(null)
                  }}
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
                  onChange={(event) => {
                    setBulkTags(event.target.value)
                    setBulkPreview(null)
                  }}
                  placeholder="work, travel"
                />
              </AppFieldLabel>
              </>
              )}
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
              {selectedIds.length > 0 ? (
                <>
                  <AppButton
                    type="button"
                    onClick={runBulkPreview}
                    disabled={
                      bulkPreviewMutation.isPending ||
                      !operationValid ||
                      !bulkScopeCountReady
                    }
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
                    disabled={
                      bulkApplyMutation.isPending ||
                      !operationValid ||
                      !bulkScopeCountReady
                    }
                    className="flex-1"
                  >
                    {bulkApplyMutation.isPending ? "Applying…" : "Apply"}
                  </AppButton>
                </>
              ) : (
                <AppButton
                  type="button"
                  onClick={dismissBulkPreview}
                  className="flex-1"
                >
                  Done
                </AppButton>
              )}
            </div>
          </SheetContent>
        </Sheet>
      ) : null}

      {mobileFiltersOpen && !isDesktop ? (
        <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
          <SheetContent
            aria-label="Transaction filters"
            side="bottom"
            className="max-h-[88vh]"
          >
            <SheetHeader>
              <SheetTitle className="text-lg">Filter transactions</SheetTitle>
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
            <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-5 py-4">
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted">Period</p>
                <PeriodPicker
                  periodSlug={mobilePeriod.slug}
                  start={mobilePeriod.start}
                  end={mobilePeriod.end}
                  onSetPreset={(slug) =>
                    setMobilePeriod((current) => ({ ...current, slug }))
                  }
                  onApplyCustom={(start, end) =>
                    setMobilePeriod({ slug: "custom", start, end })
                  }
                />
              </div>
              <AppFieldLabel>
                <span>Type</span>
                <SegmentedControl
                  value={mobileType}
                  ariaLabel="Transaction type"
                  items={[
                    { value: "", label: "All" },
                    { value: "income", label: "Income" },
                    { value: "expense", label: "Expense" },
                  ]}
                  onValueChange={setMobileType}
                />
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

        <div className="divide-y divide-border">
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
                  data-testid={`transaction-row-${txn.id}`}
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
                  className="group grid min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 !rounded-none !bg-transparent px-3 py-3 !shadow-none transition-colors hover:bg-surface-hi/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/35 md:px-4"
                >
                  <div className="flex min-w-0 items-center gap-3">
                  <label className="-my-2 -ml-2 flex h-11 w-9 shrink-0 cursor-pointer items-center justify-center">
                    <input
                      type="checkbox"
                      aria-label={`Select transaction ${txn.id}`}
                      checked={selectedIds.includes(txn.id)}
                      onChange={() => toggleSelected(txn.id)}
                      className={`control-check transition-opacity ${
                        selectedIds.includes(txn.id) || selectedIds.length
                          ? "opacity-100"
                          : "opacity-55 group-hover:opacity-100 group-focus-within:opacity-100"
                      }`}
                    />
                  </label>
                  <CategoryIcon icon={category?.icon ?? null} label={category?.name} />
                    <div className="min-w-0">
                    <p className="truncate font-semibold text-text">
                      {txn.title || category?.name || "Untitled"}
                    </p>
                    <TransactionDescription
                      markdown={txn.description}
                      compact
                      clamp
                      className="mt-1"
                    />
                    <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted">
                      <span className="font-mono tabular-nums">{formatEuroDate(txn.date)}</span>
                      <span aria-hidden="true">·</span>
                      <span className="truncate">{category?.name ?? "Uncategorized"}</span>
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
                  <div className="min-w-[5.75rem] text-right">
                  <p
                    className={`amount-text whitespace-nowrap text-sm ${
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
                  <div className="mt-1 flex items-center justify-end">
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
                      className="hidden px-2.5 desk:inline-flex"
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
            <AppCard className="p-6 text-center text-sm text-muted !rounded-none !bg-transparent !shadow-none">
              No transactions found.
            </AppCard>
          )}
        </div>
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
