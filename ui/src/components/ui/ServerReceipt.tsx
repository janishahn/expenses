import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import clsx from "clsx"
import { serverAnswers } from "../../app/api"
import { currentLocalDateTime, occurredLabel } from "../../app/transactions"
import { Button } from "./Button"
import s from "./kit.module.css"

const FIRST_RETRY_MS = 2_000
const MAX_RETRY_MS = 30_000
const MAX_DOTS = 12
const FEED_EASE = "cubic-bezier(0.23, 1, 0.32, 1)"
const TORN = "translateY(-8px) rotate(-0.8deg)"

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

// A thermal printer's feed: each line advances quickly, then the paper rests while the next
// line prints. The steps end at `end` of the animation.
function feedFrames(from: number, to: number, steps: number, end = 1): Keyframe[] {
  const frames: Keyframe[] = [{ transform: `translateY(${from}px)`, offset: 0, easing: FEED_EASE }]
  for (let step = 1; step <= steps; step++) {
    const y = from + ((to - from) * step) / steps
    frames.push({ transform: `translateY(${y}px)`, offset: (end * (step - 0.45)) / steps, easing: "linear" })
    if (step < steps) frames.push({ transform: `translateY(${y}px)`, offset: (end * step) / steps, easing: FEED_EASE })
  }
  frames[frames.length - 1].offset = end
  return frames
}

// Shown instead of an error message while the server does not answer, for example while it
// restarts after an update. A receipt prints a dot for each retry (2 s, 4 s, 8 s, up to 30 s).
// When the server answers, it prints BACK ONLINE and tears off, then `onAnswered` reloads the page's data.
export function ServerReceipt({ onAnswered }: { onAnswered: () => void }) {
  const [printedAt] = useState(() => occurredLabel(currentLocalDateTime()))
  const [attempts, setAttempts] = useState(0)
  // "14:20", once the server answers.
  const [answeredAt, setAnsweredAt] = useState<string | null>(null)
  const [torn, setTorn] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const paperRef = useRef<HTMLDivElement>(null)
  const backRef = useRef<HTMLDivElement>(null)
  // How far the paper sits in the slot while BACK ONLINE is still unprinted.
  const waitOffset = useRef(0)

  const retry = useCallback(() => {
    void serverAnswers().then((answers) => {
      if (answers) setAnsweredAt(currentLocalDateTime().slice(11, 16))
      else setAttempts((count) => count + 1)
    })
  }, [])

  useLayoutEffect(() => {
    const paper = paperRef.current!
    waitOffset.current = paper.offsetHeight - backRef.current!.offsetTop + 2
    paper.style.transform = `translateY(${waitOffset.current}px)`
    const feed = prefersReducedMotion()
      ? paper.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250 })
      : paper.animate(feedFrames(paper.offsetHeight + 8, waitOffset.current, 6), {
          duration: 1300,
          delay: 300,
          fill: "backwards",
        })
    return () => feed.cancel()
  }, [])

  useEffect(() => {
    if (answeredAt) return
    const timer = window.setTimeout(retry, Math.min(FIRST_RETRY_MS * 2 ** attempts, MAX_RETRY_MS))
    return () => window.clearTimeout(timer)
  }, [answeredAt, attempts, retry])

  useEffect(() => {
    if (!answeredAt) return
    const paper = paperRef.current!
    const reduced = prefersReducedMotion()
    const done = reduced ? "none" : TORN
    const print = reduced
      ? null
      : paper.animate(
          [...feedFrames(waitOffset.current, 0, 2, 0.8), { transform: TORN, offset: 1, easing: "cubic-bezier(0.34, 1.4, 0.64, 1)" }],
          { duration: 900 },
        )
    paper.style.transform = done
    const timers = [
      window.setTimeout(() => setTorn(true), reduced ? 0 : 760),
      window.setTimeout(() => setLeaving(true), 1500),
      window.setTimeout(onAnswered, 1760),
    ]
    return () => {
      print?.cancel()
      timers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [answeredAt, onAnswered])

  return (
    <div className={clsx(s.receipt, leaving && s.receiptLeaving)}>
      <div aria-hidden="true" className={clsx(s.receiptFeed, torn && s.receiptTorn)}>
        <div className={s.receiptShadow}>
          <div ref={paperRef} className={s.receiptPaper}>
            <p className={s.receiptHead}>EXPENSES</p>
            <p className={s.receiptSub}>{printedAt}</p>
            <div className={s.receiptRule} />
            <p className={s.receiptLine}>NO ANSWER</p>
            <p className={s.receiptSub}>Trying again</p>
            <div className={s.receiptDots}>
              {Array.from({ length: Math.min(attempts, MAX_DOTS) }, (_, index) => (
                <span key={index} />
              ))}
            </div>
            <div ref={backRef}>
              <div className={s.receiptRule} />
              <p className={s.receiptLine}>BACK ONLINE</p>
              <p className={s.receiptSub}>{answeredAt ?? "\u00a0"}</p>
            </div>
          </div>
        </div>
      </div>
      <div aria-hidden="true" className={s.receiptSlot} />
      <div role="alert">
        <h2 className={s.authTitle}>Can't reach the server</h2>
        <p className={s.receiptDetail}>The page loads by itself when it answers.</p>
      </div>
      <Button variant="quiet" disabled={answeredAt !== null} onClick={retry}>
        Retry now
      </Button>
    </div>
  )
}
