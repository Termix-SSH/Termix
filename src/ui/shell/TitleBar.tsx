/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState } from "react";
import { isElectron } from "@/lib/electron";
import { useBranding } from "@/contexts/BrandingContext";

/**
 * The height of the bar the desktop app draws on top of its window. The
 * Electron main process uses the same number for the window controls the
 * system draws, so both line up.
 */
export const TITLE_BAR_HEIGHT = 40;

/**
 * How far content starts below the top of the window. The bar sets the
 * variable only while it shows, so it is 0 on the web, in full screen and in
 * windows that keep the native title bar.
 */
export const TITLE_BAR_OFFSET = "var(--termix-titlebar-height, 0px)";

/** Room the macOS traffic lights take on the left. */
const MAC_TRAFFIC_LIGHTS_WIDTH = 78;
/** Room the Windows and Linux window controls take on the right. */
const OVERLAY_CONTROLS_WIDTH = 140;

type Platform = "darwin" | "win32" | "linux" | "other";

/**
 * The title bar of the desktop app. The system draws its own frame, so the
 * bar is drawn by the app instead: it takes the colors of the active theme
 * and keeps the window controls the system draws on top of it.
 */
export function TitleBar() {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isElectron()) return;
    let cancelled = false;
    const api = window.electronAPI;
    if (typeof api?.getPlatform === "function") {
      void api
        .getPlatform()
        .then((value: string) => {
          if (!cancelled) setPlatform(value as Platform);
        })
        .catch(() => {});
    } else {
      // Without the bridge, fall back to what the user agent says.
      setPlatform(/mac/i.test(navigator.userAgent) ? "darwin" : "other");
    }

    // Older builds without the visibility bridge always show the bar.
    if (typeof api?.getTitleBarVisible === "function") {
      void api
        .getTitleBarVisible()
        .then((value) => {
          if (!cancelled) setVisible(value);
        })
        .catch(() => {});
    } else {
      setVisible(true);
    }
    const unsubscribe = api?.onTitleBarVisibleChange?.(setVisible);
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const shown = isElectron() && platform !== null && visible;

  useEffect(() => {
    if (!shown) return;
    const root = document.documentElement;
    root.style.setProperty("--termix-titlebar-height", `${TITLE_BAR_HEIGHT}px`);
    return () => {
      root.style.removeProperty("--termix-titlebar-height");
    };
  }, [shown]);

  if (!shown) return null;

  const isMac = platform === "darwin";
  const hasOverlayControls = platform === "win32" || platform === "linux";

  return (
    <div
      className="termix-titlebar fixed inset-x-0 top-0 z-[70] flex items-center bg-sidebar border-b border-border"
      style={{ height: TITLE_BAR_HEIGHT }}
    >
      {isMac && (
        <div
          className="shrink-0"
          style={{ width: MAC_TRAFFIC_LIGHTS_WIDTH }}
          aria-hidden="true"
        />
      )}

      <TitleLabel />

      <div className="flex-1" />

      {hasOverlayControls && (
        <div
          className="shrink-0"
          style={{ width: OVERLAY_CONTROLS_WIDTH }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

/** The name of the app, centered like the native bars do. */
function TitleLabel() {
  const { appName } = useBranding();
  return (
    <div className="pointer-events-none absolute inset-x-0 flex items-center justify-center">
      <span className="truncate px-3 text-sm font-medium text-muted-foreground">
        {appName}
      </span>
    </div>
  );
}

/**
 * Keeps the window controls the system draws in the colors of the theme.
 * Only Windows and Linux draw them, macOS keeps its own traffic lights.
 *
 * The theme is a class on the root element, so the colors are read from the
 * style sheet whenever it changes.
 */
export function useTitleBarOverlayColors() {
  useEffect(() => {
    if (!isElectron()) return;
    const api = window.electronAPI;
    if (typeof api?.setTitleBarOverlay !== "function") return;

    const send = () => {
      // Computed colors always come back as rgb(), whatever format the
      // theme uses (hex, oklch, ...).
      const styles = getComputedStyle(document.body);
      const color =
        toHexColor(sidebarColor()) || toHexColor(styles.backgroundColor);
      if (!color) return;
      api.setTitleBarOverlay({
        color,
        symbolColor: toHexColor(styles.color) || "#e6e6ea",
      });
    };

    send();
    const observer = new MutationObserver(send);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    return () => observer.disconnect();
  }, []);
}

/** The sidebar color of the active theme, which the bar is drawn with. */
function sidebarColor(): string {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;visibility:hidden;background-color:var(--sidebar)";
  document.body.appendChild(probe);
  const color = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return color;
}

/** Browsers keep oklch() and similar as written, so let a canvas convert. */
function canvasRgb(color: string): string {
  const context = document.createElement("canvas").getContext?.("2d");
  if (!context) return "";
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
  return a === 0 ? "" : `rgb(${r}, ${g}, ${b})`;
}

/** Turns a computed color into a hex string. */
function toHexColor(color: string): string {
  if (/^(oklch|oklab|lab|lch|color)\(/.test(color)) color = canvasRgb(color);
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
  // A fully transparent color has nothing to show; keep the last one.
  if (!match || match[4] === "0") return "";
  const [, r, g, b] = match;
  return `#${[r, g, b].map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`;
}
