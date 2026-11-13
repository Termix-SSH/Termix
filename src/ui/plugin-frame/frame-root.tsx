/* eslint-disable react-refresh/only-export-components */
/**
 * What every frame renders around the plugin: the same providers the shell
 * gives plugin views, the props the shell sends, and size reports for views
 * that grow with their content.
 */

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
import {
  SurfaceScope,
  type EditingWidth,
  type SurfaceKind,
} from "@/components/surface/surface-scope";
import { SeamlessTileContext } from "@/components/tile-grid/context";
import { useFrameState } from "./frame-store";

export type FrameFit = "fill" | "content" | "inline";

let props: Record<string, unknown> = {};
const listeners = new Set<() => void>();

export function setFrameProps(next: Record<string, unknown>): void {
  props = next;
  for (const listener of [...listeners]) listener();
}

function useFrameProps(): Record<string, unknown> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => props,
    () => props,
  );
}

function ThemeSync() {
  const themeId = useFrameState((state) => state.theme.themeId);
  const className = useFrameState((state) => state.theme.className);
  const { setTheme } = useTheme();
  useEffect(() => {
    setTheme(themeId, false);
    // The shell's own classes (density, motion) ride along with the theme.
    const frame = requestAnimationFrame(() => {
      document.documentElement.className = className;
    });
    return () => cancelAnimationFrame(frame);
  }, [themeId, className, setTheme]);
  return null;
}

type HandleCall = (method: string, ...args: unknown[]) => Promise<unknown>;

/**
 * A companion gets the tab's handle as getHandle(). Its methods call the
 * shell, so in a frame they all return promises.
 */
function handleProxy(call: HandleCall): Record<string, unknown> {
  return new Proxy(
    {},
    {
      get: (_target, name) =>
        typeof name === "string" && name !== "then"
          ? (...args: unknown[]) => call(name, ...args)
          : undefined,
    },
  );
}

/** Where the frame sits in the shell, sent along with the props. */
interface FramePlace {
  seamless?: boolean;
  surfaceKind?: SurfaceKind | null;
}

function View({
  component: Component,
  fit,
}: {
  component: ComponentType<Record<string, unknown>>;
  fit: FrameFit;
}) {
  const current = useFrameProps();
  const { shown, place, close, setEditing } = useMemo(() => {
    const { handleCall, __place, __surfaceClose, ...rest } = current as Record<
      string,
      unknown
    > & { __place?: FramePlace };
    const props: Record<string, unknown> = { ...rest };
    if (typeof handleCall === "function") {
      const handle = handleProxy(handleCall as HandleCall);
      props.getHandle = () => handle;
    }
    return {
      shown: props,
      place: __place ?? {},
      close:
        typeof __surfaceClose === "function"
          ? (__surfaceClose as () => void)
          : undefined,
      setEditing:
        typeof rest.setEditing === "function"
          ? (rest.setEditing as (editing: EditingWidth) => void)
          : undefined,
    };
  }, [current]);
  return (
    <SeamlessTileContext.Provider value={!!place.seamless}>
      <SurfaceScope
        kind={place.surfaceKind ?? "panel"}
        onClose={close}
        onEditingChange={setEditing}
        className={fit === "fill" ? "h-full" : undefined}
      >
        <Component {...shown} />
      </SurfaceScope>
    </SeamlessTileContext.Provider>
  );
}

export function FrameRoot({
  fit,
  component,
  children,
  onSize,
}: {
  fit: FrameFit;
  component?: ComponentType<Record<string, unknown>>;
  children?: ReactNode;
  onSize?: (size: { width: number; height: number }) => void;
}) {
  const themeId = useFrameState((state) => state.theme.themeId);
  const box = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    document.documentElement.dataset.frameFit = fit;
    const element = box.current;
    if (!element || !onSize) return;
    let last = "";
    const report = () => {
      const width = Math.ceil(element.scrollWidth);
      const height = Math.ceil(element.scrollHeight);
      const next = `${width}x${height}`;
      if (next === last) return;
      last = next;
      onSize({ width, height });
    };
    const observer = new ResizeObserver(report);
    observer.observe(element);
    report();
    return () => observer.disconnect();
  }, [fit, onSize]);

  return (
    <ThemeProvider defaultTheme={themeId} storageKey="termix-frame-theme">
      <ThemeSync />
      <div
        ref={box}
        className={
          fit === "fill"
            ? "flex h-full w-full min-h-0 flex-col"
            : fit === "inline"
              ? "inline-flex flex-col"
              : "inline-flex w-full flex-col"
        }
      >
        {component ? (
          <View component={component} fit={fit} />
        ) : (
          <SurfaceScope className={fit === "fill" ? "h-full" : undefined}>
            {children}
          </SurfaceScope>
        )}
      </div>
    </ThemeProvider>
  );
}
