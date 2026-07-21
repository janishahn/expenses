import { useEffect, useRef, useState } from "react"
import { MapPinIcon } from "@phosphor-icons/react/MapPin"
import { PaperclipIcon } from "@phosphor-icons/react/Paperclip"
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple"
import { TrashIcon } from "@phosphor-icons/react/Trash"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import markerIcon from "leaflet/dist/images/marker-icon.png"
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png"
import markerShadow from "leaflet/dist/images/marker-shadow.png"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useLocation, useNavigate, useParams } from "react-router-dom"
import { apiFetch, apiFetchBlob } from "../app/api"
import type {
  ReceiptAttachment,
  TransactionDetail,
  TransactionRouteState,
} from "../app/api-types"
import { mapTileAttribution, mapTileURL } from "../app/mapTiles"
import {
  formatCoordinate,
  formatCurrency,
  formatEuroDate,
  formatEuroDateTime,
  formatFileSize,
} from "../app/format"
import { CategoryIcon } from "../components/CategoryIcon"
import PageIntro from "../components/PageIntro"
import TransactionDescription from "../components/TransactionDescription"
import {
  FinancialPanel,
  SectionHeading,
} from "../components/product/ProductSurfaces"
import { AppButton } from "../components/ui/product-button"
import { AppCard } from "../components/ui/product-card"

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
      data-testid="transaction-detail-location-map"
      className="relative z-0 h-full min-h-[18rem] w-full md:min-h-[24rem]"
    />
  )
}

