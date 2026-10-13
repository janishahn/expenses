export type ToastRequest = {
  message: string
  // Usually Undo; the toast stays a little longer when it offers an action.
  action?: { label: string; onClick: () => void }
}

type ActiveToast = ToastRequest & { id: number }

let active: ActiveToast | null = null
let nextId = 1
const subscribers = new Set<() => void>()

function notify() {
  subscribers.forEach((callback) => callback())
}

export function showToast(request: ToastRequest) {
  active = { ...request, id: nextId++ }
  notify()
}

export function dismissToast(id: number) {
  if (active?.id !== id) return
  active = null
  notify()
}

export function subscribeToasts(callback: () => void) {
  subscribers.add(callback)
  return () => subscribers.delete(callback)
}

export function currentToast(): ActiveToast | null {
  return active
}
