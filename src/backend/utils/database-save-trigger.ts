import { databaseLogger } from "./logger.js";

export class DatabaseSaveTrigger {
  private static saveFunction: (() => Promise<void>) | null = null;
  private static isInitialized = false;
  private static pendingSave = false;
  private static activeSave: Promise<void> | null = null;
  private static saveTimeout: NodeJS.Timeout | null = null;
  private static _dirty = false;

  static initialize(saveFunction: () => Promise<void>): void {
    this.saveFunction = saveFunction;
    this.isInitialized = true;
  }

  static get isDirty(): boolean {
    return this._dirty;
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

    this.saveTimeout = setTimeout(async () => {
      this.saveTimeout = null;

      try {
        await this.runSave();
        this._dirty = false;
      } catch (error) {
        databaseLogger.error("Database save failed", error, {
          operation: "db_save_trigger_failed",
          reason,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }, 2000);
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

    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }

    try {
      await this.runSave();
      this._dirty = false;
    } catch (error) {
      databaseLogger.error("Database force save failed", error, {
        operation: "db_save_trigger_force_failed",
        reason,
        error: error instanceof Error ? error.message : "Unknown error",
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

    const save = Promise.resolve().then(() => this.saveFunction!());
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

    this.pendingSave = false;
    this.activeSave = null;
    this.isInitialized = false;
    this.saveFunction = null;
  }
}
