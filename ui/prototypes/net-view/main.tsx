import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import { CashBridgeVariant } from "./variant-cash-bridge";
import "./styles.css";

const variants = [{ name: "Cash Bridge", Component: CashBridgeVariant }];

function initialVariant() {
  const requested = Number.parseInt(new URLSearchParams(location.search).get("v") ?? "1", 10);
  return requested >= 1 && requested <= variants.length ? requested - 1 : 0;
}

export function PrototypeHarness() {
  const [current, setCurrent] = useState(initialVariant);
  const [mountKey, setMountKey] = useState(0);
  const pickerRef = useRef<HTMLElement>(null);
  const highlightRef = useRef<HTMLSpanElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const CurrentVariant = variants[current].Component;

  const moveHighlight = useCallback(() => {
    const item = itemRefs.current[current];
    const highlight = highlightRef.current;
    if (!item || !highlight) return;
    highlight.style.width = `${item.offsetWidth}px`;
    highlight.style.transform = `translateX(${item.offsetLeft}px)`;
  }, [current]);

  const mount = useCallback(() => {
    setMountKey((key) => key + 1);
  }, []);

  const setActive = useCallback(
    (index: number) => {
      if (index < 0 || index >= variants.length) return;
      setCurrent(index);
      mount();
    },
    [mount],
  );

  useLayoutEffect(() => {
    moveHighlight();
  }, [moveHighlight]);

  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.set("v", String(current + 1));
    history.replaceState(null, "", url);
  }, [current]);

  useEffect(() => {
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        pickerRef.current?.setAttribute("data-ready", "");
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, []);

  useEffect(() => {
    const handleResize = () => moveHighlight();
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const number = Number.parseInt(event.key, 10);
      if (number >= 1 && number <= variants.length) setActive(number - 1);
      else if (event.key === "ArrowRight") setActive((current + 1) % variants.length);
      else if (event.key === "ArrowLeft") {
        setActive((current - 1 + variants.length) % variants.length);
      } else if (event.key === "r" || event.key === "R") mount();
    };

    window.addEventListener("resize", handleResize);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [current, mount, moveHighlight, setActive]);

  return (
    <>
      <CurrentVariant key={`${current}-${mountKey}`} />
      <nav ref={pickerRef} className="proto-picker" aria-label="Prototype variants">
        <span ref={highlightRef} className="proto-picker-highlight" aria-hidden="true" />
        {variants.map((variant, index) => (
          <button
            key={variant.name}
            ref={(element) => {
              itemRefs.current[index] = element;
            }}
            className="proto-picker-item"
            data-active={current === index ? "" : undefined}
            aria-current={current === index ? "true" : undefined}
            onClick={() => setActive(index)}
          >
            {variant.name}
          </button>
        ))}
        <span className="proto-picker-divider" aria-hidden="true" />
        <button
          className="proto-picker-item proto-picker-replay"
          aria-label="Replay animation (R)"
          onClick={mount}
        >
          ↻
        </button>
      </nav>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<PrototypeHarness />);
