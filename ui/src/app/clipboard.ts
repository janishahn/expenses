export function copyText(text: string) {
  // Self-hosted plain-HTTP deployments have no navigator.clipboard.
  if (navigator.clipboard) {
    void navigator.clipboard.writeText(text)
    return
  }
  const area = document.createElement("textarea")
  area.value = text
  area.setAttribute("readonly", "")
  area.style.position = "fixed"
  area.style.opacity = "0"
  document.body.append(area)
  area.select()
  document.execCommand("copy")
  area.remove()
}
