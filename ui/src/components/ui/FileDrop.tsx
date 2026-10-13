import { useRef, useState, type DragEvent, type ReactNode } from "react"
import { UploadSimpleIcon } from "@phosphor-icons/react/UploadSimple"
import clsx from "clsx"
import s from "./kit.module.css"

// A dashed target that takes a dropped file or opens the file picker.
export function FileDrop({
  accept,
  label,
  disabled = false,
  onFile,
  children,
}: {
  accept: string
  // Accessible name of the hidden file input, such as "CSV file".
  label: string
  disabled?: boolean
  onFile: (file: File) => void
  // The visible prompt, such as "Drop a CSV file or choose one".
  children: ReactNode
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        aria-label={label}
        hidden
        onChange={(event) => {
          const chosen = event.target.files?.[0]
          event.target.value = ""
          if (chosen) onFile(chosen)
        }}
      />
      <button
        type="button"
        className={clsx(s.drop, dragging && s.dropActive)}
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event: DragEvent) => {
          if (!event.dataTransfer.types.includes("Files")) return
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event: DragEvent) => {
          event.preventDefault()
          setDragging(false)
          const dropped = event.dataTransfer.files[0]
          if (dropped && !disabled) onFile(dropped)
        }}
      >
        <UploadSimpleIcon aria-hidden="true" />
        {children}
      </button>
    </>
  )
}
