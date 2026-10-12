import { useEffect, useState } from "react";
import { isElectron } from "@/lib/electron";

export type DesktopUpdateMode = "automatic" | "prompt" | "never";

export type DesktopInstallKind = "auto" | "manual" | "store" | "disabled";

export type DesktopUpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "up-to-date"
  | "error";

export interface DesktopUpdateState {
  kind: DesktopInstallKind;
  mode: DesktopUpdateMode;
  currentVersion: string;
  status: DesktopUpdateStatus;
  version: string | null;
  releaseUrl: string | null;
  progress: number | null;
  error: string | null;
}

interface DesktopUpdatesBridge {
  getState: () => Promise<DesktopUpdateState | null>;
  check: () => Promise<DesktopUpdateState | null>;
  download: () => Promise<DesktopUpdateState | null>;
  install: () => Promise<boolean>;
  setMode: (mode: DesktopUpdateMode) => Promise<DesktopUpdateState | null>;
  onState: (callback: (state: DesktopUpdateState) => void) => () => void;
}

type UpdatesWindow = Window &
  typeof globalThis & {
    electronAPI?: { updates?: DesktopUpdatesBridge };
  };

/** The main process updater, or null in the browser and on older builds. */
export function desktopUpdates(): DesktopUpdatesBridge | null {
  if (!isElectron()) return null;
  return (window as UpdatesWindow).electronAPI?.updates ?? null;
}

/** Whether this install has an updater the user can configure. */
export function canConfigureUpdates(
  state: DesktopUpdateState | null,
): state is DesktopUpdateState {
  return !!state && state.kind !== "store" && state.kind !== "disabled";
}

/** Which toast, if any, this state calls for. */
export function updateToastFor(
  state: DesktopUpdateState | null,
): "prompt" | "manual" | "ready" | null {
  if (!state || !state.version || state.mode === "never") return null;
  if (state.status === "downloaded") return "ready";
  if (state.status !== "available") return null;
  if (state.kind === "manual") return "manual";
  if (state.kind === "auto" && state.mode === "prompt") return "prompt";
  return null;
}

export function useDesktopUpdate(): DesktopUpdateState | null {
  const [state, setState] = useState<DesktopUpdateState | null>(null);

  useEffect(() => {
    const bridge = desktopUpdates();
    if (!bridge) return;
    let active = true;
    bridge
      .getState()
      .then((next) => active && next && setState(next))
      .catch(() => {});
    const off = bridge.onState((next) => active && setState(next));
    return () => {
      active = false;
      off();
    };
  }, []);

  return state;
}
