import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { databaseLogger } from "./logger.js";
import { DatabaseFileEncryption } from "./database-file-encryption.js";

export interface MigrationResult {
  success: boolean;
  error?: string;
  migratedTables: number;
  migratedRows: number;
  backupPath?: string;
  duration: number;
}

export interface MigrationStatus {
  needsMigration: boolean;
  hasUnencryptedDb: boolean;
  hasEncryptedDb: boolean;
  unencryptedDbSize: number;
  reason: string;
}

export class DatabaseMigration {
  private dataDir: string;
  private unencryptedDbPath: string;
  private encryptedDbPath: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.unencryptedDbPath = path.join(dataDir, "db.sqlite");
    this.encryptedDbPath = `${this.unencryptedDbPath}.encrypted`;
  }

  checkMigrationStatus(): MigrationStatus {
    const hasUnencryptedDb = fs.existsSync(this.unencryptedDbPath);
    const hasEncryptedDb = DatabaseFileEncryption.isEncryptedDatabaseFile(
      this.encryptedDbPath,
    );

    let unencryptedDbSize = 0;
    if (hasUnencryptedDb) {
      try {
        unencryptedDbSize = fs.statSync(this.unencryptedDbPath).size;
      } catch (error) {
        databaseLogger.warn("Could not get unencrypted database file size", {
          operation: "migration_status_check",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    let needsMigration = false;
    let reason = "";

    if (hasEncryptedDb && hasUnencryptedDb) {
      const unencryptedSize = fs.statSync(this.unencryptedDbPath).size;
      const encryptedSize = fs.statSync(this.encryptedDbPath).size;

      if (unencryptedSize === 0) {
        needsMigration = false;
        reason =
          "Empty unencrypted database found alongside encrypted database. Removing empty file.";
        try {
          fs.unlinkSync(this.unencryptedDbPath);
          databaseLogger.info("Removed empty unencrypted database file", {
            operation: "migration_cleanup_empty",
            path: this.unencryptedDbPath,
          });
        } catch (error) {
          databaseLogger.warn("Failed to remove empty unencrypted database", {
            operation: "migration_cleanup_empty_failed",
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      } else {
        needsMigration = false;
        reason =
          "Both encrypted and unencrypted databases exist. Skipping migration for safety. Manual intervention may be required.";
      }
    } else if (hasEncryptedDb && !hasUnencryptedDb) {
      needsMigration = false;
      reason = "Only encrypted database exists. No migration needed.";
    } else if (!hasEncryptedDb && hasUnencryptedDb) {
      needsMigration = true;
      reason =
        "Unencrypted database found. Migration to encrypted format required.";
    } else {
      needsMigration = false;
      reason = "No existing database found. This is a fresh installation.";
    }

    return {
      needsMigration,
      hasUnencryptedDb,
      hasEncryptedDb,
      unencryptedDbSize,
      reason,
    };
  }

  private createBackup(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${this.unencryptedDbPath}.migration-backup-${timestamp}`;

    try {
      fs.copyFileSync(this.unencryptedDbPath, backupPath);

      const originalSize = fs.statSync(this.unencryptedDbPath).size;
      const backupSize = fs.statSync(backupPath).size;

      if (originalSize !== backupSize) {
        throw new Error(
          `Backup size mismatch: original=${originalSize}, backup=${backupSize}`,
        );
      }

      return backupPath;
    } catch (error) {
      databaseLogger.error("Failed to create migration backup", error, {
        operation: "migration_backup_failed",
        source: this.unencryptedDbPath,
        backup: backupPath,
      });
      throw new Error(
        `Backup creation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  private async verifyMigration(
    originalDb: Database.Database,
    memoryDb: Database.Database,
  ): Promise<boolean> {
    try {
      memoryDb.exec("PRAGMA foreign_keys = OFF");

      const originalTables = originalDb
        .prepare(
          `
          SELECT name FROM sqlite_master
          WHERE type='table' AND name NOT LIKE 'sqlite_%'
          ORDER BY name
        `,
        )
        .all() as { name: string }[];

      const memoryTables = memoryDb
        .prepare(
          `
          SELECT name FROM sqlite_master
          WHERE type='table' AND name NOT LIKE 'sqlite_%'
          ORDER BY name
        `,
        )
        .all() as { name: string }[];

      if (originalTables.length !== memoryTables.length) {
        databaseLogger.error(
          "Table count mismatch during migration verification",
          null,
          {
            operation: "migration_verify_failed",
            originalCount: originalTables.length,
            memoryCount: memoryTables.length,
          },
        );
        return false;
      }

      let totalOriginalRows = 0;
      let totalMemoryRows = 0;

      for (const table of originalTables) {
        const originalCount = originalDb
          .prepare(`SELECT COUNT(*) as count FROM ${table.name}`)
          .get() as { count: number };
        const memoryCount = memoryDb
          .prepare(`SELECT COUNT(*) as count FROM ${table.name}`)
          .get() as { count: number };

        totalOriginalRows += originalCount.count;
        totalMemoryRows += memoryCount.count;

        if (originalCount.count !== memoryCount.count) {
          databaseLogger.error(
            "Row count mismatch for table during migration verification",
            null,
            {
              operation: "migration_verify_table_failed",
              table: table.name,
              originalRows: originalCount.count,
              memoryRows: memoryCount.count,
            },
          );
          return false;
        }
      }

      memoryDb.exec("PRAGMA foreign_keys = ON");

      return true;
    } catch (error) {
      databaseLogger.error("Migration verification failed", error, {
        operation: "migration_verify_error",
      });
      return false;
    }
  }

  async migrateDatabase(): Promise<MigrationResult> {
    const startTime = Date.now();
    let backupPath: string | undefined;
    let migratedTables = 0;
    let migratedRows = 0;

    try {
      backupPath = this.createBackup();

      const originalDb = new Database(this.unencryptedDbPath, {
        readonly: true,
      });

      const memoryDb = new Database(":memory:");

      try {
        const tables = originalDb
          .prepare(
            `
            SELECT name, sql FROM sqlite_master
            WHERE type='table' AND name NOT LIKE 'sqlite_%'
          `,
          )
          .all() as { name: string; sql: string }[];

        for (const table of tables) {
          memoryDb.exec(table.sql);
          migratedTables++;
        }

        memoryDb.exec("PRAGMA foreign_keys = OFF");

        for (const table of tables) {
          const rows = originalDb.prepare(`SELECT * FROM ${table.name}`).all();

          if (rows.length > 0) {
            const columns = Object.keys(rows[0]);
            const placeholders = columns.map(() => "?").join(", ");
            const insertStmt = memoryDb.prepare(
              `INSERT INTO ${table.name} (${columns.join(", ")}) VALUES (${placeholders})`,
            );

            const insertTransaction = memoryDb.transaction(
              (dataRows: any[]) => {
                for (const row of dataRows) {
                  const values = columns.map((col) => row[col]);
                  insertStmt.run(values);
                }
              },
            );

            insertTransaction(rows);
            migratedRows += rows.length;
          }
        }

        memoryDb.exec("PRAGMA foreign_keys = ON");

        const fkCheckResult = memoryDb
          .prepare("PRAGMA foreign_key_check")
          .all();
        if (fkCheckResult.length > 0) {
          databaseLogger.error(
            "Foreign key constraints violations detected after migration",
            null,
            {
              operation: "migration_fk_check_failed",
              violations: fkCheckResult,
            },
          );
          throw new Error(
            `Foreign key violations detected: ${JSON.stringify(fkCheckResult)}`,
          );
        }

        const verificationPassed = await this.verifyMigration(
          originalDb,
          memoryDb,
        );
        if (!verificationPassed) {
          throw new Error("Migration integrity verification failed");
        }

        const buffer = memoryDb.serialize();

        await DatabaseFileEncryption.encryptDatabaseFromBuffer(
          buffer,
          this.encryptedDbPath,
        );

        if (
          !DatabaseFileEncryption.isEncryptedDatabaseFile(this.encryptedDbPath)
        ) {
          throw new Error("Encrypted database file verification failed");
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const migratedPath = `${this.unencryptedDbPath}.migrated-${timestamp}`;

        fs.renameSync(this.unencryptedDbPath, migratedPath);

        databaseLogger.success("Database migration completed successfully", {
          operation: "migration_complete",
          migratedTables,
          migratedRows,
          duration: Date.now() - startTime,
          backupPath,
          migratedPath,
          encryptedDbPath: this.encryptedDbPath,
        });

        return {
          success: true,
          migratedTables,
          migratedRows,
          backupPath,
          duration: Date.now() - startTime,
        };
      } finally {
        originalDb.close();
        memoryDb.close();
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      databaseLogger.error("Database migration failed", error, {
        operation: "migration_failed",
        migratedTables,
        migratedRows,
        duration: Date.now() - startTime,
        backupPath,
      });

      return {
        success: false,
        error: errorMessage,
        migratedTables,
        migratedRows,
        backupPath,
        duration: Date.now() - startTime,
      };
    }
  }

  cleanupOldBackups(): void {
    try {
      const backupPattern =
        /\.migration-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;
      const migratedPattern =
        /\.migrated-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

      const files = fs.readdirSync(this.dataDir);

      const backupFiles = files
        .filter((f) => backupPattern.test(f))
        .map((f) => ({
          name: f,
          path: path.join(this.dataDir, f),
          mtime: fs.statSync(path.join(this.dataDir, f)).mtime,
        }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      const migratedFiles = files
        .filter((f) => migratedPattern.test(f))
        .map((f) => ({
          name: f,
          path: path.join(this.dataDir, f),
          mtime: fs.statSync(path.join(this.dataDir, f)).mtime,
        }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      const backupsToDelete = backupFiles.slice(3);
      const migratedToDelete = migratedFiles.slice(3);

      for (const file of [...backupsToDelete, ...migratedToDelete]) {
        try {
          fs.unlinkSync(file.path);
        } catch (error) {
          databaseLogger.warn("Failed to cleanup old migration file", {
            operation: "migration_cleanup_failed",
            file: file.name,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
    } catch (error) {
      databaseLogger.warn("Migration cleanup failed", {
        operation: "migration_cleanup_error",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
}
