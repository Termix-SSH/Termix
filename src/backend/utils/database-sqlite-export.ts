import fs from "fs";
import path from "path";
import crypto from "crypto";
import Database from "better-sqlite3";
import { sql, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { DatabaseEncryption } from "./database-encryption.js";
import { FieldEncryption } from "./encryption.js";
import { HardwareFingerprint } from "./hardware-fingerprint.js";
import { databaseLogger } from "./logger.js";
import { databasePaths, db, sqliteInstance } from "../database/db/index.js";
import { sshData, sshCredentials, users } from "../database/db/schema.js";

interface ExportMetadata {
  version: string;
  exportedAt: string;
  exportId: string;
  sourceHardwareFingerprint: string;
  tableCount: number;
  recordCount: number;
  encryptedFields: string[];
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
 * SQLite database export/import utility for hardware migration
 * Exports decrypted data to a new SQLite database file for hardware transfer
 */
class DatabaseSQLiteExport {
  private static readonly VERSION = "v1";
  private static readonly EXPORT_FILE_EXTENSION = ".termix-export.sqlite";
  private static readonly METADATA_TABLE = "_termix_export_metadata";

  /**
   * Export database as SQLite file for migration
   * Creates a new SQLite database with decrypted data
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
      databaseLogger.info("Starting SQLite database export for migration", {
        operation: "database_sqlite_export",
        exportId,
        exportPath: actualExportPath,
      });

      // Create new SQLite database for export
      const exportDb = new Database(actualExportPath);

      // Define tables to export - only SSH-related data
      const tablesToExport = [
        { name: "ssh_data", hasEncryption: true },
        { name: "ssh_credentials", hasEncryption: true },
      ];

      const exportMetadata: ExportMetadata = {
        version: this.VERSION,
        exportedAt: timestamp,
        exportId,
        sourceHardwareFingerprint: HardwareFingerprint.generate().substring(
          0,
          16,
        ),
        tableCount: 0,
        recordCount: 0,
        encryptedFields: [],
      };

      let totalRecords = 0;

      // Check total records in SSH tables for debugging
      const totalSshData = await db.select().from(sshData);
      const totalSshCredentials = await db.select().from(sshCredentials);

      databaseLogger.info(`Export preparation: found SSH data`, {
        operation: "export_data_check",
        totalSshData: totalSshData.length,
        totalSshCredentials: totalSshCredentials.length,
      });

      // Create metadata table
      exportDb.exec(`
        CREATE TABLE ${this.METADATA_TABLE} (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);

      // Copy schema and data for each table
      for (const tableInfo of tablesToExport) {
        try {
          databaseLogger.debug(`Exporting SQLite table: ${tableInfo.name}`, {
            operation: "table_sqlite_export",
            table: tableInfo.name,
            hasEncryption: tableInfo.hasEncryption,
          });

          // Create table in export database using consistent schema
          if (tableInfo.name === "ssh_data") {
            // Create ssh_data table using exact schema matching Drizzle definition
            const createTableSql = `CREATE TABLE ssh_data (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_id TEXT NOT NULL,
              name TEXT,
              ip TEXT NOT NULL,
              port INTEGER NOT NULL,
              username TEXT NOT NULL,
              folder TEXT,
              tags TEXT,
              pin INTEGER NOT NULL DEFAULT 0,
              auth_type TEXT NOT NULL,
              password TEXT,
              require_password INTEGER NOT NULL DEFAULT 1,
              key TEXT,
              key_password TEXT,
              key_type TEXT,
              credential_id INTEGER,
              enable_terminal INTEGER NOT NULL DEFAULT 1,
              enable_tunnel INTEGER NOT NULL DEFAULT 1,
              tunnel_connections TEXT,
              enable_file_manager INTEGER NOT NULL DEFAULT 1,
              default_path TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )`;
            exportDb.exec(createTableSql);
          } else if (tableInfo.name === "ssh_credentials") {
            // Create ssh_credentials table using exact schema matching Drizzle definition
            const createTableSql = `CREATE TABLE ssh_credentials (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              username TEXT,
              password TEXT,
              key_content TEXT,
              key_password TEXT,
              key_type TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )`;
            exportDb.exec(createTableSql);
          } else {
            databaseLogger.warn(`Unknown table ${tableInfo.name}, skipping`, {
              operation: "table_sqlite_export_skip",
              table: tableInfo.name,
            });
            continue;
          }

          // Query all records from tables using Drizzle
          let records: any[];
          if (tableInfo.name === "ssh_data") {
            records = await db.select().from(sshData);
          } else if (tableInfo.name === "ssh_credentials") {
            records = await db.select().from(sshCredentials);
          } else {
            records = [];
          }

          databaseLogger.info(
            `Found ${records.length} records in ${tableInfo.name} for export`,
            {
              operation: "table_record_count",
              table: tableInfo.name,
              recordCount: records.length,
            },
          );

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
                return record;
              }
            });

            // Track encrypted fields
            const sampleRecord = records[0];
            for (const fieldName of Object.keys(sampleRecord)) {
              if (this.shouldTrackEncryptedField(tableInfo.name, fieldName)) {
                const fieldKey = `${tableInfo.name}.${fieldName}`;
                if (!exportMetadata.encryptedFields.includes(fieldKey)) {
                  exportMetadata.encryptedFields.push(fieldKey);
                }
              }
            }
          }

          // Insert records into export database
          if (processedRecords.length > 0) {
            const sampleRecord = processedRecords[0];
            const tsFieldNames = Object.keys(sampleRecord);

            // Map TypeScript field names to database column names
            const dbColumnNames = tsFieldNames.map((fieldName) => {
              // Map TypeScript field names to database column names
              const fieldMappings: Record<string, string> = {
                userId: "user_id",
                authType: "auth_type",
                requirePassword: "require_password",
                keyPassword: "key_password",
                keyType: "key_type",
                credentialId: "credential_id",
                enableTerminal: "enable_terminal",
                enableTunnel: "enable_tunnel",
                tunnelConnections: "tunnel_connections",
                enableFileManager: "enable_file_manager",
                defaultPath: "default_path",
                createdAt: "created_at",
                updatedAt: "updated_at",
                keyContent: "key_content",
              };
              return fieldMappings[fieldName] || fieldName;
            });

            const placeholders = dbColumnNames.map(() => "?").join(", ");
            const insertSql = `INSERT INTO ${tableInfo.name} (${dbColumnNames.join(", ")}) VALUES (${placeholders})`;

            const insertStmt = exportDb.prepare(insertSql);

            for (const record of processedRecords) {
              const values = tsFieldNames.map((fieldName) => {
                const value: any = record[fieldName as keyof typeof record];
                // Convert values to SQLite-compatible types
                if (value === null || value === undefined) {
                  return null;
                }
                if (
                  typeof value === "string" ||
                  typeof value === "number" ||
                  typeof value === "bigint"
                ) {
                  return value;
                }
                if (Buffer.isBuffer(value)) {
                  return value;
                }
                if (value instanceof Date) {
                  return value.toISOString();
                }
                if (typeof value === "boolean") {
                  return value ? 1 : 0;
                }
                // Convert objects and arrays to JSON strings
                if (typeof value === "object") {
                  return JSON.stringify(value);
                }
                // Fallback: convert to string
                return String(value);
              });
              insertStmt.run(values);
            }
          }

          totalRecords += processedRecords.length;

          databaseLogger.debug(`SQLite table ${tableInfo.name} exported`, {
            operation: "table_sqlite_export_complete",
            table: tableInfo.name,
            recordCount: processedRecords.length,
          });
        } catch (error) {
          databaseLogger.error(
            `Failed to export SQLite table ${tableInfo.name}`,
            error,
            {
              operation: "table_sqlite_export_failed",
              table: tableInfo.name,
            },
          );
          throw error;
        }
      }

      // Update and store metadata
      exportMetadata.tableCount = tablesToExport.length;
      exportMetadata.recordCount = totalRecords;

      const insertMetadata = exportDb.prepare(
        `INSERT INTO ${this.METADATA_TABLE} (key, value) VALUES (?, ?)`,
      );
      insertMetadata.run("metadata", JSON.stringify(exportMetadata));

      // Close export database
      exportDb.close();

      databaseLogger.success("SQLite database export completed successfully", {
        operation: "database_sqlite_export_complete",
        exportId,
        exportPath: actualExportPath,
        tableCount: exportMetadata.tableCount,
        recordCount: exportMetadata.recordCount,
        fileSize: fs.statSync(actualExportPath).size,
      });

      return actualExportPath;
    } catch (error) {
      databaseLogger.error("SQLite database export failed", error, {
        operation: "database_sqlite_export_failed",
        exportId,
        exportPath: actualExportPath,
      });
      throw new Error(
        `SQLite database export failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Import database from SQLite export
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
      databaseLogger.info("Starting SQLite database import from export", {
        operation: "database_sqlite_import",
        importPath,
        replaceExisting,
        backupCurrent,
      });

      // Open import database
      const importDb = new Database(importPath, { readonly: true });

      // Validate export format
      const metadataResult = importDb
        .prepare(
          `
        SELECT value FROM ${this.METADATA_TABLE} WHERE key = 'metadata'
      `,
        )
        .get() as { value: string } | undefined;

      if (!metadataResult) {
        throw new Error("Invalid export file: missing metadata");
      }

      const metadata: ExportMetadata = JSON.parse(metadataResult.value);
      if (metadata.version !== this.VERSION) {
        throw new Error(`Unsupported export version: ${metadata.version}`);
      }

      const result: ImportResult = {
        success: false,
        imported: { tables: 0, records: 0 },
        errors: [],
        warnings: [],
      };

      // Get current admin user to assign imported SSH records
      const adminUser = await db
        .select()
        .from(users)
        .where(eq(users.is_admin, true))
        .limit(1);
      if (adminUser.length === 0) {
        throw new Error("No admin user found in current database");
      }
      const currentAdminUserId = adminUser[0].id;

      databaseLogger.debug(
        `Starting SSH data import - assigning to admin user ${currentAdminUserId}`,
        {
          operation: "ssh_data_import_start",
          adminUserId: currentAdminUserId,
        },
      );

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

      // Get list of tables to import (excluding metadata table)
      const tables = importDb
        .prepare(
          `
        SELECT name FROM sqlite_master
        WHERE type='table' AND name != '${this.METADATA_TABLE}'
      `,
        )
        .all() as { name: string }[];

      // Import data table by table
      for (const tableRow of tables) {
        const tableName = tableRow.name;

        try {
          databaseLogger.debug(`Importing SQLite table: ${tableName}`, {
            operation: "table_sqlite_import",
            table: tableName,
          });

          // Use additive import - don't clear existing data
          // This preserves all current data including admin SSH connections
          databaseLogger.debug(`Using additive import for ${tableName}`, {
            operation: "table_additive_import",
            table: tableName,
          });

          // Get all records from import table
          const records = importDb.prepare(`SELECT * FROM ${tableName}`).all();

          // Process and encrypt records
          for (const record of records) {
            try {
              // Import all SSH data without user filtering

              // Map database column names to TypeScript field names
              const mappedRecord: any = {};
              const columnToFieldMappings: Record<string, string> = {
                user_id: "userId",
                auth_type: "authType",
                require_password: "requirePassword",
                key_password: "keyPassword",
                key_type: "keyType",
                credential_id: "credentialId",
                enable_terminal: "enableTerminal",
                enable_tunnel: "enableTunnel",
                tunnel_connections: "tunnelConnections",
                enable_file_manager: "enableFileManager",
                default_path: "defaultPath",
                created_at: "createdAt",
                updated_at: "updatedAt",
                key_content: "keyContent",
              };

              // Convert database column names to TypeScript field names
              for (const [dbColumn, value] of Object.entries(record)) {
                const tsField = columnToFieldMappings[dbColumn] || dbColumn;
                mappedRecord[tsField] = value;
              }

              // Assign imported SSH records to current admin user to avoid foreign key constraint
              if (tableName === "ssh_data" && mappedRecord.userId) {
                const originalUserId = mappedRecord.userId;
                mappedRecord.userId = currentAdminUserId;
                databaseLogger.debug(
                  `Reassigned SSH record from user ${originalUserId} to admin ${currentAdminUserId}`,
                  {
                    operation: "user_reassignment",
                    originalUserId,
                    newUserId: currentAdminUserId,
                  },
                );
              }

              // Re-encrypt sensitive fields for current hardware
              const processedRecord = DatabaseEncryption.encryptRecord(
                tableName,
                mappedRecord,
              );

              // Insert record using Drizzle
              try {
                if (tableName === "ssh_data") {
                  await db
                    .insert(sshData)
                    .values(processedRecord)
                    .onConflictDoNothing();
                } else if (tableName === "ssh_credentials") {
                  await db
                    .insert(sshCredentials)
                    .values(processedRecord)
                    .onConflictDoNothing();
                }
              } catch (error) {
                // Handle any SQL errors gracefully
                if (
                  error instanceof Error &&
                  error.message.includes("UNIQUE constraint failed")
                ) {
                  databaseLogger.debug(
                    `Skipping duplicate record in ${tableName}`,
                    {
                      operation: "duplicate_record_skip",
                      table: tableName,
                    },
                  );
                  continue;
                }
                throw error;
              }
            } catch (error) {
              const errorMsg = `Failed to import record in ${tableName}: ${error instanceof Error ? error.message : "Unknown error"}`;
              result.errors.push(errorMsg);
              databaseLogger.error("Failed to import record", error, {
                operation: "record_sqlite_import_failed",
                table: tableName,
                recordId: (record as any).id,
              });
            }
          }

          result.imported.tables++;
          result.imported.records += records.length;

          databaseLogger.debug(`SQLite table ${tableName} imported`, {
            operation: "table_sqlite_import_complete",
            table: tableName,
            recordCount: records.length,
          });
        } catch (error) {
          const errorMsg = `Failed to import table ${tableName}: ${error instanceof Error ? error.message : "Unknown error"}`;
          result.errors.push(errorMsg);
          databaseLogger.error("Failed to import SQLite table", error, {
            operation: "table_sqlite_import_failed",
            table: tableName,
          });
        }
      }

      // Close import database
      importDb.close();

      // Check if import was successful
      result.success = result.errors.length === 0;

      if (result.success) {
        databaseLogger.success(
          "SQLite database import completed successfully",
          {
            operation: "database_sqlite_import_complete",
            importPath,
            tablesImported: result.imported.tables,
            recordsImported: result.imported.records,
            warnings: result.warnings.length,
          },
        );
      } else {
        databaseLogger.error(
          "SQLite database import completed with errors",
          undefined,
          {
            operation: "database_sqlite_import_partial",
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
      databaseLogger.error("SQLite database import failed", error, {
        operation: "database_sqlite_import_failed",
        importPath,
      });
      throw new Error(
        `SQLite database import failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Validate SQLite export file
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

      if (!exportPath.endsWith(this.EXPORT_FILE_EXTENSION)) {
        result.errors.push("Invalid export file extension");
        return result;
      }

      const exportDb = new Database(exportPath, { readonly: true });

      try {
        const metadataResult = exportDb
          .prepare(
            `
          SELECT value FROM ${this.METADATA_TABLE} WHERE key = 'metadata'
        `,
          )
          .get() as { value: string } | undefined;

        if (!metadataResult) {
          result.errors.push("Missing export metadata");
          return result;
        }

        const metadata: ExportMetadata = JSON.parse(metadataResult.value);

        if (metadata.version !== this.VERSION) {
          result.errors.push(`Unsupported export version: ${metadata.version}`);
          return result;
        }

        result.valid = true;
        result.metadata = metadata;
      } finally {
        exportDb.close();
      }

      return result;
    } catch (error) {
      result.errors.push(
        `Failed to validate export file: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return result;
    }
  }

  /**
   * Get export file info without importing
   */
  static getExportInfo(exportPath: string): ExportMetadata | null {
    const validation = this.validateExportFile(exportPath);
    return validation.valid ? validation.metadata! : null;
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

    // Create SQLite backup
    const backupPath = path.join(
      backupDir,
      `database-backup-${timestamp}.sqlite`,
    );

    // Copy current database file
    fs.copyFileSync(databasePaths.main, backupPath);

    return backupPath;
  }

  /**
   * Get table schema for database operations
   * NOTE: This method is deprecated - we now use raw SQL to avoid FK issues
   */
  private static getTableSchema(tableName: string) {
    return null; // No longer used
  }

  /**
   * Check if a field should be tracked as encrypted
   */
  private static shouldTrackEncryptedField(
    tableName: string,
    fieldName: string,
  ): boolean {
    try {
      return FieldEncryption.shouldEncryptField(tableName, fieldName);
    } catch {
      return false;
    }
  }
}

export { DatabaseSQLiteExport };
export type { ExportMetadata, ImportResult };
