/**
 * Everything a plugin registered, so deactivate can undo all of it.
 *
 * The rule this enforces: a plugin is only as disableable as its cleanup. A
 * listening port, a live SSH session or an interval that outlives deactivate
 * turns "disabled" into a lie, and re-enabling then fails on a port that is
 * still held.
 *
 * Disposal runs in reverse registration order, so a thing torn down last was
 * set up first. Every disposer is isolated: one that throws is logged and the
 * rest still run, because a half-disposed plugin is worse than a noisy log.
 */

import { pluginLogger } from "../utils/logger.js";

export type Disposer = () => void | Promise<void>;

interface Entry {
  dispose: Disposer;
  /** What this is, for the log line when it throws. */
  label: string;
}

export class DisposableBag {
  private entries: Entry[] = [];
  private disposed = false;

  constructor(private readonly pluginId: string) {}

  add(dispose: Disposer, label = "disposable"): void {
    if (this.disposed) {
      // Registering after teardown means the resource would never be cleaned
      // up. Dispose it immediately rather than silently leaking it.
      void this.run({ dispose, label });
      return;
    }
    this.entries.push({ dispose, label });
  }

  get size(): number {
    return this.entries.length;
  }

  /**
   * Runs every disposer, newest first. Safe to call more than once, and never
   * throws: the caller is already tearing the plugin down.
   */
  async disposeAll(): Promise<void> {
    this.disposed = true;
    const entries = this.entries.reverse();
    this.entries = [];

    for (const entry of entries) {
      await this.run(entry);
    }
  }

  private async run(entry: Entry): Promise<void> {
    try {
      await entry.dispose();
    } catch (error) {
      pluginLogger.error(
        `Plugin ${this.pluginId} failed to dispose ${entry.label}`,
        error instanceof Error ? error : new Error(String(error)),
        { operation: "plugin_dispose" },
      );
    }
  }
}
