import { db } from "../database/db/index.js";
import { users, sshData, sshCredentials, fileManagerRecent, fileManagerPinned, fileManagerShortcuts, dismissedAlerts } from "../database/db/schema.js";
import { eq, and } from "drizzle-orm";
import { DataCrypto } from "./data-crypto.js";
import { UserDataExport, type UserExportData } from "./user-data-export.js";
import { databaseLogger } from "./logger.js";
import { nanoid } from "nanoid";

interface ImportOptions {
  replaceExisting?: boolean;
  skipCredentials?: boolean;
  skipFileManagerData?: boolean;
  dryRun?: boolean;
}

interface ImportResult {
  success: boolean;
  summary: {
    sshHostsImported: number;
    sshCredentialsImported: number;
    fileManagerItemsImported: number;
    dismissedAlertsImported: number;
    skippedItems: number;
    errors: string[];
  };
  dryRun: boolean;
}

/**
 * UserDataImport - User data import
 *
 * Linus principles:
 * - Import should not break existing data (unless explicitly requested)
 * - Support dry-run mode for validation
 * - Simple strategy for ID conflicts: regenerate
 * - Error handling must be explicit, no silent failures
 */
class UserDataImport {

  /**
   * Import user data
   */
  static async importUserData(
    targetUserId: string,
    exportData: UserExportData,
    options: ImportOptions = {}
  ): Promise<ImportResult> {
    const {
      replaceExisting = false,
      skipCredentials = false,
      skipFileManagerData = false,
      dryRun = false
    } = options;

    try {
      databaseLogger.info("Starting user data import", {
        operation: "user_data_import",
        targetUserId,
        sourceUserId: exportData.userId,
        sourceUsername: exportData.username,
        dryRun,
        replaceExisting,
        skipCredentials,
        skipFileManagerData,
      });

      // Verify target user exists
      const targetUser = await db.select().from(users).where(eq(users.id, targetUserId));
      if (!targetUser || targetUser.length === 0) {
        throw new Error(`Target user not found: ${targetUserId}`);
      }

      // Validate export data format
      const validation = UserDataExport.validateExportData(exportData);
      if (!validation.valid) {
        throw new Error(`Invalid export data: ${validation.errors.join(', ')}`);
      }

      // Verify user data is unlocked (if data is encrypted)
      let userDataKey: Buffer | null = null;
      if (exportData.metadata.encrypted) {
        userDataKey = DataCrypto.getUserDataKey(targetUserId);
        if (!userDataKey) {
          throw new Error("Target user data not unlocked - password required for encrypted import");
        }
      }

      const result: ImportResult = {
        success: false,
        summary: {
          sshHostsImported: 0,
          sshCredentialsImported: 0,
          fileManagerItemsImported: 0,
          dismissedAlertsImported: 0,
          skippedItems: 0,
          errors: [],
        },
        dryRun,
      };

      // Import SSH host configurations
      if (exportData.userData.sshHosts && exportData.userData.sshHosts.length > 0) {
        const importStats = await this.importSshHosts(
          targetUserId,
          exportData.userData.sshHosts,
          { replaceExisting, dryRun, userDataKey }
        );
        result.summary.sshHostsImported = importStats.imported;
        result.summary.skippedItems += importStats.skipped;
        result.summary.errors.push(...importStats.errors);
      }

      // Import SSH credentials
      if (!skipCredentials && exportData.userData.sshCredentials && exportData.userData.sshCredentials.length > 0) {
        const importStats = await this.importSshCredentials(
          targetUserId,
          exportData.userData.sshCredentials,
          { replaceExisting, dryRun, userDataKey }
        );
        result.summary.sshCredentialsImported = importStats.imported;
        result.summary.skippedItems += importStats.skipped;
        result.summary.errors.push(...importStats.errors);
      }

      // Import file manager data
      if (!skipFileManagerData && exportData.userData.fileManagerData) {
        const importStats = await this.importFileManagerData(
          targetUserId,
          exportData.userData.fileManagerData,
          { replaceExisting, dryRun }
        );
        result.summary.fileManagerItemsImported = importStats.imported;
        result.summary.skippedItems += importStats.skipped;
        result.summary.errors.push(...importStats.errors);
      }

      // Import dismissed alerts
      if (exportData.userData.dismissedAlerts && exportData.userData.dismissedAlerts.length > 0) {
        const importStats = await this.importDismissedAlerts(
          targetUserId,
          exportData.userData.dismissedAlerts,
          { replaceExisting, dryRun }
        );
        result.summary.dismissedAlertsImported = importStats.imported;
        result.summary.skippedItems += importStats.skipped;
        result.summary.errors.push(...importStats.errors);
      }

      result.success = result.summary.errors.length === 0;

      databaseLogger.success("User data import completed", {
        operation: "user_data_import_complete",
        targetUserId,
        dryRun,
        ...result.summary,
      });

      return result;
    } catch (error) {
      databaseLogger.error("User data import failed", error, {
        operation: "user_data_import_failed",
        targetUserId,
        dryRun,
      });
      throw error;
    }
  }

