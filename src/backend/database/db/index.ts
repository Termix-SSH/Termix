import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema.js";
import fs from "fs";
import path from "path";
import { databaseLogger } from "../../utils/logger.js";
import { DatabaseFileEncryption } from "../../utils/database-file-encryption.js";
import { SystemCrypto } from "../../utils/system-crypto.js";
import { DatabaseMigration } from "../../utils/database-migration.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";

const dataDir = process.env.DATA_DIR || "./db/data";
const dbDir = path.resolve(dataDir);
if (!fs.existsSync(dbDir)) {
  databaseLogger.info(`Creating database directory`, {
    operation: "db_init",
    path: dbDir,
  });
  fs.mkdirSync(dbDir, { recursive: true });
}

// Database file encryption configuration
const enableFileEncryption = process.env.DB_FILE_ENCRYPTION !== "false";
const dbPath = path.join(dataDir, "db.sqlite");
const encryptedDbPath = `${dbPath}.encrypted`;

// Initialize database with file encryption support
let actualDbPath = ":memory:"; // Always use memory database
let memoryDatabase: Database.Database;
let isNewDatabase = false;
let sqlite: Database.Database; // Module-level sqlite instance

// Async initialization function to handle SystemCrypto and DatabaseFileEncryption
async function initializeDatabaseAsync(): Promise<void> {
  // Initialize SystemCrypto database key first
  databaseLogger.info("Initializing SystemCrypto database key...", {
    operation: "db_init_systemcrypto",
    envKeyAvailable: !!process.env.DATABASE_KEY,
    envKeyLength: process.env.DATABASE_KEY?.length || 0,
  });

  const systemCrypto = SystemCrypto.getInstance();
  await systemCrypto.initializeDatabaseKey();

  // Verify key is available after initialization
  const dbKey = await systemCrypto.getDatabaseKey();
  databaseLogger.info("SystemCrypto database key initialized", {
    operation: "db_init_systemcrypto_complete",
    keyLength: dbKey.length,
    keyAvailable: !!dbKey,
  });

  if (enableFileEncryption) {
    try {
      // Check if encrypted database exists
      if (DatabaseFileEncryption.isEncryptedDatabaseFile(encryptedDbPath)) {
        databaseLogger.info(
          "Found encrypted database file, loading into memory...",
          {
            operation: "db_memory_load",
            encryptedPath: encryptedDbPath,
            fileSize: fs.statSync(encryptedDbPath).size,
          },
        );

        // Decrypt database content to memory buffer (now async)
        databaseLogger.info("Starting database decryption...", {
          operation: "db_decrypt_start",
          encryptedPath: encryptedDbPath,
        });

        const decryptedBuffer =
          await DatabaseFileEncryption.decryptDatabaseToBuffer(encryptedDbPath);

        databaseLogger.info("Database decryption successful", {
          operation: "db_decrypt_success",
          decryptedSize: decryptedBuffer.length,
          isSqlite: decryptedBuffer.slice(0, 16).toString().startsWith('SQLite format 3'),
        });

        // Create in-memory database from decrypted buffer
        memoryDatabase = new Database(decryptedBuffer);

        databaseLogger.info("In-memory database created from decrypted buffer", {
          operation: "db_memory_create_success",
        });
      } else {
        // No encrypted database exists - check if we need to migrate
        const migration = new DatabaseMigration(dataDir);
        const migrationStatus = migration.checkMigrationStatus();

        databaseLogger.info("Migration status check completed", {
          operation: "migration_status",
          needsMigration: migrationStatus.needsMigration,
          hasUnencryptedDb: migrationStatus.hasUnencryptedDb,
          hasEncryptedDb: migrationStatus.hasEncryptedDb,
          unencryptedDbSize: migrationStatus.unencryptedDbSize,
          reason: migrationStatus.reason,
        });

        if (migrationStatus.needsMigration) {
          // Perform automatic migration
          databaseLogger.info("Starting automatic database migration", {
            operation: "auto_migration_start",
            unencryptedDbSize: migrationStatus.unencryptedDbSize,
          });

          const migrationResult = await migration.migrateDatabase();

          if (migrationResult.success) {
            databaseLogger.success("Automatic database migration completed successfully", {
              operation: "auto_migration_success",
              migratedTables: migrationResult.migratedTables,
              migratedRows: migrationResult.migratedRows,
              duration: migrationResult.duration,
              backupPath: migrationResult.backupPath,
            });

            // Clean up old backup files
            migration.cleanupOldBackups();

            // Load the newly created encrypted database
            if (DatabaseFileEncryption.isEncryptedDatabaseFile(encryptedDbPath)) {
              databaseLogger.info("Loading migrated encrypted database into memory", {
                operation: "load_migrated_db",
                encryptedPath: encryptedDbPath,
              });

              const decryptedBuffer = await DatabaseFileEncryption.decryptDatabaseToBuffer(encryptedDbPath);
              memoryDatabase = new Database(decryptedBuffer);
              isNewDatabase = false; // We have migrated data

              databaseLogger.success("Migrated encrypted database loaded successfully", {
                operation: "load_migrated_db_success",
                decryptedSize: decryptedBuffer.length,
              });
            } else {
              throw new Error("Migration completed but encrypted database file not found");
            }
          } else {
            // Migration failed - this is critical
            databaseLogger.error("Automatic database migration failed", null, {
              operation: "auto_migration_failed",
              error: migrationResult.error,
              migratedTables: migrationResult.migratedTables,
              migratedRows: migrationResult.migratedRows,
              duration: migrationResult.duration,
              backupPath: migrationResult.backupPath,
            });

            // CRITICAL: Migration failure with existing data
            console.error("DATABASE MIGRATION FAILED - THIS IS CRITICAL!");
            console.error("Migration error:", migrationResult.error);
            console.error("Backup available at:", migrationResult.backupPath);
            console.error("Manual intervention required to recover data.");

            throw new Error(`Database migration failed: ${migrationResult.error}. Backup available at: ${migrationResult.backupPath}`);
          }
        } else {
          // No migration needed - create fresh database
          memoryDatabase = new Database(":memory:");
          isNewDatabase = true;

          databaseLogger.info("Creating fresh in-memory database", {
            operation: "fresh_db_create",
            reason: migrationStatus.reason,
          });
        }
      }
    } catch (error) {
      databaseLogger.error("Failed to initialize memory database", error, {
        operation: "db_memory_init_failed",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
        errorStack: error instanceof Error ? error.stack : undefined,
        encryptedDbExists: DatabaseFileEncryption.isEncryptedDatabaseFile(encryptedDbPath),
        databaseKeyAvailable: !!process.env.DATABASE_KEY,
        databaseKeyLength: process.env.DATABASE_KEY?.length || 0,
      });

      // CRITICAL: Never silently ignore database decryption failures!
      // This causes complete data loss for users
      console.error("DATABASE DECRYPTION FAILED - THIS IS CRITICAL!");
      console.error("Error details:", error instanceof Error ? error.message : error);
      console.error("Encrypted file exists:", DatabaseFileEncryption.isEncryptedDatabaseFile(encryptedDbPath));
      console.error("DATABASE_KEY available:", !!process.env.DATABASE_KEY);

      // Always fail fast on decryption errors - data integrity is critical
      throw new Error(`Database decryption failed: ${error instanceof Error ? error.message : "Unknown error"}. This prevents data loss.`);
    }
  } else {
    memoryDatabase = new Database(":memory:");
    isNewDatabase = true;
  }
}

