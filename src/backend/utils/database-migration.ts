import fs from "fs";
import path from "path";
import crypto from "crypto";
import { DatabaseFileEncryption } from "./database-file-encryption.js";
import { DatabaseEncryption } from "./database-encryption.js";
import { FieldEncryption } from "./encryption.js";
// Hardware fingerprint removed - using fixed identifier
import { databaseLogger } from "./logger.js";
import { db, databasePaths } from "../database/db/index.js";
import {
  users,
  sshData,
  sshCredentials,
  settings,
  fileManagerRecent,
  fileManagerPinned,
  fileManagerShortcuts,
  dismissedAlerts,
  sshCredentialUsage,
} from "../database/db/schema.js";

interface ExportMetadata {
  version: string;
  exportedAt: string;
  exportId: string;
  sourceIdentifier: string; // Changed from hardware fingerprint
  tableCount: number;
  recordCount: number;
  encryptedFields: string[];
}

interface MigrationExport {
  metadata: ExportMetadata;
  data: {
    [tableName: string]: any[];
  };
}

interface ImportResult {
  success: boolean;
  imported: {
    tables: number;
    records: number;
  };
  errors: string[];
  warnings: string[];
}

/**
 * Database migration utility for exporting/importing data between different hardware
 * Handles both field-level and file-level encryption/decryption during migration
 */
class DatabaseMigration {
  private static readonly VERSION = "v1";
  private static readonly EXPORT_FILE_EXTENSION = ".termix-export.json";

