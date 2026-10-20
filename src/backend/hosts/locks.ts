/**
 * Host locks: hosts a plugin manages itself (for example from a config file)
 * through ctx.hosts.locks.provide. Core refuses edits, deletes and share
 * changes on a locked host everywhere, except from the plugin that locks it,
 * and a provider can block adding hosts by hand. Pins and order stay with the
 * user.
 */

import type { PluginHostLockProvider } from "@termix-ssh/plugin-sdk/backend";
import { pluginLogger } from "../utils/logger.js";

export interface HostLockInfo {
  pluginId: string;
  pluginName: string;
  note: string | null;
}

interface Entry {
  pluginId: string;
  pluginName: string;
  provider: PluginHostLockProvider;
}

const providers = new Map<symbol, Entry>();

export class HostLockedError extends Error {
  readonly status = 403;
  readonly code = "HOST_LOCKED";
  constructor(
    message: string,
    readonly lock: { pluginId: string; pluginName: string },
  ) {
    super(message);
    this.name = "HostLockedError";
  }
}

export function provideHostLocks(
  pluginId: string,
  pluginName: string,
  provider: PluginHostLockProvider,
): () => void {
  const key = Symbol(pluginId);
  providers.set(key, { pluginId, pluginName, provider });
  return () => {
    providers.delete(key);
  };
}

/** Test seam. */
export function clearHostLocks(): void {
  providers.clear();
}

// A provider that throws never locks: a broken plugin must not freeze hosts.
function safely<T>(entry: Entry, fallback: T, read: () => T): T {
  try {
    return read();
  } catch (error) {
    pluginLogger.warn("Host lock provider failed", {
      operation: "host_lock",
      pluginId: entry.pluginId,
      error: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
}

export function hostLock(
  hostId: number,
  exemptPluginId?: string,
): HostLockInfo | null {
  if (!Number.isInteger(hostId)) return null;
  for (const entry of providers.values()) {
    if (entry.pluginId === exemptPluginId) continue;
    if (!safely(entry, false, () => entry.provider.isLocked(hostId))) continue;
    return {
      pluginId: entry.pluginId,
      pluginName: entry.pluginName,
      note: safely(entry, null, () => entry.provider.note(hostId) ?? null),
    };
  }
  return null;
}

export function hasHostLocks(): boolean {
  return providers.size > 0;
}

/** Throws HostLockedError for the first locked host. */
export function assertHostsUnlocked(
  hostIds: Iterable<number>,
  exemptPluginId?: string,
): void {
  if (providers.size === 0) return;
  for (const hostId of hostIds) {
    const lock = hostLock(Number(hostId), exemptPluginId);
    if (lock) {
      throw new HostLockedError(
        `This host is managed by ${lock.pluginName} and can't be changed here`,
        lock,
      );
    }
  }
}

/** The plugin that blocks adding hosts by hand, if any. */
export function manualCreateBlockedBy(
  exemptPluginId?: string,
): { pluginId: string; pluginName: string } | null {
  for (const entry of providers.values()) {
    if (entry.pluginId === exemptPluginId) continue;
    if (!safely(entry, true, () => entry.provider.allowManualCreate())) {
      return { pluginId: entry.pluginId, pluginName: entry.pluginName };
    }
  }
  return null;
}

export function assertManualCreateAllowed(exemptPluginId?: string): void {
  const blocked = manualCreateBlockedBy(exemptPluginId);
  if (blocked) {
    throw new HostLockedError(
      `Hosts are managed by ${blocked.pluginName}, so new hosts can't be added here`,
      blocked,
    );
  }
}

type Res = { status: (code: number) => { json: (body: unknown) => unknown } };
type Next = () => void;

/** Route guard for creating hosts by hand. */
export function requireManualCreate(_req: unknown, res: Res, next: Next) {
  try {
    assertManualCreateAllowed();
  } catch (error) {
    if (sendHostLocked(res, error)) return;
    throw error;
  }
  next();
}

/** Route guard for routes that change the host named by :id. */
export function requireUnlockedHost(
  req: { params: Record<string, string | string[]> },
  res: Res,
  next: Next,
) {
  const raw = req.params.id;
  const hostId = Number(Array.isArray(raw) ? raw[0] : raw);
  try {
    assertHostsUnlocked([hostId]);
  } catch (error) {
    if (sendHostLocked(res, error)) return;
    throw error;
  }
  next();
}

/** Sends a HostLockedError as a 403. False when the error is something else. */
export function sendHostLocked(
  res: { status: (code: number) => { json: (body: unknown) => unknown } },
  error: unknown,
): boolean {
  if (!(error instanceof HostLockedError)) return false;
  res.status(403).json({
    error: error.message,
    code: error.code,
    lockedBy: error.lock.pluginId,
  });
  return true;
}
