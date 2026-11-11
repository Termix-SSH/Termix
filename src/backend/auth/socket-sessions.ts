/**
 * Ties every open socket to the login session that opened it.
 *
 * A socket outlives the request that authenticated it, so without this a
 * revoked, expired or idle session kept whatever sockets it already had.
 * Revoking closes them at once; a sweep every few seconds catches expiry,
 * idle timeout and anything deleted another way.
 */

export const SOCKET_SWEEP_MS = 5_000;
/** How long an API key's carrier session is kept ahead while its socket is open. */
export const API_KEY_CARRIER_TTL_MS = 120_000;

export interface SocketBinding {
  sessionId: string;
  userId: string;
  /** Set when an API key opened the socket through a carrier session. */
  apiKeyId?: string;
  close(): void;
  /** Bytes read so far, for sockets whose frames core never sees. */
  bytesRead?(): number;
}

export interface BoundSocket {
  /** Counts as activity on the session, so an active socket does not idle out. */
  markActive(): void;
  unbind(): void;
}

interface Entry {
  binding: SocketBinding;
  active: boolean;
  lastBytes: number;
}

export interface SocketSessionRow {
  id: string;
  userId: string;
  expiresAt: string;
  lastActiveAt: string;
  idleTimeout: number | null;
  restriction: string | null;
}

export interface SocketSessionStore {
  findSessions(ids: string[]): Promise<SocketSessionRow[]>;
  touch(id: string): Promise<unknown>;
  extend(id: string, expiresAt: string): Promise<unknown>;
  revoke(id: string): Promise<unknown>;
  apiKeyUsable(keyId: string, userId: string): Promise<boolean>;
}

const bySession = new Map<string, Set<Entry>>();
let timer: ReturnType<typeof setInterval> | null = null;
let sweeping: Promise<void> | null = null;
let storeOverride: SocketSessionStore | null = null;

async function defaultStore(): Promise<SocketSessionStore> {
  const { createCurrentSessionRepository, createCurrentApiKeyRepository } =
    await import("../database/repositories/factory.js");
  const sessions = createCurrentSessionRepository();
  return {
    findSessions: (ids) => sessions.findManyByIds(ids),
    touch: (id) => sessions.touch(id),
    extend: (id, expiresAt) => sessions.extendExpiry(id, expiresAt),
    revoke: (id) => sessions.revoke(id),
    apiKeyUsable: async (keyId, userId) => {
      const key = await createCurrentApiKeyRepository().findById(keyId);
      return (
        !!key &&
        key.isActive &&
        key.userId === userId &&
        (!key.expiresAt || new Date(key.expiresAt).getTime() > Date.now())
      );
    },
  };
}

function closeEntry(entry: Entry): void {
  try {
    entry.binding.close();
  } catch {
    // Already gone.
  }
}

function ensureTimer(): void {
  if (timer || bySession.size === 0) return;
  timer = setInterval(() => {
    void sweepSocketSessions().catch(() => {});
  }, SOCKET_SWEEP_MS);
  timer.unref?.();
}

function stopTimerIfIdle(): void {
  if (timer && bySession.size === 0) {
    clearInterval(timer);
    timer = null;
  }
}

function remove(entry: Entry): void {
  const set = bySession.get(entry.binding.sessionId);
  if (!set) return;
  set.delete(entry);
  if (set.size === 0) bySession.delete(entry.binding.sessionId);
  stopTimerIfIdle();
}

export function bindSocket(binding: SocketBinding): BoundSocket {
  const entry: Entry = {
    binding,
    active: false,
    lastBytes: binding.bytesRead?.() ?? 0,
  };
  let set = bySession.get(binding.sessionId);
  if (!set) {
    set = new Set();
    bySession.set(binding.sessionId, set);
  }
  set.add(entry);
  ensureTimer();
  return {
    markActive: () => {
      entry.active = true;
    },
    unbind: () => remove(entry),
  };
}

/** Closes every socket a session opened. */
export function endSocketSession(sessionId: string): void {
  const set = bySession.get(sessionId);
  if (!set) return;
  bySession.delete(sessionId);
  for (const entry of set) closeEntry(entry);
  stopTimerIfIdle();
}

/** Closes every socket a user's sessions opened, but the one kept. */
export function endUserSocketSessions(
  userId: string,
  exceptSessionId?: string,
): void {
  for (const [sessionId, set] of [...bySession]) {
    if (sessionId === exceptSessionId) continue;
    if ([...set].some((entry) => entry.binding.userId === userId)) {
      endSocketSession(sessionId);
    }
  }
}

/** Closes the sockets an API key opened. */
export function endApiKeySockets(keyId: string): void {
  for (const [sessionId, set] of [...bySession]) {
    if ([...set].some((entry) => entry.binding.apiKeyId === keyId)) {
      endSocketSession(sessionId);
    }
  }
}

export function idleExpired(session: {
  idleTimeout: number | null;
  lastActiveAt: string;
}): boolean {
  if (!session.idleTimeout) return false;
  const idleMs = Date.now() - new Date(session.lastActiveAt).getTime();
  return idleMs > session.idleTimeout * 1000;
}

async function sweepOnce(): Promise<void> {
  if (bySession.size === 0) return;
  const store = storeOverride ?? (await defaultStore());
  const ids = [...bySession.keys()];
  const rows = new Map(
    (await store.findSessions(ids)).map((row) => [row.id, row]),
  );
  const now = Date.now();

  for (const id of ids) {
    const set = bySession.get(id);
    if (!set) continue;
    const entries = [...set];
    const row = rows.get(id);
    if (
      !row ||
      row.restriction ||
      entries.some((e) => e.binding.userId !== row.userId)
    ) {
      endSocketSession(id);
      continue;
    }

    let active = false;
    for (const entry of entries) {
      const bytes = entry.binding.bytesRead?.() ?? entry.lastBytes;
      if (entry.active || bytes > entry.lastBytes) active = true;
      entry.active = false;
      entry.lastBytes = bytes;
    }

    const keyId = entries.find((e) => e.binding.apiKeyId)?.binding.apiKeyId;
    if (keyId) {
      // An API key has no login of its own: the socket lives as long as the
      // key does, and the carrier session is kept ahead while it is open.
      if (!(await store.apiKeyUsable(keyId, row.userId))) {
        endSocketSession(id);
        continue;
      }
      if (
        new Date(row.expiresAt).getTime() - now <
        API_KEY_CARRIER_TTL_MS / 2
      ) {
        await store.extend(
          id,
          new Date(now + API_KEY_CARRIER_TTL_MS).toISOString(),
        );
      }
      continue;
    }

    if (new Date(row.expiresAt).getTime() < now) {
      endSocketSession(id);
      continue;
    }
    if (active) {
      await store.touch(id);
      continue;
    }
    if (idleExpired(row)) {
      endSocketSession(id);
      await store.revoke(id);
    }
  }
}

/** Checks every bound session once. Never runs twice at the same time. */
export function sweepSocketSessions(): Promise<void> {
  if (!sweeping) {
    sweeping = sweepOnce().finally(() => {
      sweeping = null;
    });
  }
  return sweeping;
}

/** Test seams. */
export function setSocketSessionStore(store: SocketSessionStore | null): void {
  storeOverride = store;
}

export function boundSocketCount(): number {
  let count = 0;
  for (const set of bySession.values()) count += set.size;
  return count;
}

export function resetSocketSessions(): void {
  bySession.clear();
  stopTimerIfIdle();
  storeOverride = null;
}
