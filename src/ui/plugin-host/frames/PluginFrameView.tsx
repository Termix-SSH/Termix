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

/**
 * fill: takes the box it is given. content: full width, as tall as the
 * view. inline: as wide and tall as the view, for a toolbar button.
 */
export type FrameFit = "fill" | "content" | "inline";

export interface PluginFrameViewProps {
  pluginId: string;
  frameKey: string;
  fit: FrameFit;
  /** Lets the page behind show through, for overlays. */
  transparent?: boolean;
  props: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}

export const SANDBOX = "allow-scripts";

/**
 * Functions in props get a new identity every render. Each is passed to the
 * frame as one stable stand-in that calls whatever the latest props hold.
 */
function useStableProps(props: Record<string, unknown>) {
  const latest = useRef(props);
  latest.current = props;
  const cache = useRef(new Map<string, (...args: unknown[]) => unknown>());

  return useMemo(() => {
    const walk = (value: unknown, path: string, depth: number): unknown => {
      if (typeof value === "function") {
        let stable = cache.current.get(path);
        if (!stable) {
          stable = (...args: unknown[]) => {
            let target: unknown = latest.current;
            for (const part of path.split(".")) {
              target = (target as Record<string, unknown> | undefined)?.[part];
            }
            return typeof target === "function"
              ? (target as (...a: unknown[]) => unknown)(...args)
              : undefined;
          };
          cache.current.set(path, stable);
        }
        return stable;
      }
      if (
        depth < 2 &&
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.getPrototypeOf(value) === Object.prototype
      ) {
        const out: Record<string, unknown> = {};
        for (const [name, item] of Object.entries(value)) {
          out[name] = walk(item, `${path}.${name}`, depth + 1);
        }
        return out;
      }
      return value;
    };
    const out: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(props)) {
      out[name] = walk(value, name, 0);
    }
    return out;
  }, [props]);
}

export function PluginFrameView({
  pluginId,
  frameKey,
  fit,
  transparent,
  props,
  className,
  style,
}: PluginFrameViewProps) {
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
        fit: fit === "fill" ? "fill" : "content",
        inline: fit === "inline" ? "1" : undefined,
        bg: transparent ? "none" : undefined,
        v: version || undefined,
      }),
    [pluginId, frameKey, fit, transparent, version],
  );

  useLayoutEffect(() => {
    const element = iframe.current;
    if (!element) return;
    setReady(false);
    lastSent.current = null;
    const next = connectFrame(element, pluginId, "view", frameKey, {
      getProps: () => stableRef.current,
      onReady: () => setReady(true),
      onEvent: (name, data) => {
        if (name !== "size" || !data || typeof data !== "object") return;
        const { width, height } = data as { width?: unknown; height?: unknown };
        if (typeof width !== "number" || typeof height !== "number") return;
        setSize({
          width: Math.max(0, Math.min(width, 10_000)),
          height: Math.max(0, Math.min(height, 20_000)),
        });
      },
    });
    connection.current = next;
    return () => {
      next.close();
      connection.current = null;
    };
  }, [pluginId, frameKey, src]);

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
    fit === "fill"
      ? { width: "100%", height: "100%", flex: "1 1 auto", minHeight: 0 }
      : fit === "inline"
        ? {
            width: size ? `${size.width}px` : 0,
            height: size ? `${size.height}px` : 0,
          }
        : { width: "100%", height: size ? `${size.height}px` : 0 };

  return (
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
        ...style,
      }}
    />
  );
}
