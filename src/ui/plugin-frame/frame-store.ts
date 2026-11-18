/**
 * What the shell pushed to this frame, for hooks that read it during render.
 */

import { useSyncExternalStore } from "react";
import type { FrameState } from "./protocol";

const EMPTY: FrameState = {
  theme: { className: "", style: "", mode: "dark", themeId: "dark", css: [] },
  hosts: [],
  hostsLoaded: false,
  user: null,
  permissions: [],
  permissionsLoaded: false,
  hostStatus: {},
  statusColorScheme: "accent",
  tabs: [],
  tabsReady: false,
  layout: null,
  uiPreferences: {},
  sshAuthTypes: { loaded: false, types: [] },
  activityTypes: [],
  activityTargets: {},
  companions: [],
  hostActions: [],
  desktop: { available: false, remoteServerUrl: null },
  isMobile: false,
};

let state: FrameState = EMPTY;
const listeners = new Set<() => void>();

export function getFrameState(): FrameState {
  return state;
}

export function setFrameState(next: Partial<FrameState>): void {
  state = { ...state, ...next };
  for (const listener of [...listeners]) listener();
}

export function subscribeFrameState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useFrameState<T>(select: (state: FrameState) => T): T {
  return useSyncExternalStore(
    subscribeFrameState,
    () => select(state),
    () => select(state),
  );
}

/** Test seam. */
export function resetFrameState(): void {
  state = EMPTY;
  listeners.clear();
}