// Main async initialization function that combines database setup with schema creation
async function initializeCompleteDatabase(): Promise<void> {
  // First initialize the database and SystemCrypto
  await initializeDatabaseAsync();

  databaseLogger.info(`Initializing SQLite database`, {
    operation: "db_init",
    path: actualDbPath,
    encrypted:
      enableFileEncryption &&
      DatabaseFileEncryption.isEncryptedDatabaseFile(encryptedDbPath),
    inMemory: true,
    isNewDatabase,
  });

  // Create module-level sqlite instance after database is initialized
  sqlite = memoryDatabase;

  // Initialize drizzle ORM with the configured database
  db = drizzle(sqlite, { schema });

  databaseLogger.info("Database ORM initialized", {
    operation: "drizzle_init",
    tablesConfigured: Object.keys(schema).length
  });

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        is_oidc INTEGER NOT NULL DEFAULT 0,
        client_id TEXT NOT NULL,
        client_secret TEXT NOT NULL,
        issuer_url TEXT NOT NULL,
        authorization_url TEXT NOT NULL,
        token_url TEXT NOT NULL,
        redirect_uri TEXT,
        identifier_path TEXT NOT NULL,
        name_path TEXT NOT NULL,
        scopes TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ssh_data (
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
        key TEXT,
        key_password TEXT,
        key_type TEXT,
        enable_terminal INTEGER NOT NULL DEFAULT 1,
        enable_tunnel INTEGER NOT NULL DEFAULT 1,
        tunnel_connections TEXT,
        enable_file_manager INTEGER NOT NULL DEFAULT 1,
        default_path TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
    );

    CREATE TABLE IF NOT EXISTS file_manager_recent (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        host_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        last_opened TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (host_id) REFERENCES ssh_data (id)
    );

    CREATE TABLE IF NOT EXISTS file_manager_pinned (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        host_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        pinned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (host_id) REFERENCES ssh_data (id)
    );

    CREATE TABLE IF NOT EXISTS file_manager_shortcuts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        host_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (host_id) REFERENCES ssh_data (id)
    );

    CREATE TABLE IF NOT EXISTS dismissed_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        alert_id TEXT NOT NULL,
        dismissed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
    );

    CREATE TABLE IF NOT EXISTS ssh_credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        folder TEXT,
        tags TEXT,
        auth_type TEXT NOT NULL,
        username TEXT NOT NULL,
        password TEXT,
        key TEXT,
        key_password TEXT,
        key_type TEXT,
        usage_count INTEGER NOT NULL DEFAULT 0,
        last_used TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
    );

    CREATE TABLE IF NOT EXISTS ssh_credential_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        credential_id INTEGER NOT NULL,
        host_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (credential_id) REFERENCES ssh_credentials (id),
        FOREIGN KEY (host_id) REFERENCES ssh_data (id),
        FOREIGN KEY (user_id) REFERENCES users (id)
    );

