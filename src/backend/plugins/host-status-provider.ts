/**
 * Host status is a provider: core owns the interface and the callers (the
 * status routes, the sync feed, ctx.hosts.status), and one provider fills it.
 * A plugin registers with ctx.hosts.status.provide. With none, every status
 * is unknown.
 */

export type ProviderHostStatus = "online" | "reachable" | "offline";

export interface HostStatusEntry {
  status: ProviderHostStatus;
  lastChecked: string;
}

export type HostPortResolver = (
  hostId: number,
) => number | undefined | Promise<number | undefined>;

export interface HostStatusProvider {
  start(): void;
  stop(): void;
  get(hostId: number): HostStatusEntry | null;
  /** All known statuses after bringing polling in line with the request. */
  statusesFor(
    userId: string,
    requestedHostIds: Set<number> | null,
  ): Promise<Map<number, HostStatusEntry>>;
  refresh(userId: string): Promise<void>;
  check(hostId: number): Promise<HostStatusEntry | null>;
  reportLogin(hostId: number, outcome: { ok: boolean }): void;
  registerPort(connectionType: string, resolve: HostPortResolver): () => void;
  getIntervalSeconds(): Promise<number>;
  setIntervalSeconds(seconds: number): Promise<void>;
}

let builtin: HostStatusProvider | null = null;
let plugged: { pluginId: string; provider: HostStatusProvider } | null = null;
let running = false;
const ports = new Map<symbol, { type: string; resolve: HostPortResolver }>();
const portDrops = new Map<symbol, () => void>();

function active(): HostStatusProvider | null {
  return plugged?.provider ?? builtin;
}

function attachPorts(provider: HostStatusProvider): void {
  for (const [key, { type, resolve }] of ports) {
    portDrops.set(key, provider.registerPort(type, resolve));
  }
}

function detachPorts(): void {
  for (const drop of portDrops.values()) drop();
  portDrops.clear();
}

function swap(next: () => void): void {
  const before = active();
  if (running) before?.stop();
  detachPorts();
  next();
  const after = active();
  if (after) attachPorts(after);
  if (running) after?.start();
}

/** A fallback provider. Core registers none; tests use it. */
export function registerBuiltinHostStatusProvider(
  provider: HostStatusProvider | null,
): void {
  swap(() => {
    builtin = provider;
  });
}

/** Returns the remover. A second provider is refused. */
export function provideHostStatus(
  pluginId: string,
  provider: HostStatusProvider,
): () => void {
  if (plugged) {
    throw new Error(
      `Host status is already provided by plugin "${plugged.pluginId}"`,
    );
  }
  const entry = { pluginId, provider };
  swap(() => {
    plugged = entry;
  });
  return () => {
    if (plugged !== entry) return;
    swap(() => {
      plugged = null;
    });
  };
}

export function hostStatusProviderId(): string | null {
  return plugged?.pluginId ?? null;
}

/** What the rest of core calls. */
export const hostStatus = {
  start(): void {
    running = true;
    active()?.start();
  },
  stop(): void {
    running = false;
    active()?.stop();
  },
  get(hostId: number): HostStatusEntry | null {
    return active()?.get(hostId) ?? null;
  },
  async statusesFor(
    userId: string,
    requestedHostIds: Set<number> | null,
  ): Promise<Map<number, HostStatusEntry>> {
    return (await active()?.statusesFor(userId, requestedHostIds)) ?? new Map();
  },
  async refresh(userId: string): Promise<void> {
    await active()?.refresh(userId);
  },
  async check(hostId: number): Promise<HostStatusEntry | null> {
    return (await active()?.check(hostId)) ?? null;
  },
  reportLogin(hostId: number, outcome: { ok: boolean }): void {
    active()?.reportLogin(hostId, outcome);
  },
  /** Kept across a provider change, so a plugin's port stays registered. */
  registerPort(connectionType: string, resolve: HostPortResolver): () => void {
    const key = Symbol(connectionType);
    ports.set(key, { type: connectionType, resolve });
    const provider = active();
    if (provider)
      portDrops.set(key, provider.registerPort(connectionType, resolve));
    return () => {
      ports.delete(key);
      portDrops.get(key)?.();
      portDrops.delete(key);
    };
  },
  async getIntervalSeconds(): Promise<number> {
    return (await active()?.getIntervalSeconds()) ?? 30;
  },
  async setIntervalSeconds(seconds: number): Promise<void> {
    await active()?.setIntervalSeconds(seconds);
  },
};
