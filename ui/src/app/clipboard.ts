// Resolves whether the text reached the clipboard.
export async function copyText(text: string): Promise<boolean> {
  // Self-hosted plain-HTTP deployments have no navigator.clipboard.
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  }
  const area = document.createElement("textarea")
  area.value = text
  area.setAttribute("readonly", "")
  area.style.position = "fixed"
  area.style.opacity = "0"
  document.body.append(area)
  area.select()
  const copied = document.execCommand("copy")
  area.remove()
  return copied
}
