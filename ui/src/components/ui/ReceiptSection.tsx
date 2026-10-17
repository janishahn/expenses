import { useRef, useState, type DragEvent, type SyntheticEvent } from "react"
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/ArrowsClockwise"
import { CameraIcon } from "@phosphor-icons/react/Camera"
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree"
import { DownloadSimpleIcon } from "@phosphor-icons/react/DownloadSimple"
import { FilePdfIcon } from "@phosphor-icons/react/FilePdf"
import { ImageIcon } from "@phosphor-icons/react/Image"
import { TrashIcon } from "@phosphor-icons/react/Trash"
import { UploadSimpleIcon } from "@phosphor-icons/react/UploadSimple"
import clsx from "clsx"
import { formatFileSize } from "../../app/format"
import { IconButton } from "./Button"
import { useIsDesktop } from "./layout-state"
import { Menu, MenuItem, MenuSeparator } from "./Menu"
import { PeekSection } from "./Peek"
import { RECEIPT_ACCEPT, downloadFile, type ReceiptFile } from "./receipt-file"
import { ReceiptViewer } from "./ReceiptViewer"
import s from "./kit.module.css"

// Receipts are provenance: a capped preview of one file, its name and size, and a strip
// when there are several. Without files the section is one drop row.
export function ReceiptSection({
  files,
  onUpload,
  onReplace,
  onRemove,
  uploading = false,
  error,
}: {
  files: ReceiptFile[]
  onUpload: (file: File) => void
  onReplace: (target: ReceiptFile, file: File) => void
  onRemove: (target: ReceiptFile) => void
  uploading?: boolean
  error?: string | null
}) {
  const isDesktop = useIsDesktop()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const replaceTarget = useRef<ReceiptFile | null>(null)
  const [selected, setSelected] = useState(0)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  // Natural aspect ratios of loaded previews, and previews that failed: without the server's
  // thumbnail an image shows its original file, and an icon when that fails too.
  const [ratios, setRatios] = useState<Record<number, number>>({})
  const [failed, setFailed] = useState<Record<number, "thumbnail" | "original">>({})

  const index = Math.min(selected, Math.max(files.length - 1, 0))
  const file = files[index]

  const choose = (target: ReceiptFile | null) => {
    replaceTarget.current = target
    inputRef.current?.click()
  }
  const onFileChosen = (chosen: File | undefined) => {
    if (!chosen) return
    if (replaceTarget.current) onReplace(replaceTarget.current, chosen)
    else onUpload(chosen)
    replaceTarget.current = null
  }
  const dropProps = {
    onDragOver: (event: DragEvent) => {
      if (!event.dataTransfer.types.includes("Files")) return
      event.preventDefault()
      setDragging(true)
    },
    onDragLeave: () => setDragging(false),
    onDrop: (event: DragEvent) => {
      event.preventDefault()
      setDragging(false)
      const dropped = event.dataTransfer.files[0]
      if (dropped && !uploading) onUpload(dropped)
    },
  }
  const onPreviewLoad = (id: number) => (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget
    if (image.naturalWidth && image.naturalHeight) {
      setRatios((current) => ({ ...current, [id]: image.naturalWidth / image.naturalHeight }))
    }
  }
  const previewUrl = (target: ReceiptFile) => {
    if (!target.previewUrl) return undefined
    if (!failed[target.id]) return target.previewUrl
    return failed[target.id] === "thumbnail" ? target.fileUrl : undefined
  }
  const onPreviewError = (id: number) => () => {
    const source = failed[id] ? "original" : "thumbnail"
    setFailed((current) => (current[id] === "original" ? current : { ...current, [id]: source }))
  }
  const fileIcon = (target: ReceiptFile) =>
    target.pdf ? <FilePdfIcon aria-hidden="true" /> : <ImageIcon aria-hidden="true" />

  return (
    <div {...dropProps}>
      <input
        ref={inputRef}
        type="file"
        accept={RECEIPT_ACCEPT}
        hidden
        onChange={(event) => {
          onFileChosen(event.target.files?.[0])
          event.target.value = ""
        }}
      />
      <PeekSection
        title="Receipts"
        action={
          files.length ? (
            <>
              {files.length > 1 ? (
                <span className={clsx(s.muted, s.tab)}>
                  {index + 1} of {files.length}
                </span>
              ) : null}
              <IconButton
                icon={UploadSimpleIcon}
                label={uploading ? "Uploading receipt" : "Add receipt"}
                size="small"
                disabled={uploading}
                onClick={() => choose(null)}
              />
            </>
          ) : null
        }
      >
        {file ? (
          <>
            <button
              type="button"
              className={clsx(s.rprev, dragging && s.dropActive)}
              style={{ aspectRatio: previewUrl(file) ? String(ratios[file.id] ?? 0.75) : "2 / 1" }}
              aria-label={`Open ${file.name}`}
              onClick={() => setViewerOpen(true)}
            >
              {previewUrl(file) ? (
                <img src={previewUrl(file)} alt="" onLoad={onPreviewLoad(file.id)} onError={onPreviewError(file.id)} />
              ) : (
                <span className={s.rprevIcon}>{fileIcon(file)}</span>
              )}
            </button>
            <div className={s.rcap}>
              <span className={s.rcapName}>{file.name}</span>
              <span className={s.sz}>{formatFileSize(file.sizeBytes)}</span>
              <Menu label={file.name} trigger={<IconButton icon={DotsThreeIcon} label="Receipt actions" size="small" />}>
                <MenuItem icon={DownloadSimpleIcon} onSelect={() => downloadFile(file)}>
                  Download
                </MenuItem>
                <MenuItem icon={ArrowsClockwiseIcon} disabled={uploading} onSelect={() => choose(file)}>
                  Replace
                </MenuItem>
                <MenuSeparator />
                <MenuItem icon={TrashIcon} danger onSelect={() => onRemove(file)}>
                  Remove
                </MenuItem>
              </Menu>
            </div>
            {files.length > 1 ? (
              <div className={s.rstrip}>
                {files.map((entry, position) => (
                  <button
                    key={entry.id}
                    type="button"
                    className={s.rthumb}
                    aria-label={entry.name}
                    aria-current={position === index ? "true" : undefined}
                    onClick={() => setSelected(position)}
                  >
                    {previewUrl(entry) ? (
                      <img src={previewUrl(entry)} alt="" onError={onPreviewError(entry.id)} />
                    ) : (
                      fileIcon(entry)
                    )}
                  </button>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <button
            type="button"
            className={clsx(s.drop, s.dropSmall, dragging && s.dropActive)}
            disabled={uploading}
            onClick={() => choose(null)}
          >
            {isDesktop ? <UploadSimpleIcon aria-hidden="true" /> : <CameraIcon aria-hidden="true" />}
            {uploading ? "Uploading…" : isDesktop ? (
              <span>
                Drop a receipt or <span className={s.link}>choose a file</span>
              </span>
            ) : (
              "Add a receipt"
            )}
          </button>
        )}
        {error ? (
          <span role="alert" className={s.errText}>
            {error}
          </span>
        ) : null}
      </PeekSection>
      {file ? (
        <ReceiptViewer
          files={files}
          index={index}
          onIndexChange={setSelected}
          open={viewerOpen}
          onOpenChange={setViewerOpen}
        />
      ) : null}
    </div>
  )
}
