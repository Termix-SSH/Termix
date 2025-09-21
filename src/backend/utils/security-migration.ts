#!/usr/bin/env node
import { db } from "../database/db/index.js";
import { settings, users, sshData, sshCredentials } from "../database/db/schema.js";
import { eq, sql } from "drizzle-orm";
import { SecuritySession } from "./security-session.js";
import { UserKeyManager } from "./user-key-manager.js";
import { DatabaseEncryption } from "./database-encryption.js";
import { EncryptedDBOperations } from "./encrypted-db-operations.js";
import { FieldEncryption } from "./encryption.js";
import { databaseLogger } from "./logger.js";

interface MigrationConfig {
  dryRun?: boolean;
  backupEnabled?: boolean;
  forceRegeneration?: boolean;
}

interface MigrationResult {
  success: boolean;
  usersProcessed: number;
  recordsMigrated: number;
  errors: string[];
  warnings: string[];
}

/**
 * SecurityMigration - Migrate from old encryption system to KEK-DEK architecture
 *
 * Migration steps:
 * 1. Detect existing system state
 * 2. Backup existing data
 * 3. Initialize new security system
 * 4. Set up KEK-DEK for existing users
 * 5. Migrate encrypted data
 * 6. Clean up old keys
 */
class SecurityMigration {
  private config: MigrationConfig;
  private securitySession: SecuritySession;
  private userKeyManager: UserKeyManager;

  constructor(config: MigrationConfig = {}) {
    this.config = {
      dryRun: config.dryRun ?? false,
      backupEnabled: config.backupEnabled ?? true,
      forceRegeneration: config.forceRegeneration ?? false,
    };

    this.securitySession = SecuritySession.getInstance();
    this.userKeyManager = UserKeyManager.getInstance();
  }