`);

  // Run schema migrations
  migrateSchema();

  // Initialize default settings
  try {
    const row = sqlite
      .prepare("SELECT value FROM settings WHERE key = 'allow_registration'")
      .get();
    if (!row) {
      databaseLogger.info("Initializing default settings", {
        operation: "db_init",
        setting: "allow_registration",
      });
      sqlite
        .prepare(
          "INSERT INTO settings (key, value) VALUES ('allow_registration', 'true')",
        )
        .run();
    }
  } catch (e) {
    databaseLogger.warn("Could not initialize default settings", {
      operation: "db_init",
      error: e,
    });
  }
}

const addColumnIfNotExists = (
  table: string,
  column: string,
  definition: string,
) => {
  try {
    sqlite
      .prepare(
        `SELECT ${column}
                        FROM ${table} LIMIT 1`,
      )
      .get();
  } catch (e) {
    try {
      sqlite.exec(`ALTER TABLE ${table}
                ADD COLUMN ${column} ${definition};`);
      databaseLogger.success(`Column ${column} added to ${table}`, {
        operation: "schema_migration",
        table,
        column,
      });
    } catch (alterError) {
      databaseLogger.warn(`Failed to add column ${column} to ${table}`, {
        operation: "schema_migration",
        table,
        column,
        error: alterError,
      });
    }
  }
};

const migrateSchema = () => {
  databaseLogger.info("Checking for schema updates...", {
    operation: "schema_migration",
  });

  addColumnIfNotExists("users", "is_admin", "INTEGER NOT NULL DEFAULT 0");

  addColumnIfNotExists("users", "is_oidc", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfNotExists("users", "oidc_identifier", "TEXT");
  addColumnIfNotExists("users", "client_id", "TEXT");
  addColumnIfNotExists("users", "client_secret", "TEXT");
  addColumnIfNotExists("users", "issuer_url", "TEXT");
  addColumnIfNotExists("users", "authorization_url", "TEXT");
  addColumnIfNotExists("users", "token_url", "TEXT");

  addColumnIfNotExists("users", "identifier_path", "TEXT");
  addColumnIfNotExists("users", "name_path", "TEXT");
  addColumnIfNotExists("users", "scopes", "TEXT");

  addColumnIfNotExists("users", "totp_secret", "TEXT");
  addColumnIfNotExists("users", "totp_enabled", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfNotExists("users", "totp_backup_codes", "TEXT");

  // Password recovery fields (UX compromise - breaks zero-trust for usability)
  addColumnIfNotExists("users", "recovery_dek", "TEXT");
  addColumnIfNotExists("users", "backup_encrypted_dek", "TEXT");
  addColumnIfNotExists("users", "zero_trust_mode", "INTEGER NOT NULL DEFAULT 0");

  addColumnIfNotExists("ssh_data", "name", "TEXT");
  addColumnIfNotExists("ssh_data", "folder", "TEXT");
  addColumnIfNotExists("ssh_data", "tags", "TEXT");
  addColumnIfNotExists("ssh_data", "pin", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfNotExists(
    "ssh_data",
    "auth_type",
    'TEXT NOT NULL DEFAULT "password"',
  );
  addColumnIfNotExists("ssh_data", "password", "TEXT");
  addColumnIfNotExists("ssh_data", "key", "TEXT");
  addColumnIfNotExists("ssh_data", "key_password", "TEXT");
  addColumnIfNotExists("ssh_data", "key_type", "TEXT");
  addColumnIfNotExists(
    "ssh_data",
    "enable_terminal",
    "INTEGER NOT NULL DEFAULT 1",
  );
  addColumnIfNotExists(
    "ssh_data",
    "enable_tunnel",
    "INTEGER NOT NULL DEFAULT 1",
  );
  addColumnIfNotExists("ssh_data", "tunnel_connections", "TEXT");
  addColumnIfNotExists(
    "ssh_data",
    "enable_file_manager",
    "INTEGER NOT NULL DEFAULT 1",
  );
  addColumnIfNotExists("ssh_data", "default_path", "TEXT");
  addColumnIfNotExists(
    "ssh_data",
    "created_at",
    "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
  );
  addColumnIfNotExists(
    "ssh_data",
    "updated_at",
    "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
  );

  addColumnIfNotExists(
    "ssh_data",
    "credential_id",
    "INTEGER REFERENCES ssh_credentials(id)",
  );

  // AutoStart plaintext columns
  addColumnIfNotExists("ssh_data", "autostart_password", "TEXT");
  addColumnIfNotExists("ssh_data", "autostart_key", "TEXT");
  addColumnIfNotExists("ssh_data", "autostart_key_password", "TEXT");


  // SSH credentials table migrations for encryption support
  addColumnIfNotExists("ssh_credentials", "private_key", "TEXT");
  addColumnIfNotExists("ssh_credentials", "public_key", "TEXT");
  addColumnIfNotExists("ssh_credentials", "detected_key_type", "TEXT");

  addColumnIfNotExists("file_manager_recent", "host_id", "INTEGER NOT NULL");
  addColumnIfNotExists("file_manager_pinned", "host_id", "INTEGER NOT NULL");
  addColumnIfNotExists("file_manager_shortcuts", "host_id", "INTEGER NOT NULL");

  databaseLogger.success("Schema migration completed", {
    operation: "schema_migration",
  });
};

// Function to save in-memory database to file (encrypted or unencrypted fallback)
async function saveMemoryDatabaseToFile() {
  if (!memoryDatabase) return;

  try {
    // Export in-memory database to buffer
    const buffer = memoryDatabase.serialize();

    // Ensure data directory exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
      databaseLogger.info("Created data directory", {
        operation: "data_dir_create",
        path: dataDir,
      });
    }

    if (enableFileEncryption) {
      // Save as encrypted file
      await DatabaseFileEncryption.encryptDatabaseFromBuffer(buffer, encryptedDbPath);
    } else {
      // Fallback: save as unencrypted SQLite file to prevent data loss
      fs.writeFileSync(dbPath, buffer);
    }
  } catch (error) {
    databaseLogger.error("Failed to save in-memory database", error, {
      operation: "memory_db_save_failed",
      enableFileEncryption,
    });
  }
}

// Function to handle post-initialization file encryption and periodic saves
async function handlePostInitFileEncryption() {
  if (!enableFileEncryption) return;

  try {
    // Check for any remaining unencrypted database files that may need attention
    if (fs.existsSync(dbPath)) {
      // This could happen if migration was skipped or if there are multiple database files
      databaseLogger.warn(
        "Unencrypted database file still exists after initialization",
        {
          operation: "db_security_check",
          path: dbPath,
          note: "This may be normal if migration was skipped for safety reasons",
        },
      );

      // Don't automatically delete - let migration logic handle this
      // This provides better safety and transparency
    }

    // Always save the in-memory database (whether new or existing)
    if (memoryDatabase) {
      // Save immediately after initialization
      await saveMemoryDatabaseToFile();

      databaseLogger.info("Setting up periodic database saves", {
        operation: "db_periodic_save_setup",
        interval: "15 seconds",
      });

      // Set up periodic saves every 15 seconds for real-time persistence
      setInterval(saveMemoryDatabaseToFile, 15 * 1000);

      // Initialize database save trigger for real-time saves
      DatabaseSaveTrigger.initialize(saveMemoryDatabaseToFile);
    }

    // Perform migration cleanup on startup (remove old backup files)
    try {
      const migration = new DatabaseMigration(dataDir);
      migration.cleanupOldBackups();
    } catch (cleanupError) {
      databaseLogger.warn("Failed to cleanup old migration files", {
        operation: "migration_cleanup_startup_failed",
        error: cleanupError instanceof Error ? cleanupError.message : "Unknown error",
      });
    }

  } catch (error) {
    databaseLogger.error(
      "Failed to handle database file encryption setup",
      error,
      {
        operation: "db_encrypt_setup_failed",
      },
    );

    // Don't fail the entire initialization for this
  }
}

// Export a promise that resolves when database is fully initialized
export const databaseReady = initializeCompleteDatabase()
  .then(async () => {
    await handlePostInitFileEncryption();

    databaseLogger.success("Database connection established", {
      operation: "db_init",
      path: actualDbPath,
      hasEncryptedBackup:
        enableFileEncryption &&
        DatabaseFileEncryption.isEncryptedDatabaseFile(encryptedDbPath),
    });
  })
  .catch((error) => {
    databaseLogger.error("Failed to initialize database", error, {
      operation: "db_init",
    });
    process.exit(1);
  });

// Cleanup function for database and temporary files
async function cleanupDatabase() {
  // Save in-memory database before closing
  if (memoryDatabase) {
    try {
      await saveMemoryDatabaseToFile();
    } catch (error) {
      databaseLogger.error(
        "Failed to save in-memory database before shutdown",
        error,
        {
          operation: "shutdown_save_failed",
        },
      );
    }
  }

  // Close database connection
  try {
    if (sqlite) {
      sqlite.close();
    }
  } catch (error) {
    databaseLogger.warn("Error closing database connection", {
      operation: "db_close_error",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }

  // Clean up temp directory
  try {
    const tempDir = path.join(dataDir, ".temp");
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        try {
          fs.unlinkSync(path.join(tempDir, file));
        } catch {
          // Ignore individual file cleanup errors
        }
      }

      try {
        fs.rmdirSync(tempDir);
      } catch {
        // Ignore directory removal errors
      }
    }
  } catch (error) {
    // Ignore temp directory cleanup errors
  }
}

// Register cleanup handlers
process.on("exit", () => {
  // Synchronous cleanup only for exit event
  if (sqlite) {
    try {
      sqlite.close();
    } catch {}
  }
});

process.on("SIGINT", async () => {
  databaseLogger.info("Received SIGINT, cleaning up...", {
    operation: "shutdown",
  });
  await cleanupDatabase();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  databaseLogger.info("Received SIGTERM, cleaning up...", {
    operation: "shutdown",
  });
  await cleanupDatabase();
  process.exit(0);
});

// Database connection - will be initialized after database setup
let db: ReturnType<typeof drizzle<typeof schema>>;

// Export database connection getter function to avoid undefined access
export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (!db) {
    throw new Error("Database not initialized. Ensure databaseReady promise is awaited before accessing db.");
  }
  return db;
}

// Export raw SQLite instance for migrations
export function getSqlite(): Database.Database {
  if (!sqlite) {
    throw new Error("SQLite not initialized. Ensure databaseReady promise is awaited before accessing sqlite.");
  }
  return sqlite;
}

// Legacy export for compatibility - will throw if accessed before initialization
export { db };
export { DatabaseFileEncryption };
export const databasePaths = {
  main: actualDbPath,
  encrypted: encryptedDbPath,
  directory: dbDir,
  inMemory: true,
};

// Memory database buffer function
function getMemoryDatabaseBuffer(): Buffer {
  if (!memoryDatabase) {
    throw new Error("Memory database not initialized");
  }

  try {
    // Export in-memory database to buffer
    const buffer = memoryDatabase.serialize();
    return buffer;
  } catch (error) {
    databaseLogger.error(
      "Failed to serialize memory database to buffer",
      error,
      {
        operation: "memory_db_serialize_failed",
      },
    );
    throw error;
  }
}

// Export save function for manual saves and buffer access
export { saveMemoryDatabaseToFile, getMemoryDatabaseBuffer };

// Export database save trigger for real-time saves
export { DatabaseSaveTrigger };
