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
import { TILE_CARD_LINES } from "@/components/tile-grid/TileColumn";
import { useFrameState } from "./frame-store";
import { markFrameShown } from "./frame-paint";
import { reportFrameCover } from "./frame-cover";

export type FrameFit = "fill" | "content" | "inline" | "bar";

/** Room below the content while a menu is open, so it can open downward. */
export const OPEN_MENU_ROOM = 320;

/**
 * A frame sized to its content clips anything past its edge, so while a menu
 * or popover is open the frame also covers it, with room for it to open down.
 */
export function withOpenMenus(height: number): number {
  const open = document.querySelectorAll<HTMLElement>(
    "[data-radix-popper-content-wrapper]",
  );
  if (open.length === 0) return height;
  let bottom = height + OPEN_MENU_ROOM;
  for (const menu of open) {
    bottom = Math.max(bottom, menu.getBoundingClientRect().bottom + 8);
  }
  return Math.ceil(bottom);
}

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
        onEditingChange={(editing) => {
          setEditing?.(editing);
          if (fit === "content" || fit === "inline") reportFrameCover(editing);
        }}
        className={fit === "fill" || fit === "bar" ? "h-full" : undefined}
      >
        {place.seamless && fit === "content" ? (
          // The column around the frame can't draw lines inside it.
          <div className={`flex min-w-0 flex-col ${TILE_CARD_LINES}`}>
            <Component {...shown} />
          </div>
        ) : (
          <Component {...shown} />
        )}
      </SurfaceScope>
    </SeamlessTileContext.Provider>
  );
}

export function FrameRoot({
  fit,
  component,
  children,
  onSize,
  onDrawn,
}: {
  fit: FrameFit;
  component?: ComponentType<Record<string, unknown>>;
  children?: ReactNode;
  onSize?: (size: { width: number; height: number }) => void;
  /** For overlays: whether anything with a size is on screen. */
  onDrawn?: (drawn: boolean) => void;
}) {
  const themeId = useFrameState((state) => state.theme.themeId);
  const box = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => markFrameShown(), []);

  useLayoutEffect(() => {
    document.documentElement.dataset.frameFit = fit;
    const element = box.current;
    if (!element || !onSize) return;
    let last = "";
    const report = () => {
      // The box's real size: scroll sizes round down a fraction of a px,
      // which cut off a part's bottom border.
      const rect = element.getBoundingClientRect();
      const width = Math.ceil(Math.max(rect.width, element.scrollWidth));
      let height = Math.ceil(Math.max(rect.height, element.scrollHeight));
      if (fit === "content") height = withOpenMenus(height);
      const next = `${width}x${height}`;
      if (next === last) return;
      last = next;
      onSize({ width, height });
    };
    const observer = new ResizeObserver(report);
    observer.observe(element);
    // Menus open in portals on body, outside the box.
    const menus = new MutationObserver(report);
    if (fit === "content") {
      menus.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style", "data-state"],
      });
    }
    report();
    return () => {
      observer.disconnect();
      menus.disconnect();
    };
  }, [fit, onSize]);

  useEffect(() => {
    const element = box.current;
    if (!element || !onDrawn) return;
    let last: boolean | null = null;
    const check = () => {
      const drawn =
        [...element.querySelectorAll("*")].some((node) => {
          if (node.childElementCount > 0) return false;
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }) ||
        // Portals (a dialog the overlay opened) land on body.
        [...document.body.children].some(
          (child) =>
            child.id !== "root" &&
            !(child instanceof HTMLScriptElement) &&
            child.childElementCount > 0,
        );
      if (drawn === last) return;
      last = drawn;
      onDrawn(drawn);
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    const resize = new ResizeObserver(check);
    resize.observe(element);
    check();
    return () => {
      observer.disconnect();
      resize.disconnect();
    };
  }, [onDrawn]);

  return (
    <ThemeProvider defaultTheme={themeId} storageKey="termix-frame-theme">
      <ThemeSync />
      <div
        ref={box}
        data-frame-box=""
        className={
          fit === "fill"
            ? "flex h-full w-full min-h-0 flex-col"
            : fit === "inline"
              ? "inline-flex flex-col align-top"
              : fit === "bar"
                ? "inline-flex h-full flex-col align-top"
                : "inline-flex w-full flex-col align-top"
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
