/**
 * One plugin view in a sandboxed frame. The frame gets an opaque origin
 * (sandbox="allow-scripts" only), loads from the plugin's own asset folder
 * and talks to the shell through a checked port. Props cross as data, with
 * functions passed by reference.
 */

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { usePluginStore } from "../plugin-store";
import { useInSeamlessTile } from "@/components/tile-grid/context";
import {
  useSurfaceClose,
  useSurfaceKind,
} from "@/components/surface/surface-scope";
import {
  connectFrame,
  frameUrl,
  type FrameConnection,
} from "./frame-connection";
import { useStableProps } from "@/plugin-frame/stable-props";
import { acquireFramedPlugin } from "./frame-demand";

/**
 * fill: takes the box it is given. content: full width, as tall as the
 * view. inline: as wide and tall as the view, for a toolbar button.
 * overlay: fills the box, see-through, and only takes clicks while the view
 * draws something.
 */
export type FrameFit = "fill" | "content" | "inline" | "overlay";

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
  const seeThrough = transparent || overlay;
  const [drawn, setDrawn] = useState(!overlay);
  const eventRef = useRef(onFrameEvent);
  eventRef.current = onFrameEvent;
  const iframe = useRef<HTMLIFrameElement>(null);
  const connection = useRef<FrameConnection | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [ready, setReady] = useState(false);
  // Layout context a plugin component reads, which can't cross by itself.
  const seamless = useInSeamlessTile();
  const surfaceKind = useSurfaceKind();
  const surfaceClose = useSurfaceClose();
  const placed = useMemo(
    () => ({
      ...props,
      __place: { seamless, surfaceKind },
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

  const src = useMemo(
    () =>
      frameUrl(pluginId, {
        role: "view",
        key: frameKey,
        fit: fit === "fill" || fit === "overlay" ? "fill" : "content",
        inline: fit === "inline" ? "1" : undefined,
        bg: seeThrough ? "none" : undefined,
        drawn: overlay ? "1" : undefined,
        edge: edge ? "1" : undefined,
        v: version || undefined,
      }),
    [pluginId, frameKey, fit, seeThrough, overlay, edge, version],
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
    lastSent.current = null;
    const next = connectFrame(element, pluginId, "view", frameKey, {
      getProps: () => stableRef.current,
      onReady: () => setReady(true),
      onEvent: (name, data) => {
        if (name === "drawn") {
          setDrawn((data as { drawn?: unknown } | null)?.drawn === true);
          eventRef.current?.(name, data);
          return;
        }
        if (name !== "size") {
          eventRef.current?.(name, data);
          return;
        }
        if (!data || typeof data !== "object") return;
        const { width, height } = data as { width?: unknown; height?: unknown };
        if (typeof width !== "number" || typeof height !== "number") return;
        const next = {
          width: Math.max(0, Math.min(width, 10_000)),
          height: Math.max(0, Math.min(height, 20_000)),
        };
        setSize(next);
        eventRef.current?.(name, next);
      },
    });
    connection.current = next;
    return keepAlive(element, sig, next, controlRef, connection);
    // controlRef is read once per frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginId, frameKey, src]);

  // A view may call into its plugin's background code.
  useEffect(() => acquireFramedPlugin(pluginId), [pluginId]);

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

  const sizing: CSSProperties =
    fit === "fill" || fit === "overlay"
      ? { width: "100%", height: "100%", flex: "1 1 auto", minHeight: 0 }
      : fit === "inline"
        ? {
            width: size ? `${size.width}px` : 0,
            height: size ? `${size.height}px` : 0,
          }
        : { width: "100%", height: size ? `${size.height}px` : 0 };

  // An empty inline view leaves the row alone: no width, no gap, and the
  // owner's fallback in its place.
  const empty =
    fit === "inline" && (!size || size.width === 0 || size.height === 0);
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
      allow="clipboard-write"
      title={pluginId}
      data-plugin-frame={pluginId}
      className={className}
      style={{
        border: 0,
        display: "block",
        background: "transparent",
        colorScheme: "normal",
        ...sizing,
        ...hidden,
        ...style,
      }}
    />
  );
  if (fallback === undefined) return frame;
  return (
    <>
      {empty && fallback}
      {frame}
    </>
  );
}
