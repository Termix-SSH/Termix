/**
 * The shell state every plugin frame mirrors. FrameStateSync fills it from
 * the shell's hooks; each change goes to every open frame, with the host list
 * cut down to the receiving plugin's own settings.
 */

import type { FrameState } from "@/plugin-frame/protocol";
import { toPluginHostRecord } from "../bridge";

export type SharedState = Omit<FrameState, "hosts"> & {
  /** The shell's hosts, with every plugin's settings. Cut per plugin. */
  shellHosts: Record<string, unknown>[];
};

let shared: SharedState = {
  theme: { className: "", style: "", mode: "dark", themeId: "dark", css: [] },
  shellHosts: [],
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

type Listener = (changed: Partial<SharedState>) => void;
const listeners = new Set<Listener>();

export function getSharedState(): SharedState {
  return shared;
}

export function setSharedState(next: Partial<SharedState>): void {
  const changed: Partial<SharedState> = {};
  for (const [key, value] of Object.entries(next) as [
    keyof SharedState,
    unknown,
  ][]) {
    if (sameValue(shared[key], value)) continue;
    (changed as Record<string, unknown>)[key] = value;
  }
  if (Object.keys(changed).length === 0) return;
  shared = { ...shared, ...changed };
  for (const listener of [...listeners]) listener(changed);
}

export function onSharedStateChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** The hosts as one plugin sees them, with the status the shell has. */
export function hostsFor(
  pluginId: string,
  hosts: Record<string, unknown>[] = shared.shellHosts,
): Record<string, unknown>[] {
  return hosts.map((host) => {
    const record = toPluginHostRecord(
      host as unknown as Parameters<typeof toPluginHostRecord>[0],
      pluginId,
    ) as unknown as Record<string, unknown>;
    const status = shared.hostStatus[String(host.id)] as
      { status?: string } | undefined;
    if (status?.status) {
      record.status = status.status;
      record.online = status.status === "online";
    }
    const protocols = (host as { protocols?: unknown }).protocols;
    if (Array.isArray(protocols)) record.protocols = protocols;
    return record;
  });
}

/** The full state for one plugin, for a frame that just started. */
export function frameStateFor(pluginId: string): FrameState {
  const { shellHosts, ...rest } = shared;
  return { ...rest, hosts: hostsFor(pluginId, shellHosts) };
}

/** A change, shaped for one plugin's frames. */
export function frameChangeFor(
  pluginId: string,
  changed: Partial<SharedState>,
): Partial<FrameState> {
  const { shellHosts, ...rest } = changed;
  const out: Partial<FrameState> = { ...rest };
  if (shellHosts || changed.hostStatus) {
    out.hosts = hostsFor(pluginId, shellHosts ?? shared.shellHosts);
  }
  return out;
}

/** Test seam. */
export function resetSharedState(): void {
  listeners.clear();
}
