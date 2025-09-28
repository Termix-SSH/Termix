import { getDb } from "../database/db/index.js";
import {
  users,
  sshData,
  sshCredentials,
  fileManagerRecent,
  fileManagerPinned,
  fileManagerShortcuts,
  dismissedAlerts,
} from "../database/db/schema.js";
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

class UserDataImport {
  static async importUserData(
    targetUserId: string,
    exportData: UserExportData,
    options: ImportOptions = {},
  ): Promise<ImportResult> {
    const {
      replaceExisting = false,
      skipCredentials = false,
      skipFileManagerData = false,
      dryRun = false,
    } = options;

    try {
      const targetUser = await getDb()
        .select()
        .from(users)
        .where(eq(users.id, targetUserId));
      if (!targetUser || targetUser.length === 0) {
        throw new Error(`Target user not found: ${targetUserId}`);
      }

      const validation = UserDataExport.validateExportData(exportData);
      if (!validation.valid) {
        throw new Error(`Invalid export data: ${validation.errors.join(", ")}`);
      }

      let userDataKey: Buffer | null = null;
      if (exportData.metadata.encrypted) {
        userDataKey = DataCrypto.getUserDataKey(targetUserId);
        if (!userDataKey) {
          throw new Error(
            "Target user data not unlocked - password required for encrypted import",
          );
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

      if (
        exportData.userData.sshHosts &&
        exportData.userData.sshHosts.length > 0
      ) {
        const importStats = await this.importSshHosts(
          targetUserId,
          exportData.userData.sshHosts,
          { replaceExisting, dryRun, userDataKey },
        );
        result.summary.sshHostsImported = importStats.imported;
        result.summary.skippedItems += importStats.skipped;
        result.summary.errors.push(...importStats.errors);
      }

      if (
        !skipCredentials &&
        exportData.userData.sshCredentials &&
        exportData.userData.sshCredentials.length > 0
      ) {
        const importStats = await this.importSshCredentials(
          targetUserId,
          exportData.userData.sshCredentials,
          { replaceExisting, dryRun, userDataKey },
        );
        result.summary.sshCredentialsImported = importStats.imported;
        result.summary.skippedItems += importStats.skipped;
        result.summary.errors.push(...importStats.errors);
      }

      if (!skipFileManagerData && exportData.userData.fileManagerData) {
        const importStats = await this.importFileManagerData(
          targetUserId,
          exportData.userData.fileManagerData,
          { replaceExisting, dryRun },
        );
        result.summary.fileManagerItemsImported = importStats.imported;
        result.summary.skippedItems += importStats.skipped;
        result.summary.errors.push(...importStats.errors);
      }

      if (
        exportData.userData.dismissedAlerts &&
        exportData.userData.dismissedAlerts.length > 0
      ) {
        const importStats = await this.importDismissedAlerts(
          targetUserId,
          exportData.userData.dismissedAlerts,
          { replaceExisting, dryRun },
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

  private static async importSshHosts(
    targetUserId: string,
    sshHosts: any[],
    options: {
      replaceExisting: boolean;
      dryRun: boolean;
      userDataKey: Buffer | null;
    },
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

        const tempId = `import-ssh-${targetUserId}-${Date.now()}-${imported}`;
        const newHostData = {
          ...host,
          id: tempId,
          userId: targetUserId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        let processedHostData = newHostData;
        if (options.userDataKey) {
          processedHostData = DataCrypto.encryptRecord(
            "ssh_data",
            newHostData,
            targetUserId,
            options.userDataKey,
          );
        }

        delete processedHostData.id;

        await getDb().insert(sshData).values(processedHostData);
        imported++;
      } catch (error) {
        errors.push(
          `SSH host import failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
        skipped++;
      }
    }

    return { imported, skipped, errors };
  }

  private static async importSshCredentials(
    targetUserId: string,
    credentials: any[],
    options: {
      replaceExisting: boolean;
      dryRun: boolean;
      userDataKey: Buffer | null;
    },
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

        const tempCredId = `import-cred-${targetUserId}-${Date.now()}-${imported}`;
        const newCredentialData = {
          ...credential,
          id: tempCredId,
          userId: targetUserId,
          usageCount: 0,
          lastUsed: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        let processedCredentialData = newCredentialData;
        if (options.userDataKey) {
          processedCredentialData = DataCrypto.encryptRecord(
            "ssh_credentials",
            newCredentialData,
            targetUserId,
            options.userDataKey,
          );
        }

        delete processedCredentialData.id;

        await getDb().insert(sshCredentials).values(processedCredentialData);
        imported++;
      } catch (error) {
        errors.push(
          `SSH credential import failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
        skipped++;
      }
    }

    return { imported, skipped, errors };
  }

  private static async importFileManagerData(
    targetUserId: string,
    fileManagerData: any,
    options: { replaceExisting: boolean; dryRun: boolean },
  ) {
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    try {
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
              await getDb().insert(fileManagerRecent).values(newItem);
            }
            imported++;
          } catch (error) {
            errors.push(
              `Recent file import failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
            skipped++;
          }
        }
      }

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
              await getDb().insert(fileManagerPinned).values(newItem);
            }
            imported++;
          } catch (error) {
            errors.push(
              `Pinned file import failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
            skipped++;
          }
        }
      }

      if (
        fileManagerData.shortcuts &&
        Array.isArray(fileManagerData.shortcuts)
      ) {
        for (const item of fileManagerData.shortcuts) {
          try {
            if (!options.dryRun) {
              const newItem = {
                ...item,
                id: undefined,
                userId: targetUserId,
                createdAt: new Date().toISOString(),
              };
              await getDb().insert(fileManagerShortcuts).values(newItem);
            }
            imported++;
          } catch (error) {
            errors.push(
              `Shortcut import failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
            skipped++;
          }
        }
      }
    } catch (error) {
      errors.push(
        `File manager data import failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }

    return { imported, skipped, errors };
  }

  private static async importDismissedAlerts(
    targetUserId: string,
    alerts: any[],
    options: { replaceExisting: boolean; dryRun: boolean },
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

        const existing = await getDb()
          .select()
          .from(dismissedAlerts)
          .where(
            and(
              eq(dismissedAlerts.userId, targetUserId),
              eq(dismissedAlerts.alertId, alert.alertId),
            ),
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
          await getDb()
            .update(dismissedAlerts)
            .set(newAlert)
            .where(eq(dismissedAlerts.id, existing[0].id));
        } else {
          await getDb().insert(dismissedAlerts).values(newAlert);
        }

        imported++;
      } catch (error) {
        errors.push(
          `Dismissed alert import failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
        skipped++;
      }
    }

    return { imported, skipped, errors };
  }

  static async importUserDataFromJSON(
    targetUserId: string,
    jsonData: string,
    options: ImportOptions = {},
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
