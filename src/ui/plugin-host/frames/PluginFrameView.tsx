/**
 * One plugin view in a sandboxed frame. The frame gets an opaque origin
 * (sandbox="allow-scripts" only), loads from the plugin's own asset folder
 * and talks to the shell through a checked port. Props cross as data, with
 * functions passed by reference.
 */

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { usePluginStore } from "../plugin-store";
import { setForeignAnchor } from "./foreign-anchors";
import { FRAME_ALLOW } from "./frame-allow";
import { lastSize, rememberSize, sizeKey } from "./frame-sizes";
import { useInSeamlessTile } from "@/components/tile-grid/context";
import {
  useSurfaceClose,
  useSurfaceCover,
  useSurfaceKind,
  type EditingWidth,
} from "@/components/surface/surface-scope";
import {
  connectFrame,
  frameUrl,
  type FrameConnection,
} from "./frame-connection";
import { useStableProps } from "@/plugin-frame/stable-props";
import { LoadingState } from "@/components/loading-state";

/** A full size view still loading after this long shows a spinner. */
export const LOADING_DELAY_MS = 300;
/** Longest the spinner stays up after the frame started. */
const SHOWN_GRACE_MS = 2_000;

type Size = { width: number; height: number };

/**
 * fill: takes the box it is given. content: full width, as tall as the
 * view. inline: as wide and tall as the view, for a toolbar button.
 * bar: as wide as the view and as tall as the bar it sits in, for a button
 * that fills a tab bar. overlay: fills the box, see-through, and only takes clicks while the view
 * draws something.
 */
export type FrameFit = "fill" | "content" | "inline" | "bar" | "overlay";

/** What the shell can do with a view it placed. */
export interface FrameControl {
  /** Focuses the view's first or last control. */
  focusEdge: (edge: "first" | "last") => void;
}

export interface PluginFrameViewProps {
  pluginId: string;
  frameKey: string;
  fit: FrameFit;
  /** Lets the page behind show through, for overlays. */
  transparent?: boolean;
  props: Record<string, unknown>;
  /** Shown in the shell while the view draws nothing, for inline fit. */
  fallback?: ReactNode;
  className?: string;
  style?: CSSProperties;
  /**
   * The view sits over another plugin's frame: Tab past its ends and wheel
   * moves it can't use are reported instead of kept.
   */
  edge?: boolean;
  /** Every event the view sends, after the frame's own handling. */
  onFrameEvent?: (name: string, data: unknown) => void;
  controlRef?: (control: FrameControl | null) => void;
}

export const SANDBOX = "allow-scripts";

interface Parked {
  sig: string;
  connection: FrameConnection;
  timer: ReturnType<typeof setInterval>;
}

// Suspense and strict mode run a view's layout effects again on the same,
// still loaded frame, which never says hello twice. The connection waits
// here until the effect comes back or the frame leaves the page.
const parked = new WeakMap<HTMLIFrameElement, Parked>();

function takeParked(element: HTMLIFrameElement): Parked | undefined {
  const kept = parked.get(element);
  if (!kept) return undefined;
  parked.delete(element);
  clearInterval(kept.timer);
  return kept;
}

function keepAlive(
  element: HTMLIFrameElement,
  sig: string,
  next: FrameConnection,
  controlRef: PluginFrameViewProps["controlRef"],
  current: { current: FrameConnection | null },
): () => void {
  controlRef?.({
    focusEdge: (at) => {
      element.focus();
      next.port?.emit("focusEdge", at === "last" ? "last" : "first");
    },
  });
  return () => {
    controlRef?.(null);
    current.current = null;
    if (!element.isConnected) {
      next.close();
      return;
    }
    const sweep = () => {
      if (element.isConnected || parked.get(element)?.connection !== next) {
        return;
      }
      takeParked(element);
      next.close();
    };
    parked.set(element, {
      sig,
      connection: next,
      timer: setInterval(sweep, 1000),
    });
    // An unmount has removed the frame by the time this runs.
    queueMicrotask(sweep);
  };
}

