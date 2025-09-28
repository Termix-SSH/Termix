import { databaseLogger } from "./logger.js";

export class DatabaseSaveTrigger {
  private static saveFunction: (() => Promise<void>) | null = null;
  private static isInitialized = false;
  private static pendingSave = false;
  private static saveTimeout: NodeJS.Timeout | null = null;

  static initialize(saveFunction: () => Promise<void>): void {
    this.saveFunction = saveFunction;
    this.isInitialized = true;
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

    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = setTimeout(async () => {
      if (this.pendingSave) {
        return;
      }

      this.pendingSave = true;

      try {
        await this.saveFunction!();
      } catch (error) {
        databaseLogger.error("Database save failed", error, {
          operation: "db_save_trigger_failed",
          reason,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      } finally {
        this.pendingSave = false;
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

    if (this.pendingSave) {
      return;
    }

    this.pendingSave = true;

    try {
      databaseLogger.info("Force saving database", {
        operation: "db_save_trigger_force_start",
        reason,
      });

      await this.saveFunction();
    } catch (error) {
      databaseLogger.error("Database force save failed", error, {
        operation: "db_save_trigger_force_failed",
        reason,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    } finally {
      this.pendingSave = false;
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
    this.isInitialized = false;
    this.saveFunction = null;

    databaseLogger.info("Database save trigger cleaned up", {
      operation: "db_save_trigger_cleanup",
    });
  }
}
