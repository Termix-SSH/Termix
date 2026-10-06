/**
 * Clears the audit rows 2.9.1 wrote on every background plugin query.
 *
 * They filled the capped audit log and pushed real entries out. Idempotent,
 * so it runs on every boot, before plugins activate and audit again.
 */

import { databaseLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/error-message.js";
import { createCurrentAuditLogRepository } from "../database/repositories/factory.js";
import { DatabaseSaveTrigger } from "../utils/database-save-trigger.js";

export async function runAuditNoiseCleanup(): Promise<number> {
  try {
    const removed =
      await createCurrentAuditLogRepository().deleteRoutinePluginNoise();
    if (removed > 0) {
      await DatabaseSaveTrigger.forceSave("audit_noise_cleanup");
      databaseLogger.info("Removed routine plugin audit entries", {
        operation: "audit_noise_cleanup",
        removed,
      });
    }
    return removed;
  } catch (error) {
    databaseLogger.warn("Failed to remove routine plugin audit entries", {
      operation: "audit_noise_cleanup_failed",
      error: getErrorMessage(error),
    });
    return 0;
  }
}
