import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { CleanInboxVariant } from "./variant-clean"
import { CompactRegisterVariant } from "./variant-compact"
import { PairedRowsVariant } from "./variant-paired"

const variants = [
  { name: "Clean", Component: CleanInboxVariant },
  { name: "Paired", Component: PairedRowsVariant },
  { name: "Compact", Component: CompactRegisterVariant },
]

function initialVariant() {
  const requested = Number.parseInt(new URLSearchParams(location.search).get("v") ?? "1", 10)
  return requested >= 1 && requested <= variants.length ? requested - 1 : 0
}

export function PrototypeHarness() {
  const [current, setCurrent] = useState(initialVariant)
  const [ready, setReady] = useState(false)
  const highlightRef = useRef<HTMLSpanElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const CurrentVariant = variants[current].Component

  const moveHighlight = useCallback(() => {
    const item = itemRefs.current[current]
    const highlight = highlightRef.current
    if (!item || !highlight) return
    highlight.style.width = `${item.offsetWidth}px`
    highlight.style.transform = `translateX(${item.offsetLeft}px)`
  }, [current])

  const setActive = useCallback((index: number) => {
    if (index < 0 || index >= variants.length) return
    setCurrent(index)
  }, [])

  useLayoutEffect(moveHighlight, [moveHighlight])

  useEffect(() => {
    const url = new URL(location.href)
    url.searchParams.set("v", String(current + 1))
    history.replaceState(null, "", url)
  }, [current])

  useEffect(() => {
    let secondFrame = 0
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => setReady(true))
    })
    const onResize = () => moveHighlight()
    window.addEventListener("resize", onResize)
    return () => {
      cancelAnimationFrame(firstFrame)
      cancelAnimationFrame(secondFrame)
      window.removeEventListener("resize", onResize)
    }
  }, [moveHighlight])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const number = Number.parseInt(event.key, 10)
      if (number >= 1 && number <= variants.length) setActive(number - 1)
      else if (event.key === "ArrowRight") setActive((current + 1) % variants.length)
      else if (event.key === "ArrowLeft") setActive((current - 1 + variants.length) % variants.length)
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [current, setActive])

  return (
    <>
      <div id="stage"><CurrentVariant key={current} /></div>
      <nav className="proto-picker" aria-label="Prototype variants" data-ready={ready ? "" : undefined}>
        <span ref={highlightRef} className="proto-picker-highlight" aria-hidden="true" />
        {variants.map((variant, index) => (
          <button
            key={variant.name}
            ref={(element) => { itemRefs.current[index] = element }}
            className="proto-picker-item"
            data-active={index === current ? "" : undefined}
            aria-current={index === current ? "true" : undefined}
            onClick={() => setActive(index)}
          >
            {variant.name}
          </button>
        ))}
      </nav>
    </>
  )
}
