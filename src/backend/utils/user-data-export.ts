import {
  createCurrentUserDataExportRepository,
  createCurrentUserRepository,
} from "../database/repositories/factory.js";
import { readUserPluginRows } from "../plugins/user-data.js";
import { DataCrypto } from "./data-crypto.js";
import { databaseLogger } from "./logger.js";

interface UserExportData {
  version: string;
  exportedAt: string;
  userId: string;
  username: string;
  userData: {
    sshHosts: unknown[];
    sshCredentials: unknown[];
    /** The user's rows in plugin tables, keyed by table name. */
    pluginData: Record<string, unknown[]>;
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
      const userRecord = await createCurrentUserRepository().findById(userId);
      if (!userRecord) {
        throw new Error(`User not found: ${userId}`);
      }

      let userDataKey: Buffer | null = null;
      if (format === "plaintext") {
        userDataKey = DataCrypto.getUserDataKey(userId);
        if (!userDataKey) {
          throw new Error(
            "User data not unlocked - password required for plaintext export",
          );
        }
      }

      const exportRepository = createCurrentUserDataExportRepository();
      const sshHosts = await exportRepository.listHostsByUserId(userId);
      const processedSshHosts =
        format === "plaintext" && userDataKey
          ? sshHosts.map((host) =>
              DataCrypto.decryptRecord("ssh_data", host, userId, userDataKey!),
            )
          : sshHosts;

      let sshCredentialsData: unknown[] = [];
      if (includeCredentials) {
        const credentials =
          await exportRepository.listCredentialsByUserId(userId);
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

      const pluginData = await readUserPluginRows(userId);
      const pluginRowCount = Object.values(pluginData).reduce(
        (total, rows) => total + rows.length,
        0,
      );

      const exportData: UserExportData = {
        version: this.EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        userId: userRecord.id,
        username: userRecord.username,
        userData: {
          sshHosts: processedSshHosts,
          sshCredentials: sshCredentialsData,
          pluginData,
        },
        metadata: {
          totalRecords:
            processedSshHosts.length +
            sshCredentialsData.length +
            pluginRowCount,
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

  static validateExportData(data: unknown): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!data || typeof data !== "object") {
      errors.push("Export data must be an object");
      return { valid: false, errors };
    }

    const dataObj = data as Record<string, unknown>;

    if (!dataObj.version) {
      errors.push("Missing version field");
    }

    if (!dataObj.userId) {
      errors.push("Missing userId field");
    }

    if (!dataObj.userData || typeof dataObj.userData !== "object") {
      errors.push("Missing or invalid userData field");
    }

    if (!dataObj.metadata || typeof dataObj.metadata !== "object") {
      errors.push("Missing or invalid metadata field");
    }

    if (dataObj.userData) {
      const userData = dataObj.userData as Record<string, unknown>;
      const requiredFields = ["sshHosts", "sshCredentials"];
      for (const field of requiredFields) {
        if (!Array.isArray(userData[field])) {
          errors.push(`Missing or invalid userData.${field} field`);
        }
      }

      if (
        userData.pluginData !== undefined &&
        (typeof userData.pluginData !== "object" ||
          userData.pluginData === null ||
          Object.values(userData.pluginData).some(
            (rows) => !Array.isArray(rows),
          ))
      ) {
        errors.push("Missing or invalid userData.pluginData field");
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
      pluginRows: number;
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
        pluginRows: Object.values(data.userData.pluginData ?? {}).reduce(
          (total, rows) => total + rows.length,
          0,
        ),
      },
      encrypted: data.metadata.encrypted,
    };
  }
}

export { UserDataExport, type UserExportData };
