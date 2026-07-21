import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js"
import { Flow, SankeyController } from "chartjs-chart-sankey"

ChartJS.register(
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  SankeyController,
  Flow,
  Filler,
  Tooltip
)

function readThemeChannel(token: string, fallback: string): string {
  if (typeof window === "undefined") {
    return fallback
  }
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(token)
    .trim()
  return value || fallback
}

export function readThemeColor(token: string, fallback: string): string {
  return `rgb(${readThemeChannel(token, fallback)})`
}

export function readThemeAlpha(
  token: string,
  alpha: number,
  fallback: string
): string {
  return `rgb(${readThemeChannel(token, fallback)} / ${alpha})`
}

ChartJS.defaults.color = readThemeColor("--muted", "145 145 145")
ChartJS.defaults.borderColor = readThemeColor("--border", "40 40 40")
ChartJS.defaults.font.family = "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
