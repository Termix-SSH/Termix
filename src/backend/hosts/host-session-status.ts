type HostSessionStatusListener = (hostId: number, online: boolean) => void;

export class HostSessionStatus {
  private counts = new Map<number, number>();
  private listeners = new Set<HostSessionStatusListener>();

  register(hostId: number): () => void {
    const count = this.counts.get(hostId) ?? 0;
    this.counts.set(hostId, count + 1);
    if (count === 0) this.emit(hostId, true);

    let active = true;
    return () => {
      if (!active) return;
      active = false;

      const next = (this.counts.get(hostId) ?? 1) - 1;
      if (next > 0) {
        this.counts.set(hostId, next);
        return;
      }

      this.counts.delete(hostId);
      this.emit(hostId, false);
    };
  }

  subscribe(listener: HostSessionStatusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(hostId: number, online: boolean): void {
    for (const listener of this.listeners) listener(hostId, online);
  }
}

export const hostSessionStatus = new HostSessionStatus();
