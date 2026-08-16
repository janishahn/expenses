/* eslint-disable react-refresh/only-export-components */
import {
  StrictMode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
} from "react"
import { createRoot } from "react-dom/client"
import "@fontsource/ibm-plex-mono/latin-400.css"
import "@fontsource/ibm-plex-mono/latin-500.css"
import "@fontsource/ibm-plex-mono/latin-600.css"
import LiteralDefaults from "./variants/LiteralDefaults"
import MotionFirst from "./variants/MotionFirst"
import NativeFit from "./variants/NativeFit"
import { PROTOTYPE_PAGES, type PrototypePage, type VariantProps } from "./types"
import "./prototype.css"

const VARIANTS: Array<{ name: string; component: ComponentType<VariantProps> }> = [
  { name: "Literal", component: LiteralDefaults },
  { name: "Native fit", component: NativeFit },
  { name: "Motion first", component: MotionFirst },
]

function initialVariant(): number {
  const requested = Number(new URLSearchParams(window.location.search).get("v") ?? "1") - 1
  return requested >= 0 && requested < VARIANTS.length ? requested : 0
}

function initialPage(): PrototypePage {
  const requested = new URLSearchParams(window.location.search).get("page")
  const match = PROTOTYPE_PAGES.find((page) => page.id === requested)
  return match?.id ?? "dashboard"
}

function PrototypeHarness() {
  const [active, setActiveState] = useState(initialVariant)
  const [page, setPageState] = useState<PrototypePage>(initialPage)
  const [replay, setReplay] = useState(0)
  const [ready, setReady] = useState(false)
  const pickerRef = useRef<HTMLElement>(null)
  const highlightRef = useRef<HTMLSpanElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const Variant = VARIANTS[active].component

  const moveHighlight = useCallback(() => {
    const item = itemRefs.current[active]
    const highlight = highlightRef.current
    if (!item || !highlight) return
    highlight.style.width = `${item.offsetWidth}px`
    highlight.style.transform = `translateX(${item.offsetLeft}px)`
  }, [active])

  const updateUrl = useCallback((nextVariant: number, nextPage: PrototypePage) => {
    const url = new URL(window.location.href)
    url.searchParams.set("v", String(nextVariant + 1))
    url.searchParams.set("page", nextPage)
    window.history.replaceState(null, "", url)
  }, [])

  const setActive = useCallback((index: number) => {
    if (index < 0 || index >= VARIANTS.length) return
    setActiveState(index)
    setReplay((value) => value + 1)
    updateUrl(index, page)
  }, [page, updateUrl])

  const setPage = useCallback((nextPage: PrototypePage) => {
    setPageState(nextPage)
    updateUrl(active, nextPage)
  }, [active, updateUrl])

  useLayoutEffect(moveHighlight, [moveHighlight])

  useEffect(() => {
    const firstFrame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setReady(true))
    })
    const onResize = () => moveHighlight()
    window.addEventListener("resize", onResize)
    return () => {
      window.cancelAnimationFrame(firstFrame)
      window.removeEventListener("resize", onResize)
    }
  }, [moveHighlight])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const number = Number.parseInt(event.key, 10)
      if (number >= 1 && number <= VARIANTS.length) {
        setActive(number - 1)
      } else if (event.key === "ArrowRight") {
        setActive((active + 1) % VARIANTS.length)
      } else if (event.key === "ArrowLeft") {
        setActive((active - 1 + VARIANTS.length) % VARIANTS.length)
      } else if (event.key === "r" || event.key === "R") {
        setReplay((value) => value + 1)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [active, setActive])

  return (
    <>
      <div id="stage">
        <Variant key={`${active}-${replay}`} page={page} onPageChange={setPage} />
      </div>
      <nav
        ref={pickerRef}
        className="proto-picker"
        aria-label="Prototype variants"
        data-ready={ready ? "" : undefined}
      >
        <span ref={highlightRef} className="proto-picker-highlight" aria-hidden="true"></span>
        {VARIANTS.map((variant, index) => (
          <button
            key={variant.name}
            ref={(node) => {
              itemRefs.current[index] = node
            }}
            className="proto-picker-item"
            data-active={index === active ? "" : undefined}
            aria-current={index === active ? "true" : undefined}
            onClick={() => setActive(index)}
          >
            {variant.name}
          </button>
        ))}
        <span className="proto-picker-divider" aria-hidden="true"></span>
        <button
          className="proto-picker-item proto-picker-replay"
          aria-label="Replay animation (R)"
          onClick={() => setReplay((value) => value + 1)}
        >
          ↻
        </button>
      </nav>
    </>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PrototypeHarness />
  </StrictMode>,
)
