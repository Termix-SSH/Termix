/**
 * Host locks and host status from a plugin process. Core reads both
 * synchronously (a host list, a route guard), so it keeps what the plugin
 * last reported instead of asking across the process line each time.
 */
import type {
  PluginHostLockProvider,
  PluginHostStatusEntry,
  PluginHostStatusProvider,
} from "@termix-ssh/plugin-sdk/backend";

type AnyFn = (...args: unknown[]) => unknown;

/** More locked hosts than this in one report is refused. */
export const MAX_LOCKED_HOSTS = 100_000;
const MAX_NOTE = 500;

export class ProviderBridgeError extends Error {
  readonly code = "SANDBOX_VALUE";
}

export interface LockSnapshot {
  locked: Map<number, string | null>;
  allowManualCreate: boolean;
}

/** Checks a lock report from the plugin: `{ hosts: [[id, note]], allowManualCreate }`. */
export function readLockSnapshot(raw: unknown): LockSnapshot {
  const value = (raw ?? {}) as { hosts?: unknown; allowManualCreate?: unknown };
  if (!Array.isArray(value.hosts)) {
    throw new ProviderBridgeError("A lock report needs a hosts list");
  }
  if (value.hosts.length > MAX_LOCKED_HOSTS) {
    throw new ProviderBridgeError("Too many locked hosts in one report");
  }
  const locked = new Map<number, string | null>();
  for (const entry of value.hosts) {
    const [id, note] = Array.isArray(entry) ? entry : [];
    if (!Number.isInteger(id) || (id as number) <= 0) continue;
    locked.set(
      id as number,
      typeof note === "string" && note ? note.slice(0, MAX_NOTE) : null,
    );
  }
  return { locked, allowManualCreate: value.allowManualCreate !== false };
}

/** A lock provider answering from the plugin's last report. */
export class SnapshotLockProvider implements PluginHostLockProvider {
  private snapshot: LockSnapshot;

  constructor(raw: unknown) {
    this.snapshot = readLockSnapshot(raw);
  }

  update(raw: unknown): void {
    this.snapshot = readLockSnapshot(raw);
  }

  isLocked = (hostId: number): boolean => this.snapshot.locked.has(hostId);
  note = (hostId: number): string | null =>
    this.snapshot.locked.get(hostId) ?? null;
  allowManualCreate = (): boolean => this.snapshot.allowManualCreate;
}

const STATUSES = new Set(["online", "reachable", "offline"]);

export function readStatusEntry(raw: unknown): PluginHostStatusEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const { status, lastChecked } = raw as Record<string, unknown>;
  if (typeof status !== "string" || !STATUSES.has(status)) return null;
  if (typeof lastChecked !== "string" || lastChecked.length > 64) return null;
  return { status: status as PluginHostStatusEntry["status"], lastChecked };
}

function readStatusMap(raw: unknown): Map<number, PluginHostStatusEntry> {
  const out = new Map<number, PluginHostStatusEntry>();
  const entries =
    raw instanceof Map ? [...raw.entries()] : Array.isArray(raw) ? raw : [];
  for (const pair of entries) {
    const [id, entry] = Array.isArray(pair) ? pair : [];
    const read = readStatusEntry(entry);
    if (Number.isInteger(id) && read) out.set(id as number, read);
  }
  return out;
}

/**
 * The plugin's status provider as core sees it. `get` answers from a cache
 * filled by every answer the plugin gives, and asks the plugin again in the
 * background (batched) so the next read is current.
 */
export function remoteStatusProvider(
  remote: Record<string, unknown>,
  onError: (error: unknown) => void = () => {},
): PluginHostStatusProvider {
  const call = (name: string, ...args: unknown[]): Promise<unknown> => {
    const fn = remote[name];
    if (typeof fn !== "function") {
      return Promise.reject(new ProviderBridgeError(`No ${name} on provider`));
    }
    try {
      return Promise.resolve((fn as AnyFn)(...args));
    } catch (error) {
      return Promise.reject(error);
    }
  };
  const quiet = (name: string, ...args: unknown[]) => {
    call(name, ...args).catch(onError);
  };
  for (const name of ["statusesFor", "check", "getMany", "registerPort"]) {
    if (typeof remote[name] !== "function") {
      throw new ProviderBridgeError(`A host status provider needs ${name}`);
    }
  }

  const cache = new Map<number, PluginHostStatusEntry>();
  const wanted = new Set<number>();
  let scheduled = false;
  const refresh = () => {
    scheduled = false;
    const ids = [...wanted];
    wanted.clear();
    if (ids.length === 0) return;
    call("getMany", ids)
      .then((answer) => {
        const read = readStatusMap(answer);
        for (const id of ids) {
          const entry = read.get(id);
          if (entry) cache.set(id, entry);
          else cache.delete(id);
        }
      })
      .catch(onError);
  };

  return {
    start: () => quiet("start"),
    stop: () => quiet("stop"),
    get: (hostId) => {
      if (Number.isInteger(hostId)) {
        wanted.add(hostId);
        if (!scheduled) {
          scheduled = true;
          setImmediate(refresh);
        }
      }
      return cache.get(hostId) ?? null;
    },
    statusesFor: async (userId, hostIds) => {
      const read = readStatusMap(await call("statusesFor", userId, hostIds));
      for (const [id, entry] of read) cache.set(id, entry);
      return read;
    },
    refresh: async (userId) => {
      await call("refresh", userId);
    },
    check: async (hostId) => {
      const entry = readStatusEntry(await call("check", hostId));
      if (entry) cache.set(hostId, entry);
      return entry;
    },
    reportLogin: (hostId, outcome) =>
      quiet("reportLogin", hostId, { ok: outcome?.ok === true }),
    registerPort: (connectionType, resolve) => {
      const dispose = call("registerPort", String(connectionType), resolve);
      dispose.catch(onError);
      return () => {
        dispose
          .then((drop) => {
            if (typeof drop === "function") return (drop as AnyFn)();
          })
          .catch(onError);
      };
    },
    getIntervalSeconds: async () => Number(await call("getIntervalSeconds")),
    setIntervalSeconds: async (seconds) => {
      await call("setIntervalSeconds", seconds);
    },
  };
}
