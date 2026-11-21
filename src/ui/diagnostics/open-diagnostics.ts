/** Asks core to open the diagnostics page; detail may name a plugin. */
export const OPEN_DIAGNOSTICS_EVENT = "termix:open-diagnostics";

export interface OpenDiagnosticsOptions {
  /** Puts this plugin first and files the issue on its repo. */
  pluginId?: string;
}

export function openDiagnostics(options: OpenDiagnosticsOptions = {}): void {
  window.dispatchEvent(
    new CustomEvent(OPEN_DIAGNOSTICS_EVENT, { detail: options }),
  );
}

/** Ctrl+Alt+Shift+D, which works even when the layout is broken. */
export function isDiagnosticsShortcut(event: KeyboardEvent): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    event.altKey &&
    event.shiftKey &&
    event.code === "KeyD"
  );
}

/** The ?diagnostics address opens the page on load, before any plugin. */
export function diagnosticsRequested(search = window.location.search): boolean {
  return new URLSearchParams(search).has("diagnostics");
}

/** The page is drawn at z-[1000], so its menus must open above it. */
export const DIAGNOSTICS_MENU_CLASS = "z-[1001]";
