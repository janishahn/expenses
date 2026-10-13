import { useState, type KeyboardEvent, type SyntheticEvent } from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { CaretLeftIcon } from "@phosphor-icons/react/CaretLeft"
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight"
import { DownloadSimpleIcon } from "@phosphor-icons/react/DownloadSimple"
import { FilePdfIcon } from "@phosphor-icons/react/FilePdf"
import { ImageIcon } from "@phosphor-icons/react/Image"
import { MagnifyingGlassMinusIcon } from "@phosphor-icons/react/MagnifyingGlassMinus"
import { MagnifyingGlassPlusIcon } from "@phosphor-icons/react/MagnifyingGlassPlus"
import { XIcon } from "@phosphor-icons/react/X"
import clsx from "clsx"
import { formatFileSize } from "../../app/format"
import { Button, IconButton } from "./Button"
import { useBottomLayer, useIsDesktop } from "./layout-state"
import { downloadFile, type ReceiptFile } from "./receipt-file"
import { useSheetDrag } from "./sheet-drag"
import s from "./kit.module.css"

const ZOOM_STEP = 1.25
const MAX_SCALE = 8

type Zoom = { mode: "fit" } | { mode: "scale"; scale: number; width: number }

// The original file at a large size: images zoom and pan, PDFs use the browser's viewer.
export function ReceiptViewer({
  files,
  index,
  onIndexChange,
  open,
  onOpenChange,
}: {
  files: ReceiptFile[]
  index: number
  onIndexChange: (index: number) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const isDesktop = useIsDesktop()
  useBottomLayer(open && !isDesktop)
  const { ref: dragRef, handleProps: dragHandleProps } = useSheetDrag(!isDesktop, () => onOpenChange(false))
  const [zoom, setZoom] = useState<Zoom>({ mode: "fit" })
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  const [stage, setStage] = useState<HTMLDivElement | null>(null)
  const file = files[index] ?? files[0]
  if (!file) return null

  const show = (next: number) => {
    setZoom({ mode: "fit" })
    setNatural(null)
    onIndexChange((next + files.length) % files.length)
  }
  // The scale at which the whole image fits the stage with its 12px inset.
  const fitScale = () => {
    if (!natural || !stage) return 1
    return Math.min((stage.clientWidth - 24) / natural.width, (stage.clientHeight - 24) / natural.height, 1)
  }
  const zoomBy = (factor: number) => {
    if (!natural) return
    const current = zoom.mode === "fit" ? fitScale() : zoom.scale
    const scale = Math.min(Math.max(current * factor, fitScale() / 2), MAX_SCALE)
    setZoom({ mode: "scale", scale, width: Math.round(natural.width * scale) })
  }
  const onImageLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget
    setNatural({ width: image.naturalWidth, height: image.naturalHeight })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (files.length < 2) return
    if (event.key === "ArrowLeft") show(index - 1)
    else if (event.key === "ArrowRight") show(index + 1)
  }

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) setZoom({ mode: "fit" })
        onOpenChange(next)
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={s.scrim} />
        <DialogPrimitive.Content
          ref={dragRef}
          aria-describedby={undefined}
          className={clsx(s.floatLayer, s.viewer)}
          onKeyDown={onKeyDown}
        >
          <div className={s.vwBar} {...dragHandleProps}>
            {file.pdf ? <FilePdfIcon aria-hidden="true" className={s.faint} /> : <ImageIcon aria-hidden="true" className={s.faint} />}
            <DialogPrimitive.Title className={s.vwName}>{file.name}</DialogPrimitive.Title>
            <span className={s.sz}>{formatFileSize(file.sizeBytes)}</span>
            <span className={s.sp} />
            {files.length > 1 ? (
              <>
                <span className={clsx(s.muted, s.tab)}>
                  {index + 1} of {files.length}
                </span>
                <IconButton icon={CaretLeftIcon} label="Previous file" onClick={() => show(index - 1)} />
                <IconButton icon={CaretRightIcon} label="Next file" onClick={() => show(index + 1)} />
                <span className={s.vwDiv} />
              </>
            ) : null}
            {file.pdf ? null : (
              <>
                <IconButton icon={MagnifyingGlassMinusIcon} label="Zoom out" onClick={() => zoomBy(1 / ZOOM_STEP)} />
                <Button variant="ghost" aria-pressed={zoom.mode === "fit"} onClick={() => setZoom({ mode: "fit" })}>
                  Fit
                </Button>
                <IconButton icon={MagnifyingGlassPlusIcon} label="Zoom in" onClick={() => zoomBy(ZOOM_STEP)} />
              </>
            )}
            <IconButton icon={DownloadSimpleIcon} label="Download" onClick={() => downloadFile(file)} />
            <DialogPrimitive.Close asChild>
              <IconButton icon={XIcon} label="Close" tooltip={false} />
            </DialogPrimitive.Close>
          </div>
          <div ref={setStage} className={s.vwStage}>
            {file.pdf ? (
              <iframe key={file.id} src={file.fileUrl} title={file.name} />
            ) : zoom.mode === "fit" ? (
              <img key={file.id} src={file.fileUrl} alt={file.name} onLoad={onImageLoad} />
            ) : (
              <div className={s.vwZoom}>
                <img key={file.id} src={file.fileUrl} alt={file.name} style={{ width: zoom.width }} onLoad={onImageLoad} />
              </div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
