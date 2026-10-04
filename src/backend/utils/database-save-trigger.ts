import { AsyncLocalStorage } from "node:async_hooks";
import { getErrorMessage } from "./error-message.js";
import { databaseLogger } from "./logger.js";

const DEBOUNCE_MS = 2000;
const MAX_DEBOUNCE_WAIT_MS = 30_000;

export class DatabaseSaveTrigger {
  private static saveFunction: (() => Promise<void>) | null = null;
  private static isInitialized = false;
  private static pendingSave = false;
  private static activeSave: Promise<void> | null = null;
  private static saveTimeout: NodeJS.Timeout | null = null;
  private static firstTriggerAt: number | null = null;
  private static _dirty = false;
  private static batch = new AsyncLocalStorage<{
    open: boolean;
    pending: boolean;
  }>();

  static initialize(saveFunction: () => Promise<void>): void {
    this.saveFunction = saveFunction;
    this.isInitialized = true;
  }

  static get isDirty(): boolean {
    return this._dirty;
  }

  /** Informational changes join the next periodic or critical save. */
  static markDirty(): void {
    if (this.isInitialized) this._dirty = true;
  }

  static markClean(): void {
    this._dirty = false;
  }

  static async triggerSave(
    reason: string = "data_modification",
  ): Promise<void> {
    if (!this.isInitialized || !this.saveFunction) {
      databaseLogger.warn("Database save trigger not initialized", {
        operation: "db_save_trigger_not_init",
        reason,
      });
      return;
    }

    this._dirty = true;

    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    // Each call pushes the save back, so steady writes (samples every few
    // seconds) would keep it from ever running. Cap how long it can wait.
    const now = Date.now();
    this.firstTriggerAt ??= now;
    const delay = Math.max(
      0,
      Math.min(DEBOUNCE_MS, this.firstTriggerAt + MAX_DEBOUNCE_WAIT_MS - now),
    );

    this.saveTimeout = setTimeout(async () => {
      this.saveTimeout = null;
      this.firstTriggerAt = null;

      try {
        await this.runSave();
        this._dirty = false;
      } catch (error) {
        databaseLogger.error("Database save failed", error, {
          operation: "db_save_trigger_failed",
          reason,
          error: getErrorMessage(error),
        });
      }
    }, delay);
  }

  /**
   * Wraps `work` so the force saves made while it runs collapse into one save
   * when it finishes. Every save serializes and encrypts the whole database,
   * so a loop writing one row per host per setting otherwise rewrites the
   * file once per row. Nested scopes fold into the outer one; work that
   * outlives its scope (fire-and-forget) saves normally again.
   */
  static batched<A extends unknown[], T>(
    work: (...args: A) => Promise<T>,
  ): (...args: A) => Promise<T> {
    return async (...args) => {
      const scope = { open: true, pending: false };
      try {
        return await this.batch.run(scope, () => work(...args));
      } finally {
        scope.open = false;
        if (scope.pending) await this.forceSave("batched_writes");
      }
    };
  }

  static async forceSave(reason: string = "critical_operation"): Promise<void> {
    if (!this.isInitialized || !this.saveFunction) {
      databaseLogger.warn(
        "Database save trigger not initialized for force save",
        {
          operation: "db_save_trigger_force_not_init",
          reason,
        },
      );
      return;
    }

    const scope = this.batch.getStore();
    if (scope?.open) {
      scope.pending = true;
      this._dirty = true;
      return;
    }

    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    this.firstTriggerAt = null;

    try {
      await this.runSave();
      this._dirty = false;
    } catch (error) {
      databaseLogger.error("Database force save failed", error, {
        operation: "db_save_trigger_force_failed",
        reason,
        error: getErrorMessage(error),
      });
      throw error;
    }
  }

  private static async runSave(): Promise<void> {
    while (this.activeSave) {
      try {
        await this.activeSave;
      } catch {
        // The queued save must still run after an earlier save failed.
      }
    }

    // Each save serializes the whole database into fresh buffers, and V8 only
    // frees them once the event loop turns. A loop of awaited writes (boot
    // migrations, bulk import) never yields, so every save's copies piled up
    // until the process ran out of memory.
    const save = Promise.resolve()
      .then(() => this.saveFunction!())
      .finally(() => new Promise<void>((resolve) => setImmediate(resolve)));
    this.activeSave = save;
    this.pendingSave = true;

    try {
      await save;
    } finally {
      if (this.activeSave === save) {
        this.activeSave = null;
        this.pendingSave = false;
      }
    }
  }

  static getStatus(): {
    initialized: boolean;
    pendingSave: boolean;
    hasPendingTimeout: boolean;
  } {
    return {
      initialized: this.isInitialized,
      pendingSave: this.pendingSave,
      hasPendingTimeout: this.saveTimeout !== null,
    };
  }

  static cleanup(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    this.firstTriggerAt = null;

    this.pendingSave = false;
    this.activeSave = null;
    this.isInitialized = false;
    this._dirty = false;
    this.saveFunction = null;
  }
}
