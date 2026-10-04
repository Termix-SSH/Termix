export type StatusValue = "online" | "offline" | "unknown";

export interface ServerStatusEntry {
  status: "online" | "offline";
  lastChecked: string;
}

type Listener = () => void;

/**
 * Mutable store for per-host status so list rows can subscribe to a single host
 * via useSyncExternalStore instead of re-rendering the whole tree on every poll.
 */
export class ServerStatusStore {
  private statuses = new Map<number, ServerStatusEntry>();
  private initialLoadComplete = false;
  private readonly hostListeners = new Map<number, Set<Listener>>();
  private readonly allListeners = new Set<Listener>();
  private readonly metaListeners = new Set<Listener>();

  /** "unknown" until the host has been checked. */
  getStatus(hostId: number): StatusValue {
    return this.statuses.get(hostId)?.status ?? "unknown";
  }

  getStatuses(): Map<number, ServerStatusEntry> {
    return this.statuses;
  }

  getInitialLoadComplete(): boolean {
    return this.initialLoadComplete;
  }

  getMetaSnapshot(): string {
    return this.initialLoadComplete ? "1" : "0";
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
      if (this.statuses.get(id)?.status !== entry.status) changedIds.push(id);
    }
    for (const id of this.statuses.keys()) {
      if (!next.has(id)) changedIds.push(id);
    }

    this.statuses = next;
    if (changedIds.length === 0) return;
    for (const id of changedIds) {
      this.emitHost(id);
    }
    this.emitAll();
  }

  /** Forgets everything, on sign out. */
  clear(): void {
    this.applyStatuses(new Map());
    this.setInitialLoadComplete(false);
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
