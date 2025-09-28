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
import { eq } from "drizzle-orm";
import { DataCrypto } from "./data-crypto.js";
import { databaseLogger } from "./logger.js";

interface UserExportData {
  version: string;
  exportedAt: string;
  userId: string;
  username: string;
  userData: {
    sshHosts: any[];
    sshCredentials: any[];
    fileManagerData: {
      recent: any[];
      pinned: any[];
      shortcuts: any[];
    };
    dismissedAlerts: any[];
  };
  metadata: {
    totalRecords: number;
    encrypted: boolean;
    exportType: "user_data" | "system_config" | "all";
  };
}

class UserDataExport {
  private static readonly EXPORT_VERSION = "v2.0";

  static async exportUserData(
    userId: string,
    options: {
      format?: "encrypted" | "plaintext";
      scope?: "user_data" | "all";
      includeCredentials?: boolean;
    } = {},
  ): Promise<UserExportData> {
    const {
      format = "encrypted",
      scope = "user_data",
      includeCredentials = true,
    } = options;

    try {
      const user = await getDb()
        .select()
        .from(users)
        .where(eq(users.id, userId));
      if (!user || user.length === 0) {
        throw new Error(`User not found: ${userId}`);
      }

      const userRecord = user[0];

      let userDataKey: Buffer | null = null;
      if (format === "plaintext") {
        userDataKey = DataCrypto.getUserDataKey(userId);
        if (!userDataKey) {
          throw new Error(
            "User data not unlocked - password required for plaintext export",
          );
        }
      }

      const sshHosts = await getDb()
        .select()
        .from(sshData)
        .where(eq(sshData.userId, userId));
      const processedSshHosts =
        format === "plaintext" && userDataKey
          ? sshHosts.map((host) =>
              DataCrypto.decryptRecord("ssh_data", host, userId, userDataKey!),
            )
          : sshHosts;

      let sshCredentialsData: any[] = [];
      if (includeCredentials) {
        const credentials = await getDb()
          .select()
          .from(sshCredentials)
          .where(eq(sshCredentials.userId, userId));
        sshCredentialsData =
          format === "plaintext" && userDataKey
            ? credentials.map((cred) =>
                DataCrypto.decryptRecord(
                  "ssh_credentials",
                  cred,
                  userId,
                  userDataKey!,
                ),
              )
            : credentials;
      }

      const [recentFiles, pinnedFiles, shortcuts] = await Promise.all([
        getDb()
          .select()
          .from(fileManagerRecent)
          .where(eq(fileManagerRecent.userId, userId)),
        getDb()
          .select()
          .from(fileManagerPinned)
          .where(eq(fileManagerPinned.userId, userId)),
        getDb()
          .select()
          .from(fileManagerShortcuts)
          .where(eq(fileManagerShortcuts.userId, userId)),
      ]);

      const alerts = await getDb()
        .select()
        .from(dismissedAlerts)
        .where(eq(dismissedAlerts.userId, userId));

      const exportData: UserExportData = {
        version: this.EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        userId: userRecord.id,
        username: userRecord.username,
        userData: {
          sshHosts: processedSshHosts,
          sshCredentials: sshCredentialsData,
          fileManagerData: {
            recent: recentFiles,
            pinned: pinnedFiles,
            shortcuts: shortcuts,
          },
          dismissedAlerts: alerts,
        },
        metadata: {
          totalRecords:
            processedSshHosts.length +
            sshCredentialsData.length +
            recentFiles.length +
            pinnedFiles.length +
            shortcuts.length +
            alerts.length,
          encrypted: format === "encrypted",
          exportType: scope,
        },
      };

      databaseLogger.success("User data export completed", {
        operation: "user_data_export_complete",
        userId,
        totalRecords: exportData.metadata.totalRecords,
        format,
        sshHosts: processedSshHosts.length,
        sshCredentials: sshCredentialsData.length,
      });

      return exportData;
    } catch (error) {
      databaseLogger.error("User data export failed", error, {
        operation: "user_data_export_failed",
        userId,
        format,
        scope,
      });
      throw error;
    }
  }

  static async exportUserDataToJSON(
    userId: string,
    options: {
      format?: "encrypted" | "plaintext";
      scope?: "user_data" | "all";
      includeCredentials?: boolean;
      pretty?: boolean;
    } = {},
  ): Promise<string> {
    const { pretty = true } = options;
    const exportData = await this.exportUserData(userId, options);
    return JSON.stringify(exportData, null, pretty ? 2 : 0);
  }

  static validateExportData(data: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!data || typeof data !== "object") {
      errors.push("Export data must be an object");
      return { valid: false, errors };
    }

    if (!data.version) {
      errors.push("Missing version field");
    }

    if (!data.userId) {
      errors.push("Missing userId field");
    }

    if (!data.userData || typeof data.userData !== "object") {
      errors.push("Missing or invalid userData field");
    }

    if (!data.metadata || typeof data.metadata !== "object") {
      errors.push("Missing or invalid metadata field");
    }

    if (data.userData) {
      const requiredFields = [
        "sshHosts",
        "sshCredentials",
        "fileManagerData",
        "dismissedAlerts",
      ];
      for (const field of requiredFields) {
        if (
          !Array.isArray(data.userData[field]) &&
          !(
            field === "fileManagerData" &&
            typeof data.userData[field] === "object"
          )
        ) {
          errors.push(`Missing or invalid userData.${field} field`);
        }
      }

      if (
        data.userData.fileManagerData &&
        typeof data.userData.fileManagerData === "object"
      ) {
        const fmFields = ["recent", "pinned", "shortcuts"];
        for (const field of fmFields) {
          if (!Array.isArray(data.userData.fileManagerData[field])) {
            errors.push(
              `Missing or invalid userData.fileManagerData.${field} field`,
            );
          }
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  static getExportStats(data: UserExportData): {
    version: string;
    exportedAt: string;
    username: string;
    totalRecords: number;
    breakdown: {
      sshHosts: number;
      sshCredentials: number;
      fileManagerItems: number;
      dismissedAlerts: number;
    };
    encrypted: boolean;
  } {
    return {
      version: data.version,
      exportedAt: data.exportedAt,
      username: data.username,
      totalRecords: data.metadata.totalRecords,
      breakdown: {
        sshHosts: data.userData.sshHosts.length,
        sshCredentials: data.userData.sshCredentials.length,
        fileManagerItems:
          data.userData.fileManagerData.recent.length +
          data.userData.fileManagerData.pinned.length +
          data.userData.fileManagerData.shortcuts.length,
        dismissedAlerts: data.userData.dismissedAlerts.length,
      },
      encrypted: data.metadata.encrypted,
    };
  }
}

export { UserDataExport, type UserExportData };
