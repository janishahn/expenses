export type ConfirmOptions = {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: "danger" | "primary"
}

export type ConfirmRequest = ConfirmOptions & {
  resolve: (confirmed: boolean) => void
}

let host: ((request: ConfirmRequest) => void) | null = null

export function registerConfirmHost(
  handler: ((request: ConfirmRequest) => void) | null
) {
  host = handler
}

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  if (!host) {
    throw new Error("ConfirmDialogHost is not mounted")
  }
  const push = host
  return new Promise((resolve) => push({ ...options, resolve }))
}
