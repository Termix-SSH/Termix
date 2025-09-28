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

const enableFileEncryption = process.env.DB_FILE_ENCRYPTION !== "false";
const dbPath = path.join(dataDir, "db.sqlite");
const encryptedDbPath = `${dbPath}.encrypted`;

let actualDbPath = ":memory:";
let memoryDatabase: Database.Database;
let isNewDatabase = false;
let sqlite: Database.Database;

async function initializeDatabaseAsync(): Promise<void> {
  const systemCrypto = SystemCrypto.getInstance();

  const dbKey = await systemCrypto.getDatabaseKey();
  if (enableFileEncryption) {
    try {
      if (DatabaseFileEncryption.isEncryptedDatabaseFile(encryptedDbPath)) {
        const decryptedBuffer =
          await DatabaseFileEncryption.decryptDatabaseToBuffer(encryptedDbPath);

        memoryDatabase = new Database(decryptedBuffer);
      } else {
        const migration = new DatabaseMigration(dataDir);
        const migrationStatus = migration.checkMigrationStatus();

        if (migrationStatus.needsMigration) {
          const migrationResult = await migration.migrateDatabase();

          if (migrationResult.success) {
            migration.cleanupOldBackups();

            if (
              DatabaseFileEncryption.isEncryptedDatabaseFile(encryptedDbPath)
            ) {
              const decryptedBuffer =
                await DatabaseFileEncryption.decryptDatabaseToBuffer(
                  encryptedDbPath,
                );
              memoryDatabase = new Database(decryptedBuffer);
              isNewDatabase = false;
            } else {
              throw new Error(
                "Migration completed but encrypted database file not found",
              );
            }
          } else {
            databaseLogger.error("Automatic database migration failed", null, {
              operation: "auto_migration_failed",
              error: migrationResult.error,
              migratedTables: migrationResult.migratedTables,
              migratedRows: migrationResult.migratedRows,
              duration: migrationResult.duration,
              backupPath: migrationResult.backupPath,
            });
            throw new Error(
              `Database migration failed: ${migrationResult.error}. Backup available at: ${migrationResult.backupPath}`,
            );
          }
        } else {
          memoryDatabase = new Database(":memory:");
          isNewDatabase = true;
        }
      }
    } catch (error) {
      databaseLogger.error("Failed to initialize memory database", error, {
        operation: "db_memory_init_failed",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
        errorStack: error instanceof Error ? error.stack : undefined,
        encryptedDbExists:
          DatabaseFileEncryption.isEncryptedDatabaseFile(encryptedDbPath),
        databaseKeyAvailable: !!process.env.DATABASE_KEY,
        databaseKeyLength: process.env.DATABASE_KEY?.length || 0,
      });

      throw new Error(
        `Database decryption failed: ${error instanceof Error ? error.message : "Unknown error"}. This prevents data loss.`,
      );
    }
  } else {
    memoryDatabase = new Database(":memory:");
    isNewDatabase = true;
  }
}

async function initializeCompleteDatabase(): Promise<void> {
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

  sqlite = memoryDatabase;

  db = drizzle(sqlite, { schema });

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        is_oidc INTEGER NOT NULL DEFAULT 0,
        oidc_identifier TEXT,
        client_id TEXT,
        client_secret TEXT,
        issuer_url TEXT,
        authorization_url TEXT,
        token_url TEXT,
        identifier_path TEXT,
        name_path TEXT,
        scopes TEXT DEFAULT 'openid email profile',
        totp_secret TEXT,
        totp_enabled INTEGER NOT NULL DEFAULT 0,
        totp_backup_codes TEXT
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

  migrateSchema();

  try {
    const row = sqlite
      .prepare("SELECT value FROM settings WHERE key = 'allow_registration'")
      .get();
    if (!row) {
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

  addColumnIfNotExists("ssh_data", "autostart_password", "TEXT");
  addColumnIfNotExists("ssh_data", "autostart_key", "TEXT");
  addColumnIfNotExists("ssh_data", "autostart_key_password", "TEXT");

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

async function saveMemoryDatabaseToFile() {
  if (!memoryDatabase) return;

  try {
    const buffer = memoryDatabase.serialize();

    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    if (enableFileEncryption) {
      await DatabaseFileEncryption.encryptDatabaseFromBuffer(
        buffer,
        encryptedDbPath,
      );
    } else {
      fs.writeFileSync(dbPath, buffer);
    }
  } catch (error) {
    databaseLogger.error("Failed to save in-memory database", error, {
      operation: "memory_db_save_failed",
      enableFileEncryption,
    });
  }
}

async function handlePostInitFileEncryption() {
  if (!enableFileEncryption) return;

  try {
    if (memoryDatabase) {
      await saveMemoryDatabaseToFile();

      setInterval(saveMemoryDatabaseToFile, 15 * 1000);

      DatabaseSaveTrigger.initialize(saveMemoryDatabaseToFile);
    }

    try {
      const migration = new DatabaseMigration(dataDir);
      migration.cleanupOldBackups();
    } catch (cleanupError) {
      databaseLogger.warn("Failed to cleanup old migration files", {
        operation: "migration_cleanup_startup_failed",
        error:
          cleanupError instanceof Error
            ? cleanupError.message
            : "Unknown error",
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
  }
}

async function initializeDatabase(): Promise<void> {
  await initializeCompleteDatabase();
  await handlePostInitFileEncryption();
}

export { initializeDatabase };

async function cleanupDatabase() {
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

  try {
    const tempDir = path.join(dataDir, ".temp");
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        try {
          fs.unlinkSync(path.join(tempDir, file));
        } catch {}
      }

      try {
        fs.rmdirSync(tempDir);
      } catch {}
    }
  } catch (error) {}
}

process.on("exit", () => {
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

let db: ReturnType<typeof drizzle<typeof schema>>;

export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (!db) {
    throw new Error(
      "Database not initialized. Ensure initializeDatabase() is called before accessing db.",
    );
  }
  return db;
}

export function getSqlite(): Database.Database {
  if (!sqlite) {
    throw new Error(
      "SQLite not initialized. Ensure initializeDatabase() is called before accessing sqlite.",
    );
  }
  return sqlite;
}

export { db };
export { DatabaseFileEncryption };
export const databasePaths = {
  main: actualDbPath,
  encrypted: encryptedDbPath,
  directory: dbDir,
  inMemory: true,
};

export { saveMemoryDatabaseToFile };

export { DatabaseSaveTrigger };
