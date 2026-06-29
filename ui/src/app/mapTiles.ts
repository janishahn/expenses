// Unset defaults to OpenStreetMap; an explicit empty value disables external
// tile requests (markers only).
export const mapTileURL = (
  import.meta.env.VITE_MAP_TILE_URL ??
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
).trim()

export const mapTileAttribution =
  (import.meta.env.VITE_MAP_TILE_ATTRIBUTION ?? "").trim() ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
