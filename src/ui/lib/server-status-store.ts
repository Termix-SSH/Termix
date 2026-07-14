export type StatusValue = "online" | "offline" | "degraded";

export interface ServerStatusEntry {
  status: StatusValue;
  lastChecked: string;
}

type Listener = () => void;

/**
 * Mutable store for per-host status so list rows can subscribe to a single host
 * via useSyncExternalStore instead of re-rendering the whole tree on every poll.
 */
export class ServerStatusStore {
  private statuses = new Map<number, ServerStatusEntry>();
  private enabledHostIds = new Set<number>();
  private initialLoadComplete = false;
  private isLoading = false;
  private readonly hostListeners = new Map<number, Set<Listener>>();
  private readonly allListeners = new Set<Listener>();
  private readonly metaListeners = new Set<Listener>();

  getStatus(hostId: number): StatusValue {
    if (!this.enabledHostIds.has(hostId)) {
      return "offline";
    }
    return this.statuses.get(hostId)?.status || "degraded";
  }

  getStatuses(): Map<number, ServerStatusEntry> {
    return this.statuses;
  }

  getEnabledHostIds(): Set<number> {
    return this.enabledHostIds;
  }

  getInitialLoadComplete(): boolean {
    return this.initialLoadComplete;
  }

  getIsLoading(): boolean {
    return this.isLoading;
  }

  /** Snapshot string for a host — used as useSyncExternalStore getSnapshot. */
  getHostSnapshot(hostId: number): StatusValue {
    return this.getStatus(hostId);
  }

  getMetaSnapshot(): string {
    return `${this.initialLoadComplete ? 1 : 0}:${this.isLoading ? 1 : 0}:${this.enabledHostIds.size}`;
  }

  subscribeHost(hostId: number, listener: Listener): () => void {
    let set = this.hostListeners.get(hostId);
    if (!set) {
      set = new Set();
      this.hostListeners.set(hostId, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) {
        this.hostListeners.delete(hostId);
      }
    };
  }

  subscribeAll(listener: Listener): () => void {
    this.allListeners.add(listener);
    return () => {
      this.allListeners.delete(listener);
    };
  }

  subscribeMeta(listener: Listener): () => void {
    this.metaListeners.add(listener);
    return () => {
      this.metaListeners.delete(listener);
    };
  }

  setEnabledHostIds(next: Set<number>): void {
    if (setsEqual(this.enabledHostIds, next)) return;
    const prev = this.enabledHostIds;
    this.enabledHostIds = next;
    this.emitMeta();
    // Hosts that entered/left the enabled set need a status re-read.
    for (const id of next) {
      if (!prev.has(id)) this.emitHost(id);
    }
    for (const id of prev) {
      if (!next.has(id)) this.emitHost(id);
    }
    this.emitAll();
  }

  setLoading(loading: boolean): void {
    if (this.isLoading === loading) return;
    this.isLoading = loading;
    this.emitMeta();
    this.emitAll();
  }

  setInitialLoadComplete(complete: boolean): void {
    if (this.initialLoadComplete === complete) return;
    this.initialLoadComplete = complete;
    this.emitMeta();
    this.emitAll();
  }

  /**
   * Replace status map. Notifies only hosts whose status value changed,
   * plus allListeners when any change occurred.
   */
  applyStatuses(next: Map<number, ServerStatusEntry>): void {
    const changedIds: number[] = [];

    for (const [id, entry] of next) {
      const prev = this.statuses.get(id);
      if (!prev || prev.status !== entry.status) {
        changedIds.push(id);
      }
    }
    for (const id of this.statuses.keys()) {
      if (!next.has(id)) {
        changedIds.push(id);
      }
    }

    if (changedIds.length === 0) {
      // Still refresh lastChecked silently without notifying.
      this.statuses = next;
      return;
    }

    this.statuses = next;
    for (const id of changedIds) {
      this.emitHost(id);
    }
    this.emitAll();
  }

  markDegraded(enabledIds: Iterable<number>): void {
    const next = new Map(this.statuses);
    let changed = false;
    const now = new Date().toISOString();
    for (const id of enabledIds) {
      const existing = next.get(id);
      if (existing?.status === "degraded") continue;
      changed = true;
      next.set(id, {
        status: "degraded",
        lastChecked: existing?.lastChecked || now,
      });
    }
    if (changed) {
      this.applyStatuses(next);
    }
  }

  private emitHost(hostId: number): void {
    const set = this.hostListeners.get(hostId);
    if (!set) return;
    for (const listener of set) listener();
  }

  private emitAll(): void {
    for (const listener of this.allListeners) listener();
  }

  private emitMeta(): void {
    for (const listener of this.metaListeners) listener();
  }
}

function setsEqual(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}
