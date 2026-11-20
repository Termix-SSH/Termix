/**
 * Connections core holds open to each host, so a connect policy can end
 * them when its answer changes (a grant ran out, the host went to sleep).
 * Fed where core opens a connection: connectHost, the transport socket a
 * sandboxed plugin's own client runs over, and the SSH relay.
 *
 * A per host generation covers the race with a connection still in its
 * handshake: one that started before a disconnect ends itself once ready.
 */

const open = new Map<number, Set<() => void>>();
const generations = new Map<number, number>();

function validId(hostId: unknown): hostId is number {
  return (
    typeof hostId === "number" && Number.isSafeInteger(hostId) && hostId > 0
  );
}

/** The generation a connection started in; compare it once it is ready. */
export function connectionGeneration(hostId: unknown): number {
  return validId(hostId) ? (generations.get(hostId) ?? 0) : 0;
}

/** True when a disconnect ran after `generation` was read. */
export function cutSince(hostId: unknown, generation: number): boolean {
  return connectionGeneration(hostId) !== generation;
}

/**
 * Tracks an open connection. `end` closes it. Returns the function that
 * stops tracking, called from the connection's own close.
 */
export function trackConnection(hostId: unknown, end: () => void): () => void {
  if (!validId(hostId)) return () => {};
  let set = open.get(hostId);
  if (!set) {
    set = new Set();
    open.set(hostId, set);
  }
  set.add(end);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const current = open.get(hostId);
    current?.delete(end);
    if (current && current.size === 0) open.delete(hostId);
  };
}

/** Ends every tracked connection to the host. Resolves to how many. */
export function endHostConnections(hostId: unknown): number {
  if (!validId(hostId)) return 0;
  generations.set(hostId, (generations.get(hostId) ?? 0) + 1);
  const set = open.get(hostId);
  open.delete(hostId);
  if (!set) return 0;
  let count = 0;
  for (const end of set) {
    try {
      end();
      count += 1;
    } catch {
      // Already closed.
    }
  }
  return count;
}

export function openConnectionCount(hostId: number): number {
  return open.get(hostId)?.size ?? 0;
}

/** Test seam. */
export function resetOpenConnections(): void {
  open.clear();
  generations.clear();
}