export function PluginFrameView({
  pluginId,
  frameKey,
  fit,
  transparent,
  props,
  fallback,
  className,
  style,
  edge,
  onFrameEvent,
  controlRef,
}: PluginFrameViewProps) {
  const overlay = fit === "overlay";
  // Buttons and badges sit inside the owner's bar or row, so its color shows.
  const seeThrough =
    transparent || overlay || fit === "inline" || fit === "bar";
  const [drawn, setDrawn] = useState(!overlay);
  const eventRef = useRef(onFrameEvent);
  eventRef.current = onFrameEvent;
  const iframe = useRef<HTMLIFrameElement>(null);
  const connection = useRef<FrameConnection | null>(null);
  const remembered = sizeKey(pluginId, frameKey, props);
  const rememberedRef = useRef(remembered);
  rememberedRef.current = remembered;
  const [size, setSize] = useState<Size | null>(() => lastSize(remembered));
  const [ready, setReady] = useState(false);
  // The view asked the shell to scroll it (useShellScroll).
  const [shellScroll, setShellScroll] = useState(false);
  const [viewport, setViewport] = useState(0);
  // An inline view is open in a content sized view: it covers the surface.
  const [cover, setCover] = useState<EditingWidth>(false);
  const [coverRect, setCoverRect] = useState<DOMRect | null>(null);
  const coverRef = useRef(false);
  const surfaceCover = useSurfaceCover();
  const coverId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  // First paint, which comes a little after ready.
  const [shown, setShown] = useState(false);
  // Layout context a plugin component reads, which can't cross by itself.
  const seamless = useInSeamlessTile();
  const surfaceKind = useSurfaceKind();
  const surfaceClose = useSurfaceClose();
  const placed = useMemo(
    () => ({
      ...props,
      __place: {
        // A tile in the frame that placed this view counts too.
        seamless:
          seamless ||
          (props.__place as { seamless?: unknown } | undefined)?.seamless ===
            true,
        surfaceKind,
      },
      __surfaceClose: surfaceClose ?? undefined,
    }),
    [props, seamless, surfaceKind, surfaceClose],
  );
  const stable = useStableProps(placed);
  const stableRef = useRef(stable);
  stableRef.current = stable;
  const lastSent = useRef<string | null>(null);
  const record = usePluginStore().records.get(pluginId);
  const version = record?.summary.assetVersion ?? "";

  // A see-through fill view (a rail panel on the sidebar color) still
  // shows the spinner, just without a background of its own.
  const loads =
    fit === "fill" && (!seeThrough || !!transparent) && !className && !style;
  const fitRef = useRef(fit);
  fitRef.current = fit;
  const loadsRef = useRef(loads);
  loadsRef.current = loads;
  const src = useMemo(
    () =>
      frameUrl(pluginId, {
        role: "view",
        key: frameKey,
        fit: fit === "fill" || fit === "overlay" ? "fill" : "content",
        inline: fit === "inline" ? "1" : undefined,
        bar: fit === "bar" ? "1" : undefined,
        bg: seeThrough ? "none" : undefined,
        drawn: overlay ? "1" : undefined,
        edge: edge ? "1" : undefined,
        spin: loads ? "host" : undefined,
        // A see-through view lies on the sidebar, which its fields match.
        on: transparent ? "sidebar" : undefined,
        v: version || undefined,
      }),
    [
      pluginId,
      frameKey,
      fit,
      seeThrough,
      overlay,
      edge,
      loads,
      transparent,
      version,
    ],
  );

  useLayoutEffect(() => {
    const element = iframe.current;
    if (!element) return;
    const sig = `${pluginId}
${frameKey}
${src}`;
    const kept = takeParked(element);
    if (kept?.sig === sig) {
      connection.current = kept.connection;
      return keepAlive(element, sig, kept.connection, controlRef, connection);
    }
    kept?.connection.close();
    setReady(false);
    setShown(false);
    setShellScroll(false);
    setCover(false);
    coverRef.current = false;
    lastSent.current = null;
    const next = connectFrame(element, pluginId, "view", frameKey, {
      getProps: () => stableRef.current,
      onReady: () => setReady(true),
      onEvent: (name, data) => {
        if (name === "shown") {
          setShown(true);
          return;
        }
        if (name === "shellScroll") {
          // Only a full size tab view has a box of its own to scroll.
          if (loadsRef.current) {
            setShellScroll((data as { on?: unknown } | null)?.on === true);
          }
          return;
        }
        if (name === "cover") {
          if (fitRef.current === "content" || fitRef.current === "inline") {
            const width = (data as { width?: unknown } | null)?.width;
            const next = width === "wide" ? "wide" : width === true;
            coverRef.current = !!next;
            setCover(next);
          }
          return;
        }
        if (name === "drawn") {
          setDrawn((data as { drawn?: unknown } | null)?.drawn === true);
          eventRef.current?.(name, data);
          return;
        }
        if (name !== "size") {
          eventRef.current?.(name, data);
          return;
        }
        // A covering view reports the surface's size, not its own.
        if (coverRef.current) return;
        if (!data || typeof data !== "object") return;
        const { width, height } = data as { width?: unknown; height?: unknown };
        if (typeof width !== "number" || typeof height !== "number") return;
        const next = {
          width: Math.max(0, Math.min(width, 10_000)),
          height: Math.max(0, Math.min(height, 20_000)),
        };
        setSize(next);
        rememberSize(rememberedRef.current, next);
        eventRef.current?.(name, next);
      },
    });
    connection.current = next;
    return keepAlive(element, sig, next, controlRef, connection);
    // controlRef is read once per frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginId, frameKey, src]);

  // The layer for other plugins' parts sits next to the frame from the
  // start, so it never moves when the view starts or stops shell scrolling.
  useLayoutEffect(() => {
    const element = iframe.current;
    const box = anchor.current;
    if (!element || !box) return;
    setForeignAnchor(element, box);
    return () => setForeignAnchor(element, null);
  }, [loads]);

  useLayoutEffect(() => {
    if (!cover || !surfaceCover) return;
    surfaceCover.openView(coverId, cover);
    return () => surfaceCover.closeView(coverId);
  }, [cover, surfaceCover, coverId]);

  // Follows the surface's box while covering it, or the window outside one.
  const coverTarget = surfaceCover?.overlay ?? null;
  useLayoutEffect(() => {
    if (!cover) {
      setCoverRect(null);
      return;
    }
    const measure = () =>
      setCoverRect(
        coverTarget
          ? coverTarget.getBoundingClientRect()
          : new DOMRect(0, 0, window.innerWidth, window.innerHeight),
      );
    measure();
    window.addEventListener("resize", measure);
    const observer =
      coverTarget && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measure)
        : null;
    if (coverTarget) observer?.observe(coverTarget);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [cover, coverTarget]);

  // The view lays out at least as tall as the box it scrolls in.
  useEffect(() => {
    const box = wrap.current;
    if (!shellScroll || !box) return;
    const report = () => {
      const height = box.clientHeight;
      setViewport(height);
      connection.current?.port?.emit("viewport", { height });
    };
    report();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(report);
    observer.observe(box);
    return () => observer.disconnect();
  }, [shellScroll, ready]);

  // A view placed in another plugin's page tells it the size it had last
  // time right away, so the page lays out once instead of as it loads.
  useLayoutEffect(() => {
    const known = lastSize(rememberedRef.current);
    if (known && fit !== "fill" && fit !== "overlay") {
      eventRef.current?.("size", known);
    }
    // Once per view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginId, frameKey]);

  // No background frame here: a call into the plugin's code starts it.

  // Covers the frame until it painted, so there is one spinner, not a
  // blank gap and then the frame's own.
  const waiting = !ready || !shown;
  useEffect(() => {
    if (!ready || shown) return;
    // A frame that never says so still gets uncovered.
    const timer = setTimeout(() => setShown(true), SHOWN_GRACE_MS);
    return () => clearTimeout(timer);
  }, [ready, shown]);
  useEffect(() => {
    if (ready && shown) eventRef.current?.("shown", null);
  }, [ready, shown]);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!loads || !waiting) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), LOADING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [loads, waiting]);

  useEffect(() => {
    if (!import.meta.env.DEV || ready) return;
    const timer = setTimeout(() => {
      console.warn(`[frame] ${pluginId}:${frameKey} never reported ready`);
    }, 15_000);
    return () => clearTimeout(timer);
  }, [ready, pluginId, frameKey]);

  // Props go over once the frame is up, and again whenever they change.
  useEffect(() => {
    const port = connection.current?.port;
    if (!ready || !port) return;
    let signature: string | null = null;
    try {
      signature = JSON.stringify(stable, (_key, value) =>
        typeof value === "function" ? "[fn]" : value,
      );
    } catch {
      signature = null;
    }
    if (signature !== null && signature === lastSent.current) return;
    lastSent.current = signature;
    port.emit("props", stable);
  }, [ready, stable]);

  const scrolledHeight = Math.max(size?.height ?? 0, viewport);
  const sizing: CSSProperties = shellScroll
    ? { width: "100%", height: `${scrolledHeight}px`, flex: "none" }
    : fit === "fill" || fit === "overlay"
      ? { width: "100%", height: "100%", flex: "1 1 auto", minHeight: 0 }
      : fit === "inline"
        ? {
            width: size ? `${size.width}px` : 0,
            height: size ? `${size.height}px` : 0,
          }
        : fit === "bar"
          ? { width: size ? `${size.width}px` : 0, height: "100%" }
          : { width: "100%", height: size ? `${size.height}px` : 0 };

  // An empty inline view leaves the row alone: no width, no gap, and the
  // owner's fallback in its place.
  const empty =
    (fit === "inline" && (!size || size.width === 0 || size.height === 0)) ||
    (fit === "bar" && (!size || size.width === 0));
  const hidden: CSSProperties =
    empty && fallback !== undefined
      ? { position: "absolute", pointerEvents: "none" }
      : overlay && !drawn
        ? { pointerEvents: "none", visibility: "hidden" }
        : {};

  const frame = (
    <iframe
      ref={iframe}
      src={src}
      sandbox={SANDBOX}
      referrerPolicy="no-referrer"
      allow={FRAME_ALLOW}
      title={pluginId}
      data-plugin-frame={pluginId}
      className={className}
      // No inline border: the base styles already zero it, and an owner's
      // divider classes can then draw one.
      style={{
        display: "block",
        background: "transparent",
        colorScheme: "normal",
        ...sizing,
        ...hidden,
        ...style,
        ...(coverRect
          ? {
              position: "fixed",
              left: `${coverRect.left}px`,
              top: `${coverRect.top}px`,
              width: `${coverRect.width}px`,
              height: `${coverRect.height}px`,
              zIndex: 41,
              visibility: "visible",
              pointerEvents: "auto",
            }
          : {}),
      }}
    />
  );
  if (loads) {
    return (
      <div
        ref={wrap}
        className="relative flex h-full min-h-0 w-full flex-1 flex-col"
        style={
          shellScroll
            ? { display: "block", overflowX: "hidden", overflowY: "auto" }
            : undefined
        }
        data-frame-loading={ready ? undefined : ""}
        data-shell-scroll={shellScroll ? "" : undefined}
      >
        {frame}
        <div
          ref={anchor}
          data-foreign-anchor=""
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: "100%",
            height: shellScroll ? `${scrolledHeight}px` : "100%",
            pointerEvents: "none",
          }}
        />
        {slow && waiting && (
          <LoadingState
            className={
              transparent
                ? "absolute inset-0"
                : "absolute inset-0 bg-background"
            }
          />
        )}
      </div>
    );
  }
  // One shape always, so covering never remounts the frame. The spacer keeps
  // the page from jumping while the frame is lifted out of it.
  return (
    <>
      {empty && fallback}
      {coverRect && size && fit === "content" && (
        <div aria-hidden style={{ height: `${size.height}px` }} />
      )}
      {frame}
    </>
  );
}