  /**
   * Export database for migration
   * Decrypts all encrypted fields for transport to new hardware
   */
  static async exportDatabase(exportPath?: string): Promise<string> {
    const exportId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const defaultExportPath = path.join(
      databasePaths.directory,
      `termix-export-${timestamp.replace(/[:.]/g, "-")}${this.EXPORT_FILE_EXTENSION}`,
    );
    const actualExportPath = exportPath || defaultExportPath;

    try {
      databaseLogger.info("Starting database export for migration", {
        operation: "database_export",
        exportId,
        exportPath: actualExportPath,
      });

      // Define tables to export and their encryption status
      const tablesToExport = [
        { name: "users", table: users, hasEncryption: true },
        { name: "ssh_data", table: sshData, hasEncryption: true },
        { name: "ssh_credentials", table: sshCredentials, hasEncryption: true },
        { name: "settings", table: settings, hasEncryption: false },
        {
          name: "file_manager_recent",
          table: fileManagerRecent,
          hasEncryption: false,
        },
        {
          name: "file_manager_pinned",
          table: fileManagerPinned,
          hasEncryption: false,
        },
        {
          name: "file_manager_shortcuts",
          table: fileManagerShortcuts,
          hasEncryption: false,
        },
        {
          name: "dismissed_alerts",
          table: dismissedAlerts,
          hasEncryption: false,
        },
        {
          name: "ssh_credential_usage",
          table: sshCredentialUsage,
          hasEncryption: false,
        },
      ];

      const exportData: MigrationExport = {
        metadata: {
          version: this.VERSION,
          exportedAt: timestamp,
          exportId,
          sourceIdentifier: "termix-migration-v1", // Fixed identifier
          tableCount: 0,
          recordCount: 0,
          encryptedFields: [],
        },
        data: {},
      };

      let totalRecords = 0;

      // Export each table
      for (const tableInfo of tablesToExport) {
        try {
          databaseLogger.debug(`Exporting table: ${tableInfo.name}`, {
            operation: "table_export",
            table: tableInfo.name,
            hasEncryption: tableInfo.hasEncryption,
          });

          // Query all records from the table
          const records = await db.select().from(tableInfo.table);

          // Decrypt encrypted fields if necessary
          let processedRecords = records;
          if (tableInfo.hasEncryption && records.length > 0) {
            processedRecords = records.map((record) => {
              try {
                return DatabaseEncryption.decryptRecord(tableInfo.name, record);
              } catch (error) {
                databaseLogger.warn(
                  `Failed to decrypt record in ${tableInfo.name}`,
                  {
                    operation: "export_decrypt_warning",
                    table: tableInfo.name,
                    recordId: (record as any).id,
                    error:
                      error instanceof Error ? error.message : "Unknown error",
                  },
                );
                // Return original record if decryption fails
                return record;
              }
            });

            // Track which fields were encrypted
            if (records.length > 0) {
              const sampleRecord = records[0];
              for (const fieldName of Object.keys(sampleRecord)) {
                if (
                  FieldEncryption.shouldEncryptField(tableInfo.name, fieldName)
                ) {
                  const fieldKey = `${tableInfo.name}.${fieldName}`;
                  if (!exportData.metadata.encryptedFields.includes(fieldKey)) {
                    exportData.metadata.encryptedFields.push(fieldKey);
                  }
                }
              }
            }
          }

          exportData.data[tableInfo.name] = processedRecords;
          totalRecords += processedRecords.length;

          databaseLogger.debug(`Table ${tableInfo.name} exported`, {
            operation: "table_export_complete",
            table: tableInfo.name,
            recordCount: processedRecords.length,
          });
        } catch (error) {
          databaseLogger.error(
            `Failed to export table ${tableInfo.name}`,
            error,
            {
              operation: "table_export_failed",
              table: tableInfo.name,
            },
          );
          throw error;
        }
      }

      // Update metadata
      exportData.metadata.tableCount = tablesToExport.length;
      exportData.metadata.recordCount = totalRecords;

      // Write export file
      const exportContent = JSON.stringify(exportData, null, 2);
      fs.writeFileSync(actualExportPath, exportContent, "utf8");

      databaseLogger.success("Database export completed successfully", {
        operation: "database_export_complete",
        exportId,
        exportPath: actualExportPath,
        tableCount: exportData.metadata.tableCount,
        recordCount: exportData.metadata.recordCount,
        fileSize: exportContent.length,
      });

      return actualExportPath;
    } catch (error) {
      databaseLogger.error("Database export failed", error, {
        operation: "database_export_failed",
        exportId,
        exportPath: actualExportPath,
      });
      throw new Error(
        `Database export failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Import database from migration export
   * Re-encrypts fields for the current hardware
   */
  static async importDatabase(
    importPath: string,
    options: {
      replaceExisting?: boolean;
      backupCurrent?: boolean;
    } = {},
  ): Promise<ImportResult> {
    const { replaceExisting = false, backupCurrent = true } = options;

    if (!fs.existsSync(importPath)) {
      throw new Error(`Import file does not exist: ${importPath}`);
    }

    try {
      databaseLogger.info("Starting database import from migration export", {
        operation: "database_import",
        importPath,
        replaceExisting,
        backupCurrent,
      });

      // Read and validate export file
      const exportContent = fs.readFileSync(importPath, "utf8");
      const exportData: MigrationExport = JSON.parse(exportContent);

      // Validate export format
      if (exportData.metadata.version !== this.VERSION) {
        throw new Error(
          `Unsupported export version: ${exportData.metadata.version}`,
        );
      }

      const result: ImportResult = {
        success: false,
        imported: { tables: 0, records: 0 },
        errors: [],
        warnings: [],
      };

      // Create backup if requested
      if (backupCurrent) {
        try {
          const backupPath = await this.createCurrentDatabaseBackup();
          databaseLogger.info("Current database backed up before import", {
            operation: "import_backup",
            backupPath,
          });
        } catch (error) {
          const warningMsg = `Failed to create backup: ${error instanceof Error ? error.message : "Unknown error"}`;
          result.warnings.push(warningMsg);
          databaseLogger.warn("Failed to create pre-import backup", {
            operation: "import_backup_failed",
            error: warningMsg,
          });
        }
      }

      // Import data table by table
      for (const [tableName, tableData] of Object.entries(exportData.data)) {
        try {
          databaseLogger.debug(`Importing table: ${tableName}`, {
            operation: "table_import",
            table: tableName,
            recordCount: tableData.length,
          });

          if (replaceExisting) {
            // Clear existing data
            const tableSchema = this.getTableSchema(tableName);
            if (tableSchema) {
              await db.delete(tableSchema);
              databaseLogger.debug(`Cleared existing data from ${tableName}`, {
                operation: "table_clear",
                table: tableName,
              });
            }
          }

          // Process and encrypt records
          for (const record of tableData) {
            try {
              // Re-encrypt sensitive fields for current hardware
              const processedRecord = DatabaseEncryption.encryptRecord(
                tableName,
                record,
              );

              // Insert record
              const tableSchema = this.getTableSchema(tableName);
              if (tableSchema) {
                await db.insert(tableSchema).values(processedRecord);
              }
            } catch (error) {
              const errorMsg = `Failed to import record in ${tableName}: ${error instanceof Error ? error.message : "Unknown error"}`;
              result.errors.push(errorMsg);
              databaseLogger.error("Failed to import record", error, {
                operation: "record_import_failed",
                table: tableName,
                recordId: record.id,
              });
            }
          }

          result.imported.tables++;
          result.imported.records += tableData.length;

          databaseLogger.debug(`Table ${tableName} imported`, {
            operation: "table_import_complete",
            table: tableName,
            recordCount: tableData.length,
          });
        } catch (error) {
          const errorMsg = `Failed to import table ${tableName}: ${error instanceof Error ? error.message : "Unknown error"}`;
          result.errors.push(errorMsg);
          databaseLogger.error("Failed to import table", error, {
            operation: "table_import_failed",
            table: tableName,
          });
        }
      }

      // Check if import was successful
      result.success = result.errors.length === 0;

      if (result.success) {
        databaseLogger.success("Database import completed successfully", {
          operation: "database_import_complete",
          importPath,
          tablesImported: result.imported.tables,
          recordsImported: result.imported.records,
          warnings: result.warnings.length,
        });
      } else {
        databaseLogger.error(
          "Database import completed with errors",
          undefined,
          {
            operation: "database_import_partial",
            importPath,
            tablesImported: result.imported.tables,
            recordsImported: result.imported.records,
            errorCount: result.errors.length,
            warningCount: result.warnings.length,
          },
        );
      }

      return result;
    } catch (error) {
      databaseLogger.error("Database import failed", error, {
        operation: "database_import_failed",
        importPath,
      });
      throw new Error(
        `Database import failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Validate export file format and compatibility
   */
  static validateExportFile(exportPath: string): {
    valid: boolean;
    metadata?: ExportMetadata;
    errors: string[];
  } {
    const result = {
      valid: false,
      metadata: undefined as ExportMetadata | undefined,
      errors: [] as string[],
    };

    try {
      if (!fs.existsSync(exportPath)) {
        result.errors.push("Export file does not exist");
        return result;
      }

      const exportContent = fs.readFileSync(exportPath, "utf8");
      const exportData: MigrationExport = JSON.parse(exportContent);

      // Validate structure
      if (!exportData.metadata || !exportData.data) {
        result.errors.push("Invalid export file structure");
        return result;
      }

      // Validate version
      if (exportData.metadata.version !== this.VERSION) {
        result.errors.push(
          `Unsupported export version: ${exportData.metadata.version}`,
        );
        return result;
      }

      // Validate required metadata fields
      const requiredFields = [
        "exportedAt",
        "exportId",
        "sourceIdentifier",
      ];
      for (const field of requiredFields) {
        if (!exportData.metadata[field as keyof ExportMetadata]) {
          result.errors.push(`Missing required metadata field: ${field}`);
        }
      }

      if (result.errors.length === 0) {
        result.valid = true;
        result.metadata = exportData.metadata;
      }

      return result;
    } catch (error) {
      result.errors.push(
        `Failed to parse export file: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return result;
    }
  }

  /**
   * Create backup of current database
   */
  private static async createCurrentDatabaseBackup(): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupDir = path.join(databasePaths.directory, "backups");

    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    // Create encrypted backup
    const backupPath = DatabaseFileEncryption.createEncryptedBackup(
      databasePaths.main,
      backupDir,
    );

    return backupPath;
  }

  /**
   * Get table schema for database operations
   */
  private static getTableSchema(tableName: string) {
    const tableMap: { [key: string]: any } = {
      users: users,
      ssh_data: sshData,
      ssh_credentials: sshCredentials,
      settings: settings,
      file_manager_recent: fileManagerRecent,
      file_manager_pinned: fileManagerPinned,
      file_manager_shortcuts: fileManagerShortcuts,
      dismissed_alerts: dismissedAlerts,
      ssh_credential_usage: sshCredentialUsage,
    };

    return tableMap[tableName];
  }

  /**
   * Get export file info without importing
   */
  static getExportInfo(exportPath: string): ExportMetadata | null {
    const validation = this.validateExportFile(exportPath);
    return validation.valid ? validation.metadata! : null;
  }
}

export { DatabaseMigration };
export type { ExportMetadata, MigrationExport, ImportResult };
