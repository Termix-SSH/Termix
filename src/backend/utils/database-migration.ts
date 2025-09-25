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

  /**
   * 检查是否需要迁移以及迁移状态
   */
  checkMigrationStatus(): MigrationStatus {
    const hasUnencryptedDb = fs.existsSync(this.unencryptedDbPath);
    const hasEncryptedDb = DatabaseFileEncryption.isEncryptedDatabaseFile(this.encryptedDbPath);

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

    // 确定迁移状态
    let needsMigration = false;
    let reason = "";

    if (hasEncryptedDb && hasUnencryptedDb) {
      // 两个都存在：可能是之前迁移失败或中断
      needsMigration = false;
      reason = "Both encrypted and unencrypted databases exist. Skipping migration for safety. Manual intervention may be required.";
    } else if (hasEncryptedDb && !hasUnencryptedDb) {
      // 只有加密数据库：无需迁移
      needsMigration = false;
      reason = "Only encrypted database exists. No migration needed.";
    } else if (!hasEncryptedDb && hasUnencryptedDb) {
      // 只有未加密数据库：需要迁移
      needsMigration = true;
      reason = "Unencrypted database found. Migration to encrypted format required.";
    } else {
      // 都不存在：全新安装
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

  /**
   * 创建未加密数据库的安全备份
   */
  private createBackup(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${this.unencryptedDbPath}.migration-backup-${timestamp}`;

    try {
      databaseLogger.info("Creating migration backup", {
        operation: "migration_backup_create",
        source: this.unencryptedDbPath,
        backup: backupPath,
      });

      fs.copyFileSync(this.unencryptedDbPath, backupPath);

      // 验证备份完整性
      const originalSize = fs.statSync(this.unencryptedDbPath).size;
      const backupSize = fs.statSync(backupPath).size;

      if (originalSize !== backupSize) {
        throw new Error(`Backup size mismatch: original=${originalSize}, backup=${backupSize}`);
      }

      databaseLogger.success("Migration backup created successfully", {
        operation: "migration_backup_created",
        backupPath,
        fileSize: backupSize,
      });

      return backupPath;
    } catch (error) {
      databaseLogger.error("Failed to create migration backup", error, {
        operation: "migration_backup_failed",
        source: this.unencryptedDbPath,
        backup: backupPath,
      });
      throw new Error(`Backup creation failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * 验证数据库迁移的完整性
   */
  private async verifyMigration(originalDb: Database.Database, memoryDb: Database.Database): Promise<boolean> {
    try {
      databaseLogger.info("Verifying migration integrity", {
        operation: "migration_verify_start",
      });

      // 临时禁用外键约束以进行验证查询
      memoryDb.exec("PRAGMA foreign_keys = OFF");

      // 获取原数据库的表列表
      const originalTables = originalDb
        .prepare(`
          SELECT name FROM sqlite_master
          WHERE type='table' AND name NOT LIKE 'sqlite_%'
          ORDER BY name
        `)
        .all() as { name: string }[];

      // 获取内存数据库的表列表
      const memoryTables = memoryDb
        .prepare(`
          SELECT name FROM sqlite_master
          WHERE type='table' AND name NOT LIKE 'sqlite_%'
          ORDER BY name
        `)
        .all() as { name: string }[];

      // 检查表数量是否一致
      if (originalTables.length !== memoryTables.length) {
        databaseLogger.error("Table count mismatch during migration verification", null, {
          operation: "migration_verify_failed",
          originalCount: originalTables.length,
          memoryCount: memoryTables.length,
        });
        return false;
      }

      let totalOriginalRows = 0;
      let totalMemoryRows = 0;

      // 逐表验证行数
      for (const table of originalTables) {
        const originalCount = originalDb.prepare(`SELECT COUNT(*) as count FROM ${table.name}`).get() as { count: number };
        const memoryCount = memoryDb.prepare(`SELECT COUNT(*) as count FROM ${table.name}`).get() as { count: number };

        totalOriginalRows += originalCount.count;
        totalMemoryRows += memoryCount.count;

        if (originalCount.count !== memoryCount.count) {
          databaseLogger.error("Row count mismatch for table during migration verification", null, {
            operation: "migration_verify_table_failed",
            table: table.name,
            originalRows: originalCount.count,
            memoryRows: memoryCount.count,
          });
          return false;
        }
      }

      databaseLogger.success("Migration integrity verification completed", {
        operation: "migration_verify_success",
        tables: originalTables.length,
        totalRows: totalOriginalRows,
      });

      // 重新启用外键约束
      memoryDb.exec("PRAGMA foreign_keys = ON");

      return true;
    } catch (error) {
      databaseLogger.error("Migration verification failed", error, {
        operation: "migration_verify_error",
      });
      return false;
    }
  }

  /**
   * 执行数据库迁移
   */
  async migrateDatabase(): Promise<MigrationResult> {
    const startTime = Date.now();
    let backupPath: string | undefined;
    let migratedTables = 0;
    let migratedRows = 0;

    try {
      databaseLogger.info("Starting database migration from unencrypted to encrypted format", {
        operation: "migration_start",
        source: this.unencryptedDbPath,
        target: this.encryptedDbPath,
      });

      // 1. 创建安全备份
      backupPath = this.createBackup();

      // 2. 打开原数据库（只读）
      const originalDb = new Database(this.unencryptedDbPath, { readonly: true });

      // 3. 创建内存数据库
      const memoryDb = new Database(":memory:");

      try {
        // 4. 获取所有表结构
        const tables = originalDb
          .prepare(`
            SELECT name, sql FROM sqlite_master
            WHERE type='table' AND name NOT LIKE 'sqlite_%'
          `)
          .all() as { name: string; sql: string }[];

        databaseLogger.info("Found tables to migrate", {
          operation: "migration_tables_found",
          tableCount: tables.length,
          tables: tables.map(t => t.name),
        });

        // 5. 在内存数据库中创建表结构
        for (const table of tables) {
          memoryDb.exec(table.sql);
          migratedTables++;
        }

        // 6. 禁用外键约束以避免插入顺序问题
        databaseLogger.info("Disabling foreign key constraints for migration", {
          operation: "migration_disable_fk",
        });
        memoryDb.exec("PRAGMA foreign_keys = OFF");

        // 7. 复制每个表的数据
        for (const table of tables) {
          const rows = originalDb.prepare(`SELECT * FROM ${table.name}`).all();

          if (rows.length > 0) {
            const columns = Object.keys(rows[0]);
            const placeholders = columns.map(() => "?").join(", ");
            const insertStmt = memoryDb.prepare(
              `INSERT INTO ${table.name} (${columns.join(", ")}) VALUES (${placeholders})`
            );

            // 使用事务批量插入
            const insertTransaction = memoryDb.transaction((dataRows: any[]) => {
              for (const row of dataRows) {
                const values = columns.map((col) => row[col]);
                insertStmt.run(values);
              }
            });

            insertTransaction(rows);
            migratedRows += rows.length;
          }
        }

        // 8. 重新启用外键约束
        databaseLogger.info("Re-enabling foreign key constraints after migration", {
          operation: "migration_enable_fk",
        });
        memoryDb.exec("PRAGMA foreign_keys = ON");

        // 验证外键约束现在是否正常
        const fkCheckResult = memoryDb.prepare("PRAGMA foreign_key_check").all();
        if (fkCheckResult.length > 0) {
          databaseLogger.error("Foreign key constraints violations detected after migration", null, {
            operation: "migration_fk_check_failed",
            violations: fkCheckResult,
          });
          throw new Error(`Foreign key violations detected: ${JSON.stringify(fkCheckResult)}`);
        }

        databaseLogger.success("Foreign key constraints verification passed", {
          operation: "migration_fk_check_success",
        });

        // 9. 验证迁移完整性
        const verificationPassed = await this.verifyMigration(originalDb, memoryDb);
        if (!verificationPassed) {
          throw new Error("Migration integrity verification failed");
        }

        // 10. 导出内存数据库到缓冲区
        const buffer = memoryDb.serialize();

        // 11. 创建加密数据库文件
        databaseLogger.info("Creating encrypted database file", {
          operation: "migration_encrypt_start",
          bufferSize: buffer.length,
        });

        await DatabaseFileEncryption.encryptDatabaseFromBuffer(buffer, this.encryptedDbPath);

        // 12. 验证加密文件
        if (!DatabaseFileEncryption.isEncryptedDatabaseFile(this.encryptedDbPath)) {
          throw new Error("Encrypted database file verification failed");
        }

        // 13. 清理：重命名原文件而不是删除
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
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
        // 确保数据库连接关闭
        originalDb.close();
        memoryDb.close();
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

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

  /**
   * 清理旧的备份文件（保留最近3个）
   */
  cleanupOldBackups(): void {
    try {
      const backupPattern = /\.migration-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;
      const migratedPattern = /\.migrated-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

      const files = fs.readdirSync(this.dataDir);

      // 查找备份文件和已迁移文件
      const backupFiles = files.filter(f => backupPattern.test(f))
        .map(f => ({
          name: f,
          path: path.join(this.dataDir, f),
          mtime: fs.statSync(path.join(this.dataDir, f)).mtime,
        }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      const migratedFiles = files.filter(f => migratedPattern.test(f))
        .map(f => ({
          name: f,
          path: path.join(this.dataDir, f),
          mtime: fs.statSync(path.join(this.dataDir, f)).mtime,
        }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      // 保留最近3个备份文件
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

      if (backupsToDelete.length > 0 || migratedToDelete.length > 0) {
        databaseLogger.info("Migration cleanup completed", {
          operation: "migration_cleanup_complete",
          deletedBackups: backupsToDelete.length,
          deletedMigrated: migratedToDelete.length,
          remainingBackups: Math.min(backupFiles.length, 3),
          remainingMigrated: Math.min(migratedFiles.length, 3),
        });
      }

    } catch (error) {
      databaseLogger.warn("Migration cleanup failed", {
        operation: "migration_cleanup_error",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
}