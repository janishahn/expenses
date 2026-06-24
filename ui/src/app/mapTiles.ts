export const mapTileURL = (import.meta.env.VITE_MAP_TILE_URL ?? "").trim()

export const mapTileAttribution =
  (import.meta.env.VITE_MAP_TILE_ATTRIBUTION ?? "").trim() ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
