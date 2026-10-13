import { useEffect, useRef } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { formatCoordinate } from "../../app/format"
import { mapTileAttribution, mapTileURL } from "../../app/mapTiles"
import s from "./kit.module.css"

// The ink pin from the spec; its tip sits on the coordinate.
const PIN = L.divIcon({
  className: s.mapPin,
  html: '<svg viewBox="-12 -36 24 38" width="24" height="38" aria-hidden="true"><ellipse cy="1" rx="7" ry="2.5" fill="rgb(0 0 0 / 0.2)"/><path d="M0 0C-3-8-11-13-11-22A11 11 0 1 1 11-22C11-13 3-8 0 0Z" fill="var(--ink)"/><circle cy="-22" r="4" fill="var(--sheet)"/></svg>',
  iconSize: [24, 38],
  iconAnchor: [12, 36],
})

// A static map at full column width, centered on the pin. Tiles follow the theme and the
// attribution stays visible; there is no place-name lookup.
export function LocationMap({ latitude, longitude }: { latitude: number; longitude: number }) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const map = L.map(container, {
      zoomControl: false,
      dragging: false,
      touchZoom: false,
      doubleClickZoom: false,
      scrollWheelZoom: false,
      boxZoom: false,
      keyboard: false,
    }).setView([latitude, longitude], 16)
    if (mapTileURL) {
      L.tileLayer(mapTileURL, { maxZoom: 19, attribution: mapTileAttribution }).addTo(map)
    }
    L.marker([latitude, longitude], { icon: PIN, interactive: false, keyboard: false }).addTo(map)
    return () => {
      map.remove()
    }
  }, [latitude, longitude])

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label={`Map at ${formatCoordinate(latitude)}, ${formatCoordinate(longitude)}`}
      className={s.map}
    />
  )
}
