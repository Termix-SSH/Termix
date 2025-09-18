import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema.js";
import fs from "fs";
import path from "path";
import { databaseLogger } from "../../utils/logger.js";
import { DatabaseFileEncryption } from "../../utils/database-file-encryption.js";

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

if (enableFileEncryption) {
  try {
    // Check if encrypted database exists
    if (DatabaseFileEncryption.isEncryptedDatabaseFile(encryptedDbPath)) {
      databaseLogger.info(
        "Found encrypted database file, loading into memory...",
        {
          operation: "db_memory_load",
          encryptedPath: encryptedDbPath,
        },
      );

      // Validate hardware compatibility
      if (
        !DatabaseFileEncryption.validateHardwareCompatibility(encryptedDbPath)
      ) {
        databaseLogger.error(
          "Hardware fingerprint mismatch for encrypted database",
          {
            operation: "db_decrypt_failed",
            reason: "hardware_mismatch",
          },
        );
        throw new Error(
          "Cannot decrypt database: hardware fingerprint mismatch",
        );
      }

      // Decrypt database content to memory buffer
      const decryptedBuffer =
        DatabaseFileEncryption.decryptDatabaseToBuffer(encryptedDbPath);

      // Create in-memory database from decrypted buffer
      memoryDatabase = new Database(decryptedBuffer);
    } else {
      memoryDatabase = new Database(":memory:");
      isNewDatabase = true;

      // Check if there's an old unencrypted database to migrate
      if (fs.existsSync(dbPath)) {
        // Load old database and copy its content to memory database
        const oldDb = new Database(dbPath, { readonly: true });

        // Get all table schemas and data from old database
        const tables = oldDb
          .prepare(
            `
          SELECT name, sql FROM sqlite_master
          WHERE type='table' AND name NOT LIKE 'sqlite_%'
        `,
          )
          .all() as { name: string; sql: string }[];

        // Create tables in memory database
        for (const table of tables) {
          memoryDatabase.exec(table.sql);
        }

        // Copy data for each table
        for (const table of tables) {
          const rows = oldDb.prepare(`SELECT * FROM ${table.name}`).all();
          if (rows.length > 0) {
            const columns = Object.keys(rows[0]);
            const placeholders = columns.map(() => "?").join(", ");
            const insertStmt = memoryDatabase.prepare(
              `INSERT INTO ${table.name} (${columns.join(", ")}) VALUES (${placeholders})`,
            );

            for (const row of rows) {
              const values = columns.map((col) => (row as any)[col]);
              insertStmt.run(values);
            }
          }
        }

        oldDb.close();

        isNewDatabase = false;
      } else {
      }
    }
  } catch (error) {
    databaseLogger.error("Failed to initialize memory database", error, {
      operation: "db_memory_init_failed",
    });

    // If file encryption is critical, fail fast
    if (process.env.DB_FILE_ENCRYPTION_REQUIRED === "true") {
      throw error;
    }

    memoryDatabase = new Database(":memory:");
    isNewDatabase = true;
  }
} else {
  memoryDatabase = new Database(":memory:");
  isNewDatabase = true;
}

databaseLogger.info(`Initializing SQLite database`, {
  operation: "db_init",
  path: actualDbPath,
  encrypted:
    enableFileEncryption &&
    DatabaseFileEncryption.isEncryptedDatabaseFile(encryptedDbPath),
  inMemory: true,
  isNewDatabase,
});

const sqlite = memoryDatabase;

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
      databaseLogger.debug(`Adding column ${column} to ${table}`, {
        operation: "schema_migration",
        table,
        column,
      });
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

const initializeDatabase = async (): Promise<void> => {
  migrateSchema();

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
    } else {
    }
  } catch (e) {
    databaseLogger.warn("Could not initialize default settings", {
      operation: "db_init",
      error: e,
    });
  }
};

// Function to save in-memory database to encrypted file
async function saveMemoryDatabaseToFile() {
  if (!memoryDatabase || !enableFileEncryption) return;

  try {
    // Export in-memory database to buffer
    const buffer = memoryDatabase.serialize();

    // Encrypt and save to file
    DatabaseFileEncryption.encryptDatabaseFromBuffer(buffer, encryptedDbPath);

    databaseLogger.debug("In-memory database saved to encrypted file", {
      operation: "memory_db_save",
      bufferSize: buffer.length,
      encryptedPath: encryptedDbPath,
    });
  } catch (error) {
    databaseLogger.error("Failed to save in-memory database", error, {
      operation: "memory_db_save_failed",
    });
  }
}

// Function to handle post-initialization file encryption and cleanup
async function handlePostInitFileEncryption() {
  if (!enableFileEncryption) return;

  try {
    // Clean up any existing unencrypted database files
    if (fs.existsSync(dbPath)) {
      databaseLogger.warn(
        "Found unencrypted database file, removing for security",
        {
          operation: "db_security_cleanup_existing",
          removingPath: dbPath,
        },
      );

      try {
        fs.unlinkSync(dbPath);
        databaseLogger.success(
          "Unencrypted database file removed for security",
          {
            operation: "db_security_cleanup_complete",
            removedPath: dbPath,
          },
        );
      } catch (error) {
        databaseLogger.warn(
          "Could not remove unencrypted database file (may be locked)",
          {
            operation: "db_security_cleanup_deferred",
            path: dbPath,
            error: error instanceof Error ? error.message : "Unknown error",
          },
        );

        // Try again after a short delay
        setTimeout(() => {
          try {
            if (fs.existsSync(dbPath)) {
              fs.unlinkSync(dbPath);
              databaseLogger.success(
                "Delayed cleanup: unencrypted database file removed",
                {
                  operation: "db_security_cleanup_delayed_success",
                  removedPath: dbPath,
                },
              );
            }
          } catch (delayedError) {
            databaseLogger.error(
              "Failed to remove unencrypted database file even after delay",
              delayedError,
              {
                operation: "db_security_cleanup_delayed_failed",
                path: dbPath,
              },
            );
          }
        }, 2000);
      }
    }

    // Always save the in-memory database (whether new or existing)
    if (memoryDatabase) {
      // Save immediately after initialization
      await saveMemoryDatabaseToFile();

      // Set up periodic saves every 5 minutes
      setInterval(saveMemoryDatabaseToFile, 5 * 60 * 1000);
    }
  } catch (error) {
    databaseLogger.error(
      "Failed to handle database file encryption/cleanup",
      error,
      {
        operation: "db_encrypt_cleanup_failed",
      },
    );

    // Don't fail the entire initialization for this
  }
}

initializeDatabase()
  .then(() => handlePostInitFileEncryption())
  .catch((error) => {
    databaseLogger.error("Failed to initialize database", error, {
      operation: "db_init",
    });
    process.exit(1);
  });

databaseLogger.success("Database connection established", {
  operation: "db_init",
  path: actualDbPath,
  hasEncryptedBackup:
    enableFileEncryption &&
    DatabaseFileEncryption.isEncryptedDatabaseFile(encryptedDbPath),
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
      databaseLogger.debug("Database connection closed", {
        operation: "db_close",
      });
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
        databaseLogger.debug("Temp directory cleaned up", {
          operation: "temp_dir_cleanup",
        });
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

// Export database connection and file encryption utilities
export const db = drizzle(sqlite, { schema });
export const sqliteInstance = sqlite; // Export underlying SQLite instance for schema queries
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

    databaseLogger.debug("Memory database serialized to buffer", {
      operation: "memory_db_serialize",
      bufferSize: buffer.length,
    });

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