  /**
   * Import SSH host configurations
   */
  private static async importSshHosts(
    targetUserId: string,
    sshHosts: any[],
    options: { replaceExisting: boolean; dryRun: boolean; userDataKey: Buffer | null }
  ) {
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const host of sshHosts) {
      try {
        if (options.dryRun) {
          imported++;
          continue;
        }

        // Regenerate ID to avoid conflicts
        const newHostData = {
          ...host,
          id: undefined, // Let database auto-generate
          userId: targetUserId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        // If data needs re-encryption
        let processedHostData = newHostData;
        if (options.userDataKey) {
          processedHostData = DataCrypto.encryptRecord("ssh_data", newHostData, targetUserId, options.userDataKey);
        }

        await db.insert(sshData).values(processedHostData);
        imported++;
      } catch (error) {
        errors.push(`SSH host import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        skipped++;
      }
    }

    return { imported, skipped, errors };
  }

  /**
   * Import SSH credentials
   */
  private static async importSshCredentials(
    targetUserId: string,
    credentials: any[],
    options: { replaceExisting: boolean; dryRun: boolean; userDataKey: Buffer | null }
  ) {
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const credential of credentials) {
      try {
        if (options.dryRun) {
          imported++;
          continue;
        }

        // Regenerate ID to avoid conflicts
        const newCredentialData = {
          ...credential,
          id: undefined, // Let database auto-generate
          userId: targetUserId,
          usageCount: 0, // Reset usage count
          lastUsed: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        // If data needs re-encryption
        let processedCredentialData = newCredentialData;
        if (options.userDataKey) {
          processedCredentialData = DataCrypto.encryptRecord("ssh_credentials", newCredentialData, targetUserId, options.userDataKey);
        }

        await db.insert(sshCredentials).values(processedCredentialData);
        imported++;
      } catch (error) {
        errors.push(`SSH credential import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        skipped++;
      }
    }

    return { imported, skipped, errors };
  }

  /**
   * Import file manager data
   */
  private static async importFileManagerData(
    targetUserId: string,
    fileManagerData: any,
    options: { replaceExisting: boolean; dryRun: boolean }
  ) {
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    try {
      // Import recent files
      if (fileManagerData.recent && Array.isArray(fileManagerData.recent)) {
        for (const item of fileManagerData.recent) {
          try {
            if (!options.dryRun) {
              const newItem = {
                ...item,
                id: undefined,
                userId: targetUserId,
                lastOpened: new Date().toISOString(),
              };
              await db.insert(fileManagerRecent).values(newItem);
            }
            imported++;
          } catch (error) {
            errors.push(`Recent file import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            skipped++;
          }
        }
      }

      // Import pinned files
      if (fileManagerData.pinned && Array.isArray(fileManagerData.pinned)) {
        for (const item of fileManagerData.pinned) {
          try {
            if (!options.dryRun) {
              const newItem = {
                ...item,
                id: undefined,
                userId: targetUserId,
                pinnedAt: new Date().toISOString(),
              };
              await db.insert(fileManagerPinned).values(newItem);
            }
            imported++;
          } catch (error) {
            errors.push(`Pinned file import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            skipped++;
          }
        }
      }

      // Import shortcuts
      if (fileManagerData.shortcuts && Array.isArray(fileManagerData.shortcuts)) {
        for (const item of fileManagerData.shortcuts) {
          try {
            if (!options.dryRun) {
              const newItem = {
                ...item,
                id: undefined,
                userId: targetUserId,
                createdAt: new Date().toISOString(),
              };
              await db.insert(fileManagerShortcuts).values(newItem);
            }
            imported++;
          } catch (error) {
            errors.push(`Shortcut import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            skipped++;
          }
        }
      }
    } catch (error) {
      errors.push(`File manager data import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return { imported, skipped, errors };
  }

  /**
   * Import dismissed alerts
   */
  private static async importDismissedAlerts(
    targetUserId: string,
    alerts: any[],
    options: { replaceExisting: boolean; dryRun: boolean }
  ) {
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const alert of alerts) {
      try {
        if (options.dryRun) {
          imported++;
          continue;
        }

        // Check if alert already exists
        const existing = await db
          .select()
          .from(dismissedAlerts)
          .where(
            and(
              eq(dismissedAlerts.userId, targetUserId),
              eq(dismissedAlerts.alertId, alert.alertId)
            )
          );

        if (existing.length > 0 && !options.replaceExisting) {
          skipped++;
          continue;
        }

        const newAlert = {
          ...alert,
          id: undefined,
          userId: targetUserId,
          dismissedAt: new Date().toISOString(),
        };

        if (existing.length > 0 && options.replaceExisting) {
          await db
            .update(dismissedAlerts)
            .set(newAlert)
            .where(eq(dismissedAlerts.id, existing[0].id));
        } else {
          await db.insert(dismissedAlerts).values(newAlert);
        }

        imported++;
      } catch (error) {
        errors.push(`Dismissed alert import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        skipped++;
      }
    }

    return { imported, skipped, errors };
  }

  /**
   * Import from JSON string
   */
  static async importUserDataFromJSON(
    targetUserId: string,
    jsonData: string,
    options: ImportOptions = {}
  ): Promise<ImportResult> {
    try {
      const exportData: UserExportData = JSON.parse(jsonData);
      return await this.importUserData(targetUserId, exportData, options);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("Invalid JSON format in import data");
      }
      throw error;
    }
  }
}

export { UserDataImport, type ImportOptions, type ImportResult };