function AttachmentPreviewCard({ attachment }: { attachment: ReceiptAttachment }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState("")
  const [actionError, setActionError] = useState("")

  const isImagePreview = attachment.mime_type.startsWith("image/")
  const isPdfPreview = attachment.mime_type === "application/pdf"
  const canPreviewInline = isImagePreview || isPdfPreview

  useEffect(() => {
    if (!canPreviewInline) {
      return
    }

    let active = true
    let objectUrl: string | null = null

    const load = (path: string, allowFallback: boolean) => {
      void apiFetchBlob(path)
        .then(({ blob }) => {
          if (!active) {
            return
          }
          objectUrl = URL.createObjectURL(blob)
          setPreviewUrl(objectUrl)
        })
        .catch((error) => {
          if (!active) {
            return
          }
          if (allowFallback) {
            load(`/api/attachments/${attachment.id}/download`, false)
            return
          }
          setPreviewError(String(error))
        })
    }

    load(
      isImagePreview
        ? `/api/attachments/${attachment.id}/thumbnail`
        : `/api/attachments/${attachment.id}/download`,
      isImagePreview,
    )

    return () => {
      active = false
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [attachment.id, canPreviewInline, isImagePreview])

  const openAttachment = async () => {
    setActionError("")
    const popup = window.open("about:blank", "_blank")
    if (popup) {
      popup.opener = null
    }
    try {
      const { blob } = await apiFetchBlob(`/api/attachments/${attachment.id}/download`)
      const objectUrl = URL.createObjectURL(blob)
      if (popup) {
        popup.location.href = objectUrl
      } else {
        const link = document.createElement("a")
        link.href = objectUrl
        link.target = "_blank"
        link.rel = "noopener noreferrer"
        document.body.appendChild(link)
        link.click()
        link.remove()
      }
      window.setTimeout(() => {
        URL.revokeObjectURL(objectUrl)
      }, 60_000)
    } catch (error) {
      popup?.close()
      setActionError(String(error))
    }
  }

  const downloadAttachment = async () => {
    setActionError("")
    try {
      const { blob, filename } = await apiFetchBlob(
        `/api/attachments/${attachment.id}/download`
      )
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = objectUrl
      link.download = filename || attachment.original_filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(objectUrl)
    } catch (error) {
      setActionError(String(error))
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface-hi/45">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/80 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-text">{attachment.original_filename}</p>
          <p className="text-xs text-muted">
            {attachment.mime_type} · {formatFileSize(attachment.size_bytes)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <AppButton
            type="button"
            tone="ghost"
            className="btn-inline"
            onClick={openAttachment}
            aria-label={`Open ${attachment.original_filename}`}
          >
            Open
          </AppButton>
          <AppButton
            type="button"
            tone="ghost"
            className="btn-inline"
            onClick={downloadAttachment}
            aria-label={`Download ${attachment.original_filename}`}
          >
            Download
          </AppButton>
        </div>
      </div>

      <div className="p-3">
        {previewUrl && isImagePreview ? (
          <img
            src={previewUrl}
            alt={attachment.original_filename}
            className="h-auto max-h-[26rem] w-full rounded-lg border border-border object-contain"
          />
        ) : null}

        {previewUrl && isPdfPreview ? (
          <iframe
            src={previewUrl}
            title={attachment.original_filename}
            sandbox=""
            referrerPolicy="no-referrer"
            className="h-[26rem] w-full rounded-lg border border-border bg-surface"
          />
        ) : null}

        {!previewUrl && canPreviewInline && !previewError ? (
          <p className="rounded-lg border border-border bg-surface px-3 py-4 text-sm text-muted">
            Loading preview…
          </p>
        ) : null}

        {!canPreviewInline ? (
          <p className="rounded-lg border border-border bg-surface px-3 py-4 text-sm text-muted">
            Preview unavailable for this file type.
          </p>
        ) : null}

        {previewError ? (
          <p className="rounded-lg border border-semantic-red/50 bg-semantic-red/10 px-3 py-4 text-sm text-semantic-red">
            Unable to load preview.
          </p>
        ) : null}

        {actionError ? <p className="mt-3 text-xs text-semantic-red">{actionError}</p> : null}
      </div>
    </div>
  )
}

function TransactionDetailPage() {
  const { transactionId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [deleteError, setDeleteError] = useState("")
  const navigationState = location.state as TransactionRouteState | null
  const returnTo = navigationState?.returnTo || "/transactions"
  const hasOriginContext =
    navigationState?.hasOriginContext ?? Boolean(navigationState?.returnTo)

  const { data: transaction, isLoading, error } = useQuery({
    queryKey: ["transaction", transactionId],
    queryFn: () => apiFetch<TransactionDetail>(`/api/transactions/${transactionId}`),
    enabled: Boolean(transactionId),
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/transactions/${transactionId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      setDeleteError("")
      queryClient.invalidateQueries({ queryKey: ["transactions"] })
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      queryClient.invalidateQueries({ queryKey: ["insights"] })
      queryClient.invalidateQueries({ queryKey: ["budgets"] })
      queryClient.invalidateQueries({ queryKey: ["forecast"] })
      queryClient.removeQueries({ queryKey: ["transaction", transactionId] })
      queryClient.removeQueries({
        queryKey: ["transaction", Number(transactionId), "reimbursements"],
      })
      navigate(returnTo, { replace: true })
    },
    onError: (mutationError) => {
      setDeleteError(String(mutationError))
    },
  })

  const handleDelete = () => {
    if (!confirm("Delete this transaction?")) {
      return
    }
    setDeleteError("")
    deleteMutation.mutate()
  }

  if (isLoading) {
    return <div className="text-muted">Loading transaction…</div>
  }

  if (error || !transaction) {
    return (
      <section className="space-y-5 md:space-y-6 desk:space-y-4">
        <PageIntro title="Transaction" backHref={returnTo} backLabel="← Back" />
        <AppCard className="p-5 text-semantic-red">Transaction not found.</AppCard>
      </section>
    )
  }

  const amountTextTone =
    transaction.type === "expense" ? "text-semantic-red" : "text-semantic-green"
  const amountPrefix = transaction.type === "expense" ? "-" : "+"
  const whenLabel = transaction.occurred_at ? "Date & time" : "Date"
  const whenValue = transaction.occurred_at
    ? formatEuroDateTime(transaction.occurred_at)
    : formatEuroDate(transaction.date)

  let durableLifespanLabel: string | null = null
  if (transaction.durable_purchase) {
    const days = transaction.durable_purchase.expected_lifespan_days
    if (days % 365 === 0) {
      const years = days / 365
      durableLifespanLabel = `${years} ${years === 1 ? "year" : "years"}`
    } else {
      durableLifespanLabel = `${days} days`
    }
  }

  const hasLocation =
    transaction.latitude !== null && transaction.longitude !== null

  return (
    <section className="space-y-5 md:space-y-6 desk:space-y-4">
      <PageIntro
        title="Transaction"
        backHref={returnTo}
        backLabel="← Back"
        titleAccessoryAlign="end"
        titleAccessory={
          <div className="flex shrink-0 items-center gap-2.5">
            <AppButton asChild tone="ghost" className="h-11 w-11 p-0">
              <Link
                to={`/transactions/${transaction.id}/edit`}
                state={{ returnTo, hasOriginContext }}
                aria-label="Edit transaction"
              >
                <PencilSimpleIcon className="h-4 w-4" aria-hidden="true" />
              </Link>
            </AppButton>
            <AppButton
              type="button"
              tone="danger"
              className="h-11 w-11 p-0"
              aria-label="Delete transaction"
              disabled={deleteMutation.isPending}
              onClick={handleDelete}
            >
              <TrashIcon className="h-4 w-4" aria-hidden="true" />
            </AppButton>
          </div>
        }
      />

      {deleteError ? <AppCard className="p-4 text-xs text-semantic-red">{deleteError}</AppCard> : null}

      <FinancialPanel role="hero" className="overflow-hidden">
        <div className="flex flex-col gap-5 p-5 md:flex-row md:items-start md:justify-between md:p-6">
          <div className="flex min-w-0 items-start gap-3 md:flex-1">
            <CategoryIcon
              icon={transaction.category?.icon ?? null}
              label={transaction.category?.name ?? "Uncategorized"}
              className="mt-0.5 h-11 w-11 shrink-0"
            />
            <div className="min-w-0 space-y-1.5">
              <p className="mono-meta uppercase text-muted">Ledger entry</p>
              <h2 className="break-words font-head text-2xl font-bold text-text md:text-[2rem]">
                {transaction.title}
              </h2>
              <p className="text-sm text-muted">
                {transaction.category?.name ?? "Uncategorized"} · {whenValue}
              </p>
            </div>
          </div>

          <div className="min-w-[9.75rem] self-end space-y-1.5 text-right md:self-auto">
            <p className="mono-meta uppercase text-muted">Amount</p>
            <p className={`font-mono text-[1.65rem] font-semibold tabular-nums ${amountTextTone}`}>
              {amountPrefix}
              {formatCurrency(transaction.amount_cents)} €
            </p>
            <p className="text-xs capitalize text-muted">{transaction.type}</p>
          </div>
        </div>

        {transaction.is_reimbursement ? (
          <div className="flex flex-wrap items-center gap-1.5 px-5 pb-5 md:px-6 md:pb-6">
            <span className="chip">Reimbursement</span>
          </div>
        ) : null}

        <div className="grid grid-cols-2 border-t border-border">
          <div className="min-w-0 space-y-1.5 bg-signal-blue-soft p-3 md:p-4">
            <p className="mono-meta uppercase text-muted">{whenLabel}</p>
            <p className="break-words text-xs font-semibold text-text md:text-sm">{whenValue}</p>
          </div>

          <div className="min-w-0 space-y-1.5 border-l border-border bg-signal-purple-soft p-3 md:p-4">
            <p className="mono-meta uppercase text-muted">Category</p>
            <div className="flex min-w-0 items-center gap-2">
              <CategoryIcon
                icon={transaction.category?.icon ?? null}
                label={transaction.category?.name ?? "Uncategorized"}
                className="h-7 w-7 rounded-[0.5rem]"
              />
              <p className="min-w-0 break-words text-xs font-semibold text-text md:text-sm">
                {transaction.category?.name ?? "Uncategorized"}
              </p>
            </div>
          </div>

          {transaction.durable_purchase ? (
            <div className="col-span-2 space-y-3 border-t border-border bg-signal-yellow-soft p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] uppercase tracking-[0.08em] text-muted">
                  Durable purchase
                </p>
                {durableLifespanLabel ? <span className="chip">{durableLifespanLabel}</span> : null}
              </div>
              <p className="text-sm text-text">
                Acquired {formatEuroDate(transaction.durable_purchase.acquired_on)}
              </p>
            </div>
          ) : null}
        </div>
      </FinancialPanel>

      {transaction.tags.length ? (
        <div className="space-y-2 px-1">
          <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Tags</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {transaction.tags.map((tag) => (
              <span key={tag} className="chip">
                {tag}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {transaction.description?.trim() ? (
        <FinancialPanel role="panel">
          <SectionHeading>
            <h2 className="font-head text-lg font-bold text-text">Description</h2>
          </SectionHeading>
          <div className="p-5 md:p-6">
            <TransactionDescription markdown={transaction.description} />
          </div>
        </FinancialPanel>
      ) : null}

      {hasLocation ? (
        <FinancialPanel role="panel">
          <SectionHeading>
            <h2 className="inline-flex items-center gap-2 font-head text-lg font-bold text-text">
              <MapPinIcon className="h-4 w-4" />
              Location
            </h2>
            <p className="font-mono text-xs text-muted">
              {formatCoordinate(transaction.latitude!)}, {formatCoordinate(transaction.longitude!)}
            </p>
          </SectionHeading>
          <div className="relative z-0 overflow-hidden rounded-b-[var(--radius-lg)] bg-surface-hi/55">
            <TransactionLocationMap
              latitude={transaction.latitude!}
              longitude={transaction.longitude!}
              title={transaction.title}
            />
          </div>
        </FinancialPanel>
      ) : null}

      {transaction.attachments.length ? (
        <FinancialPanel role="panel">
          <SectionHeading>
            <h2 className="inline-flex items-center gap-2 font-head text-lg font-bold text-text">
              <PaperclipIcon className="h-4 w-4" />
              Attachments
            </h2>
            <span className="chip">{transaction.attachments.length} attached</span>
          </SectionHeading>
          <div className="space-y-3 p-5 md:p-6">
            {transaction.attachments.map((attachment) => (
              <AttachmentPreviewCard key={attachment.id} attachment={attachment} />
            ))}
          </div>
        </FinancialPanel>
      ) : null}
    </section>
  )
}

export default TransactionDetailPage
