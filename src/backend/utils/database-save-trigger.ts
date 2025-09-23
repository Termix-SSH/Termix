import { databaseLogger } from "./logger.js";

/**
 * Database Save Trigger - 自动触发内存数据库保存到磁盘
 * 确保数据修改后能持久化保存
 */
export class DatabaseSaveTrigger {
  private static saveFunction: (() => Promise<void>) | null = null;
  private static isInitialized = false;
  private static pendingSave = false;
  private static saveTimeout: NodeJS.Timeout | null = null;

  /**
   * 初始化保存触发器
   */
  static initialize(saveFunction: () => Promise<void>): void {
    this.saveFunction = saveFunction;
    this.isInitialized = true;

    databaseLogger.info("Database save trigger initialized", {
      operation: "db_save_trigger_init",
    });
  }

  /**
   * 触发数据库保存 - 防抖处理，避免频繁保存
   */
  static async triggerSave(reason: string = "data_modification"): Promise<void> {
    if (!this.isInitialized || !this.saveFunction) {
      databaseLogger.warn("Database save trigger not initialized", {
        operation: "db_save_trigger_not_init",
        reason,
      });
      return;
    }

    // 清除之前的定时器
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    // 防抖：延迟2秒执行，如果2秒内有新的保存请求，则重新计时
    this.saveTimeout = setTimeout(async () => {
      if (this.pendingSave) {
        databaseLogger.debug("Database save already in progress, skipping", {
          operation: "db_save_trigger_skip",
          reason,
        });
        return;
      }

      this.pendingSave = true;

      try {
        databaseLogger.debug("Triggering database save", {
          operation: "db_save_trigger_start",
          reason,
        });

        await this.saveFunction!();

        databaseLogger.debug("Database save completed", {
          operation: "db_save_trigger_success",
          reason,
        });
      } catch (error) {
        databaseLogger.error("Database save failed", error, {
          operation: "db_save_trigger_failed",
          reason,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      } finally {
        this.pendingSave = false;
      }
    }, 2000); // 2秒防抖
  }

  /**
   * 立即保存 - 用于关键操作
   */
  static async forceSave(reason: string = "critical_operation"): Promise<void> {
    if (!this.isInitialized || !this.saveFunction) {
      databaseLogger.warn("Database save trigger not initialized for force save", {
        operation: "db_save_trigger_force_not_init",
        reason,
      });
      return;
    }

    // 清除防抖定时器
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }

    if (this.pendingSave) {
      databaseLogger.debug("Database save already in progress, waiting", {
        operation: "db_save_trigger_force_wait",
        reason,
      });
      return;
    }

    this.pendingSave = true;

    try {
      databaseLogger.info("Force saving database", {
        operation: "db_save_trigger_force_start",
        reason,
      });

      await this.saveFunction();

      databaseLogger.success("Database force save completed", {
        operation: "db_save_trigger_force_success",
        reason,
      });
    } catch (error) {
      databaseLogger.error("Database force save failed", error, {
        operation: "db_save_trigger_force_failed",
        reason,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error; // 重新抛出错误，因为这是强制保存
    } finally {
      this.pendingSave = false;
    }
  }

  /**
   * 获取保存状态
   */
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

  /**
   * 清理资源
   */
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