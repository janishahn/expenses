// A stored receipt as the receipt components show it.
export type ReceiptFile = {
  id: number
  name: string
  sizeBytes: number
  pdf: boolean
  // The server thumbnail; null when the server makes none (PDFs).
  previewUrl: string | null
  // The original file, served inline.
  fileUrl: string
  // Reading the receipt's items; null when it was never read.
  itemsStatus: "reading" | "read" | "failed" | null
}

export const RECEIPT_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp"

export function downloadFile(file: ReceiptFile) {
  const link = document.createElement("a")
  link.href = file.fileUrl
  link.download = file.name
  document.body.appendChild(link)
  link.click()
  link.remove()
}
