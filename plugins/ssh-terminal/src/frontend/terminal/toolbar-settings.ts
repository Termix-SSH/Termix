import type { ToolbarDensity } from "./toolbar-geometry";

export const TOOLBAR_ANCHORS = [
  "bottom",
  "bottom-left",
  "bottom-right",
  "top",
  "top-left",
  "top-right",
] as const;
export type ToolbarAnchor = (typeof TOOLBAR_ANCHORS)[number];

export interface ToolbarSettings {
  anchor: ToolbarAnchor;
  startCollapsed: boolean;
  /** null keeps whatever mode the user last picked in the toolbar. */
  density: ToolbarDensity | null;
  showStatus: boolean;
  fadeWhenIdle: boolean;
}

export const DEFAULT_TOOLBAR_SETTINGS: ToolbarSettings = {
  anchor: "bottom",
  startCollapsed: false,
  density: null,
  showStatus: true,
  fadeWhenIdle: true,
};

const DENSITIES: ToolbarDensity[] = ["icon", "labeled", "expanded"];

/** The toolbar's host settings, as the host payload carries them. */
export function readToolbarSettings(
  host: object | null | undefined,
): ToolbarSettings {
  const values =
    (
      host as {
        pluginSettings?: Record<string, Record<string, unknown>>;
      } | null
    )?.pluginSettings?.["ssh-terminal"] ?? {};
  const anchor = values.terminalToolbarPosition;
  const density = values.terminalToolbarDisplay;
  const bool = (value: unknown, fallback: boolean) =>
    typeof value === "boolean" ? value : fallback;
  return {
    anchor: TOOLBAR_ANCHORS.includes(anchor as ToolbarAnchor)
      ? (anchor as ToolbarAnchor)
      : DEFAULT_TOOLBAR_SETTINGS.anchor,
    startCollapsed: values.terminalToolbarStartState === "collapsed",
    density: DENSITIES.includes(density as ToolbarDensity)
      ? (density as ToolbarDensity)
      : null,
    showStatus: bool(
      values.terminalToolbarShowStatus,
      DEFAULT_TOOLBAR_SETTINGS.showStatus,
    ),
    fadeWhenIdle: bool(
      values.terminalToolbarFade,
      DEFAULT_TOOLBAR_SETTINGS.fadeWhenIdle,
    ),
  };
}

export function isLeftAnchor(anchor: ToolbarAnchor): boolean {
  return anchor.endsWith("-left");
}

export function isTopAnchor(anchor: ToolbarAnchor): boolean {
  return anchor.startsWith("top");
}

/** Flex placement for the full-size overlay that holds the toolbar. */
export function toolbarAnchorClasses(anchor: ToolbarAnchor): string {
  const vertical = isTopAnchor(anchor) ? "items-start pt-2" : "items-end pb-2";
  const horizontal = anchor.endsWith("-left")
    ? "justify-start pl-2"
    : anchor.endsWith("-right")
      ? "justify-end pr-2"
      : "justify-center";
  return `${vertical} ${horizontal}`;
}
