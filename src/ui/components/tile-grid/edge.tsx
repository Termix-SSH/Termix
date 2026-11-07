/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

export function scrollParent(element: HTMLElement | null) {
  for (let node = element?.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

/** True inside a TileStack or TileColumn section, which draws its own line. */
const EdgeOwnedContext = createContext(false);

export function EdgeOwned({ children }: { children: ReactNode }) {
  return (
    <EdgeOwnedContext.Provider value={true}>
      {children}
    </EdgeOwnedContext.Provider>
  );
}

/** True in a body with a pinned footer, whose top line already closes it. */
const FooterClosedContext = createContext(false);

export function FooterClosed({
  closed,
  children,
}: {
  closed: boolean;
  children: ReactNode;
}) {
  return (
    <FooterClosedContext.Provider value={closed}>
      {children}
    </FooterClosedContext.Provider>
  );
}

/**
 * Whether the element's end reaches the bottom of the visible scroll area,
 * where a closing line would sit on the screen edge and only add noise.
 */
function useReachesBottom(ref: React.RefObject<HTMLElement | null>) {
  const [reaches, setReaches] = useState(false);
  const reachesRef = useRef(reaches);
  reachesRef.current = reaches;
  useLayoutEffect(() => {
    const element = ref.current;
    const scroller = scrollParent(element);
    if (!element || !scroller) return;
    // Measured without the line itself, so showing it never flips the answer.
    const update = () => {
      const line = reachesRef.current ? 0 : 1;
      const end =
        element.getBoundingClientRect().bottom -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop -
        line;
      // Compared with the whole scrollable height, so content below keeps the line.
      setReaches(end >= scroller.scrollHeight - line - 0.5);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    observer.observe(element);
    for (const child of Array.from(scroller.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [ref]);
  return reaches;
}

/**
 * Wraps tiles whose last row draws a line under itself. The line stays when
 * there is room below and is clipped when the tiles reach the bottom of the
 * screen, the same rule the tile grid uses. Inside a stack section the
 * section owns the line, so it is always clipped, and so does a pinned footer.
 */
export function BottomEdge({
  className,
  innerClassName,
  children,
}: {
  className?: string;
  innerClassName?: string;
  children: ReactNode;
}) {
  const owned = useContext(EdgeOwnedContext);
  const closed = useContext(FooterClosedContext);
  const ref = useRef<HTMLDivElement>(null);
  const reaches = useReachesBottom(ref);
  return (
    // flow-root keeps the -1px margin inside, overflow clip alone lets it escape.
    <div ref={ref} className={cn("flow-root min-w-0 overflow-clip", className)}>
      <div
        className={cn((owned || closed || reaches) && "-mb-px", innerClassName)}
      >
        {children}
      </div>
    </div>
  );
}