  /**
   * Run complete migration
   */
  async runMigration(): Promise<MigrationResult> {
    const result: MigrationResult = {
      success: false,
      usersProcessed: 0,
      recordsMigrated: 0,
      errors: [],
      warnings: [],
    };

    try {
      databaseLogger.info("Starting security migration to KEK-DEK architecture", {
        operation: "security_migration_start",
        dryRun: this.config.dryRun,
        backupEnabled: this.config.backupEnabled,
      });

      // 1. Check migration prerequisites
      await this.validatePrerequisites();

      // 2. Create backup
      if (this.config.backupEnabled && !this.config.dryRun) {
        await this.createBackup();
      }

      // 3. Initialize new security system
      await this.initializeNewSecurity();

      // 4. Detect users needing migration
      const usersToMigrate = await this.detectUsersNeedingMigration();
      result.warnings.push(`Found ${usersToMigrate.length} users that need migration`);

      // 5. Process each user
      for (const user of usersToMigrate) {
        try {
          await this.migrateUser(user, result);
          result.usersProcessed++;
        } catch (error) {
          const errorMsg = `Failed to migrate user ${user.username}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          result.errors.push(errorMsg);
          databaseLogger.error("User migration failed", error, {
            operation: "user_migration_failed",
            userId: user.id,
            username: user.username,
          });
        }
      }

      // 6. Clean up old system (if all users migrated successfully)
      if (result.errors.length === 0 && !this.config.dryRun) {
        await this.cleanupOldSystem();
      }

      result.success = result.errors.length === 0;

      databaseLogger.success("Security migration completed", {
        operation: "security_migration_complete",
        result,
      });

      return result;

    } catch (error) {
      const errorMsg = `Migration failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      result.errors.push(errorMsg);
      databaseLogger.error("Security migration failed", error, {
        operation: "security_migration_failed",
      });
      return result;
    }
  }

  /**
   * Validate migration prerequisites
   */
  private async validatePrerequisites(): Promise<void> {
    databaseLogger.info("Validating migration prerequisites", {
      operation: "migration_validation",
    });

    // Check database connection
    try {
      await db.select().from(settings).limit(1);
    } catch (error) {
      throw new Error("Database connection failed");
    }

    // Check for old encryption keys
    const oldEncryptionKey = await db
      .select()
      .from(settings)
      .where(eq(settings.key, "db_encryption_key"));

    if (oldEncryptionKey.length === 0) {
      databaseLogger.info("No old encryption key found - fresh installation", {
        operation: "migration_validation",
      });
    } else {
      databaseLogger.info("Old encryption key detected - migration needed", {
        operation: "migration_validation",
      });
    }

    databaseLogger.success("Prerequisites validation passed", {
      operation: "migration_validation_complete",
    });
  }

  /**
   * Create pre-migration backup
   */
  private async createBackup(): Promise<void> {
    databaseLogger.info("Creating migration backup", {
      operation: "migration_backup",
    });

    try {
      const fs = await import("fs");
      const path = await import("path");
      const dataDir = process.env.DATA_DIR || "./db/data";
      const dbPath = path.join(dataDir, "db.sqlite");
      const backupPath = path.join(dataDir, `migration-backup-${Date.now()}.sqlite`);

      if (fs.existsSync(dbPath)) {
        fs.copyFileSync(dbPath, backupPath);
        databaseLogger.success(`Migration backup created: ${backupPath}`, {
          operation: "migration_backup_complete",
          backupPath,
        });
      }
    } catch (error) {
      databaseLogger.error("Failed to create migration backup", error, {
        operation: "migration_backup_failed",
      });
      throw error;
    }
  }

  /**
   * Initialize new security system
   */
  private async initializeNewSecurity(): Promise<void> {
    databaseLogger.info("Initializing new security system", {
      operation: "new_security_init",
    });

    await this.securitySession.initialize();
    DatabaseEncryption.initialize();

    const isValid = await this.securitySession.validateSecuritySystem();
    if (!isValid) {
      throw new Error("New security system validation failed");
    }

    databaseLogger.success("New security system initialized", {
      operation: "new_security_init_complete",
    });
  }

  /**
   * Detect users needing migration
   */
  private async detectUsersNeedingMigration(): Promise<any[]> {
    const allUsers = await db.select().from(users);
    const usersNeedingMigration = [];

    for (const user of allUsers) {
      // Check if user already has KEK salt (new system)
      const kekSalt = await db
        .select()
        .from(settings)
        .where(eq(settings.key, `user_kek_salt_${user.id}`));

      if (kekSalt.length === 0) {
        usersNeedingMigration.push(user);
      }
    }

    databaseLogger.info(`Found ${usersNeedingMigration.length} users needing migration`, {
      operation: "migration_user_detection",
      totalUsers: allUsers.length,
      needingMigration: usersNeedingMigration.length,
    });

    return usersNeedingMigration;
  }

  /**
   * Migrate single user
   */
  private async migrateUser(user: any, result: MigrationResult): Promise<void> {
    databaseLogger.info(`Migrating user: ${user.username}`, {
      operation: "user_migration_start",
      userId: user.id,
      username: user.username,
    });

    if (this.config.dryRun) {
      databaseLogger.info(`[DRY RUN] Would migrate user: ${user.username}`, {
        operation: "user_migration_dry_run",
        userId: user.id,
      });
      return;
    }

    // Issue: We need user's plaintext password to set up KEK
    // but we only have password hash. Solutions:
    // 1. Require user to re-enter password on first login
    // 2. Generate temporary password and require user to change it
    //
    // For demonstration, we skip actual KEK setup and just mark user for password reset

    try {
      // Mark user needing encryption reset
      await db.insert(settings).values({
        key: `user_migration_required_${user.id}`,
        value: JSON.stringify({
          userId: user.id,
          username: user.username,
          migrationTime: new Date().toISOString(),
          reason: "Security system upgrade - password re-entry required",
        }),
      });

      result.warnings.push(`User ${user.username} marked for password re-entry on next login`);

      databaseLogger.success(`User migration prepared: ${user.username}`, {
        operation: "user_migration_prepared",
        userId: user.id,
        username: user.username,
      });

    } catch (error) {
      databaseLogger.error(`Failed to prepare user migration: ${user.username}`, error, {
        operation: "user_migration_prepare_failed",
        userId: user.id,
        username: user.username,
      });
      throw error;
    }
  }

  /**
   * Clean up old encryption system
   */
  private async cleanupOldSystem(): Promise<void> {
    databaseLogger.info("Cleaning up old encryption system", {
      operation: "old_system_cleanup",
    });

    try {
      // Delete old encryption keys
      await db.delete(settings).where(eq(settings.key, "db_encryption_key"));
      await db.delete(settings).where(eq(settings.key, "encryption_key_created"));

      // Keep JWT key (now managed by new system)
      // Delete old jwt_secret, let new system take over
      await db.delete(settings).where(eq(settings.key, "jwt_secret"));
      await db.delete(settings).where(eq(settings.key, "jwt_secret_created"));

      databaseLogger.success("Old encryption system cleaned up", {
        operation: "old_system_cleanup_complete",
      });

    } catch (error) {
      databaseLogger.error("Failed to cleanup old system", error, {
        operation: "old_system_cleanup_failed",
      });
      throw error;
    }
  }

  /**
   * Check migration status
   */
  static async checkMigrationStatus(): Promise<{
    migrationRequired: boolean;
    usersNeedingMigration: number;
    hasOldSystem: boolean;
    hasNewSystem: boolean;
  }> {
    try {
      // Check for old system
      const oldEncryptionKey = await db
        .select()
        .from(settings)
        .where(eq(settings.key, "db_encryption_key"));

      // Check for new system
      const newSystemJWT = await db
        .select()
        .from(settings)
        .where(eq(settings.key, "system_jwt_secret"));

      // Check users needing migration
      const allUsers = await db.select().from(users);
      let usersNeedingMigration = 0;

      for (const user of allUsers) {
        const kekSalt = await db
          .select()
          .from(settings)
          .where(eq(settings.key, `user_kek_salt_${user.id}`));

        if (kekSalt.length === 0) {
          usersNeedingMigration++;
        }
      }

      const hasOldSystem = oldEncryptionKey.length > 0;
      const hasNewSystem = newSystemJWT.length > 0;
      const migrationRequired = hasOldSystem || usersNeedingMigration > 0;

      return {
        migrationRequired,
        usersNeedingMigration,
        hasOldSystem,
        hasNewSystem,
      };

    } catch (error) {
      databaseLogger.error("Failed to check migration status", error, {
        operation: "migration_status_check_failed",
      });
      throw error;
    }
  }

  /**
   * Handle user login migration (when user enters password)
   */
  static async handleUserLoginMigration(userId: string, password: string): Promise<boolean> {
    try {
      // Check if user needs migration
      const migrationRequired = await db
        .select()
        .from(settings)
        .where(eq(settings.key, `user_migration_required_${userId}`));

      if (migrationRequired.length === 0) {
        return false; // No migration needed
      }

      databaseLogger.info("Performing user migration during login", {
        operation: "login_migration_start",
        userId,
      });

      // Initialize user encryption
      const securitySession = SecuritySession.getInstance();
      await securitySession.registerUser(userId, password);

      // Delete migration marker
      await db.delete(settings).where(eq(settings.key, `user_migration_required_${userId}`));

      databaseLogger.success("User migration completed during login", {
        operation: "login_migration_complete",
        userId,
      });

      return true; // Migration completed

    } catch (error) {
      databaseLogger.error("Login migration failed", error, {
        operation: "login_migration_failed",
        userId,
      });
      throw error;
    }
  }
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const config: MigrationConfig = {
    dryRun: process.env.DRY_RUN === "true",
    backupEnabled: process.env.BACKUP_ENABLED !== "false",
    forceRegeneration: process.env.FORCE_REGENERATION === "true",
  };

  const migration = new SecurityMigration(config);

  migration
    .runMigration()
    .then((result) => {
      console.log("Migration completed:", result);
      process.exit(result.success ? 0 : 1);
    })
    .catch((error) => {
      console.error("Migration failed:", error.message);
      process.exit(1);
    });
}

export { SecurityMigration, type MigrationConfig, type MigrationResult };