import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface EmbeddedViewApi {
  open: (options: {
    id: string;
    url: string;
    ignoreCert?: boolean;
    bounds: Bounds;
    visible: boolean;
  }) => Promise<unknown>;
  setBounds: (id: string, bounds: Bounds) => Promise<unknown>;
  setVisible: (id: string, visible: boolean) => Promise<unknown>;
  close: (id: string) => Promise<unknown>;
}

function embeddedViewApi(): EmbeddedViewApi | null {
  if (typeof window === "undefined") return null;
  const api = (
    window as unknown as { electronAPI?: { embeddedView?: unknown } }
  ).electronAPI?.embeddedView;
  return (api as EmbeddedViewApi | undefined) ?? null;
}

const OVERLAY = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  "[data-radix-popper-content-wrapper]",
].join(",");

// A native view is drawn above the page, so anything the page opens over it
// has to hide it first.
function overlayOpen(host: HTMLElement): boolean {
  return Array.from(document.querySelectorAll(OVERLAY)).some(
    (node) => !host.contains(node),
  );
}

export interface NativeViewProps {
  url: string;
  /** Accept an invalid TLS certificate from this URL's origin. */
  ignoreCert?: boolean;
  /** Hide the view, for example while the tab is not shown. */
  hidden?: boolean;
  /** Shown where the desktop app's native view is not available. */
  fallback?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * A page shown in a native view (desktop app only), for sites that do not
 * work in a sandboxed iframe. It fills this element, hides itself when the
 * element is not visible or a dialog or menu is open, and is closed on
 * unmount. In a browser it renders `fallback`.
 */
export function NativeView({
  url,
  ignoreCert,
  hidden,
  fallback,
  className,
  style,
}: NativeViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const api = embeddedViewApi();
  const hiddenRef = useRef(!!hidden);
  hiddenRef.current = !!hidden;
  const sync = useRef<() => void>(() => {});

  useEffect(() => {
    const element = host.current;
    const view = embeddedViewApi();
    if (!element || !view) return;
    const id = crypto.randomUUID();
    let opened = false;
    let lastBounds = "";
    let lastVisible: boolean | null = null;
    let frame = 0;

    const update = () => {
      frame = 0;
      const rect = element.getBoundingClientRect();
      const bounds = {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      };
      const visible =
        !hiddenRef.current &&
        rect.width > 0 &&
        rect.height > 0 &&
        element.offsetParent !== null &&
        !overlayOpen(element);
      if (!opened) {
        opened = true;
        lastBounds = JSON.stringify(bounds);
        lastVisible = visible;
        void view.open({ id, url, ignoreCert, bounds, visible });
        return;
      }
      const key = JSON.stringify(bounds);
      if (key !== lastBounds) {
        lastBounds = key;
        void view.setBounds(id, bounds);
      }
      if (visible !== lastVisible) {
        lastVisible = visible;
        void view.setVisible(id, visible);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    sync.current = schedule;

    const resize = new ResizeObserver(schedule);
    resize.observe(element);
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "data-state"],
    });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    const timer = window.setInterval(schedule, 500);
    schedule();

    return () => {
      sync.current = () => {};
      resize.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.clearInterval(timer);
      if (frame) cancelAnimationFrame(frame);
      void view.close(id);
    };
  }, [url, ignoreCert]);

  useEffect(() => {
    sync.current();
  }, [hidden]);

  if (!api) return <>{fallback ?? null}</>;
  return <div ref={host} className={className} style={style} />;
}
