export interface EmbeddedViewRegistration {
  element: HTMLElement;
  update: () => void;
  /** Optional container whose style/visibility attributes affect placement (e.g. ForeignView box). */
  watchContainer?: HTMLElement | null;
}

export interface EmbeddedViewHandle {
  schedule: () => void;
  dispose: () => void;
}

/**
 * Coordinates bounds/visibility updates for all active native embedded views
 * using a single shared MutationObserver, ResizeObserver, window listeners,
 * and requestAnimationFrame batch. Detaches everything when no views remain.
 */
export class EmbeddedViewCoordinator {
  private entries = new Map<symbol, EmbeddedViewRegistration>();
  private dirty = new Set<symbol>();
  private elementToIds = new Map<Element, Set<symbol>>();
  private frame = 0;
  private attached = false;
  private mutationObserver: MutationObserver | null = null;
  private resizeObserver: ResizeObserver | null = null;

  get size(): number {
    return this.entries.size;
  }

  get isAttached(): boolean {
    return this.attached;
  }

  register(registration: EmbeddedViewRegistration): EmbeddedViewHandle {
    const id = Symbol();
    this.entries.set(id, registration);

    if (!this.attached) {
      this.attach();
    }

    let ids = this.elementToIds.get(registration.element);
    if (!ids) {
      ids = new Set();
      this.elementToIds.set(registration.element, ids);
      this.resizeObserver?.observe(registration.element);
    }
    ids.add(id);

    if (
      registration.watchContainer &&
      registration.watchContainer !== document.body
    ) {
      this.syncMutationTargets();
    }

    this.scheduleId(id);

    return {
      schedule: () => this.scheduleId(id),
      dispose: () => this.unregister(id),
    };
  }

  private unregister(id: symbol): void {
    const entry = this.entries.get(id);
    if (!entry) return;

    this.entries.delete(id);
    this.dirty.delete(id);

    const ids = this.elementToIds.get(entry.element);
    if (ids) {
      ids.delete(id);
      if (ids.size === 0) {
        this.elementToIds.delete(entry.element);
        this.resizeObserver?.unobserve?.(entry.element);
      }
    }

    if (this.entries.size === 0) {
      this.detach();
    } else if (entry.watchContainer && entry.watchContainer !== document.body) {
      this.syncMutationTargets();
    }
  }

  private attach(): void {
    this.attached = true;
    window.addEventListener("resize", this.onWindowEvent);
    window.addEventListener("scroll", this.onWindowEvent, true);
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(this.onResize);
    }
    if (typeof MutationObserver !== "undefined") {
      this.mutationObserver = new MutationObserver(this.onMutation);
      this.syncMutationTargets();
    }
  }

  private detach(): void {
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    this.dirty.clear();
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    window.removeEventListener("resize", this.onWindowEvent);
    window.removeEventListener("scroll", this.onWindowEvent, true);
    this.attached = false;
  }

  private syncMutationTargets(): void {
    if (!this.mutationObserver || typeof document === "undefined") return;
    this.mutationObserver.disconnect();
    if (document.body) {
      this.mutationObserver.observe(document.body, { childList: true });
    }
    const containers = new Set<HTMLElement>();
    for (const entry of this.entries.values()) {
      if (entry.watchContainer && entry.watchContainer !== document.body) {
        containers.add(entry.watchContainer);
      }
    }
    for (const container of containers) {
      this.mutationObserver.observe(container, {
        attributes: true,
        attributeFilter: ["style", "data-foreign-hidden"],
      });
    }
  }

  private onWindowEvent = (): void => {
    this.scheduleAll();
  };

  private onResize = (records: ResizeObserverEntry[]): void => {
    for (const record of records) {
      const ids = this.elementToIds.get(record.target);
      if (!ids) continue;
      for (const id of ids) {
        this.dirty.add(id);
      }
    }
    this.requestFlush();
  };

  private onMutation = (records: MutationRecord[]): void => {
    let bodyChanged = false;
    const changedContainers = new Set<Node>();
    for (const record of records) {
      if (record.target === document.body) {
        bodyChanged = true;
        break;
      }
      changedContainers.add(record.target);
    }
    if (bodyChanged) {
      this.scheduleAll();
      return;
    }
    for (const [id, entry] of this.entries) {
      if (entry.watchContainer && changedContainers.has(entry.watchContainer)) {
        this.dirty.add(id);
      }
    }
    this.requestFlush();
  };

  private scheduleId(id: symbol): void {
    if (!this.entries.has(id)) return;
    this.dirty.add(id);
    this.requestFlush();
  }

  private scheduleAll(): void {
    for (const id of this.entries.keys()) {
      this.dirty.add(id);
    }
    this.requestFlush();
  }

  private requestFlush(): void {
    if (this.frame || this.dirty.size === 0) return;
    this.frame = requestAnimationFrame(this.flush);
  }

  private flush = (): void => {
    this.frame = 0;
    const batch = Array.from(this.dirty);
    this.dirty.clear();
    for (const id of batch) {
      this.entries.get(id)?.update();
    }
  };
}

export const embeddedViewCoordinator = new EmbeddedViewCoordinator();
