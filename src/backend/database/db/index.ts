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
  fs.mkdirSync(dbDir, { recursive: true });
}

const enableFileEncryption = process.env.DB_FILE_ENCRYPTION !== "false";
const dbPath = path.join(dataDir, "db.sqlite");
const encryptedDbPath = `${dbPath}.encrypted`;

const actualDbPath = ":memory:";
let memoryDatabase: Database.Database;
let isNewDatabase = false;
let sqlite: Database.Database;

async function initializeDatabaseAsync(): Promise<void> {
  const systemCrypto = SystemCrypto.getInstance();

  await systemCrypto.getDatabaseKey();
  if (enableFileEncryption) {
    try {
      if (DatabaseFileEncryption.isEncryptedDatabaseFile(encryptedDbPath)) {
        const decryptedBuffer =
          await DatabaseFileEncryption.decryptDatabaseToBuffer(encryptedDbPath);

        memoryDatabase = new Database(decryptedBuffer);

        try {
          const sessionCount = memoryDatabase
            .prepare("SELECT COUNT(*) as count FROM sessions")
            .get() as { count: number };
        } catch (countError) {
        }
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

      try {
        const diagnosticInfo =
          DatabaseFileEncryption.getDiagnosticInfo(encryptedDbPath);
        databaseLogger.error(
          "Database encryption diagnostic completed - check logs above for details",
          null,
          {
            operation: "db_encryption_diagnostic_completed",
            filesConsistent: diagnosticInfo.validation.filesConsistent,
            sizeMismatch: diagnosticInfo.validation.sizeMismatch,
          },
        );
      } catch (diagError) {
        databaseLogger.warn("Failed to generate diagnostic information", {
          operation: "db_diagnostic_failed",
          error:
            diagError instanceof Error ? diagError.message : "Unknown error",
        });
      }

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

  sqlite.exec("PRAGMA foreign_keys = ON");

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

    CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        jwt_token TEXT NOT NULL,
        device_type TEXT NOT NULL,
        device_info TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT NOT NULL,
        last_active_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
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
        enable_docker INTEGER NOT NULL DEFAULT 0,
        default_path TEXT,
        autostart_password TEXT,
        autostart_key TEXT,
        autostart_key_password TEXT,
        force_keyboard_interactive TEXT,
        stats_config TEXT,
        docker_config TEXT,
        terminal_config TEXT,
        notes TEXT,
        use_socks5 INTEGER,
        socks5_host TEXT,
        socks5_port INTEGER,
        socks5_username TEXT,
        socks5_password TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS file_manager_recent (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        host_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        last_opened TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (host_id) REFERENCES ssh_data (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS file_manager_pinned (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        host_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        pinned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (host_id) REFERENCES ssh_data (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS file_manager_shortcuts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        host_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (host_id) REFERENCES ssh_data (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS dismissed_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        alert_id TEXT NOT NULL,
        dismissed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
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
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ssh_credential_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        credential_id INTEGER NOT NULL,
        host_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (credential_id) REFERENCES ssh_credentials (id) ON DELETE CASCADE,
        FOREIGN KEY (host_id) REFERENCES ssh_data (id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS snippets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        content TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ssh_folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        color TEXT,
        icon TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS recent_activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        host_id INTEGER NOT NULL,
        host_name TEXT,
        timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (host_id) REFERENCES ssh_data (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS command_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        host_id INTEGER NOT NULL,
        command TEXT NOT NULL,
        executed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (host_id) REFERENCES ssh_data (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS host_access (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        host_id INTEGER NOT NULL,
        user_id TEXT,
        role_id INTEGER,
        granted_by TEXT NOT NULL,
        permission_level TEXT NOT NULL DEFAULT 'use',
        expires_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_accessed_at TEXT,
        access_count INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (host_id) REFERENCES ssh_data (id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE,
        FOREIGN KEY (granted_by) REFERENCES users (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        description TEXT,
        is_system INTEGER NOT NULL DEFAULT 0,
        permissions TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        role_id INTEGER NOT NULL,
        granted_by TEXT,
        granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, role_id),
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE,
        FOREIGN KEY (granted_by) REFERENCES users (id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT,
        resource_name TEXT,
        details TEXT,
        ip_address TEXT,
        user_agent TEXT,
        success INTEGER NOT NULL,
        error_message TEXT,
        timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS session_recordings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        host_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        access_id INTEGER,
        started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ended_at TEXT,
        duration INTEGER,
        commands TEXT,
        dangerous_actions TEXT,
        recording_path TEXT,
        terminated_by_owner INTEGER DEFAULT 0,
        termination_reason TEXT,
        FOREIGN KEY (host_id) REFERENCES ssh_data (id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (access_id) REFERENCES host_access (id) ON DELETE SET NULL
    );

`);

  try {
    sqlite.prepare("DELETE FROM sessions").run();
  } catch (e) {
    databaseLogger.warn("Could not clear sessions on startup", {
      operation: "db_init_session_cleanup_failed",
      error: e,
    });
  }

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

  try {
    const row = sqlite
      .prepare("SELECT value FROM settings WHERE key = 'allow_password_login'")
      .get();
    if (!row) {
      sqlite
        .prepare(
          "INSERT INTO settings (key, value) VALUES ('allow_password_login', 'true')",
        )
        .run();
    }
  } catch (e) {
    databaseLogger.warn("Could not initialize allow_password_login setting", {
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
        `SELECT "${column}"
                        FROM ${table} LIMIT 1`,
      )
      .get();
  } catch {
    try {
      sqlite.exec(`ALTER TABLE ${table}
                ADD COLUMN "${column}" ${definition};`);
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
  addColumnIfNotExists("ssh_data", "jump_hosts", "TEXT");
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
  addColumnIfNotExists("ssh_data", "force_keyboard_interactive", "TEXT");
  addColumnIfNotExists("ssh_data", "autostart_password", "TEXT");
  addColumnIfNotExists("ssh_data", "autostart_key", "TEXT");
  addColumnIfNotExists("ssh_data", "autostart_key_password", "TEXT");
  addColumnIfNotExists(
    "ssh_data",
    "credential_id",
    "INTEGER REFERENCES ssh_credentials(id) ON DELETE SET NULL",
  );
  addColumnIfNotExists(
    "ssh_data",
    "override_credential_username",
    "INTEGER",
  );

  addColumnIfNotExists("ssh_data", "autostart_password", "TEXT");
  addColumnIfNotExists("ssh_data", "autostart_key", "TEXT");
  addColumnIfNotExists("ssh_data", "autostart_key_password", "TEXT");
  addColumnIfNotExists("ssh_data", "stats_config", "TEXT");
  addColumnIfNotExists("ssh_data", "terminal_config", "TEXT");
  addColumnIfNotExists("ssh_data", "quick_actions", "TEXT");
  addColumnIfNotExists(
    "ssh_data",
    "enable_docker",
    "INTEGER NOT NULL DEFAULT 0",
  );
  addColumnIfNotExists("ssh_data", "docker_config", "TEXT");

  addColumnIfNotExists("ssh_data", "notes", "TEXT");

  addColumnIfNotExists("ssh_data", "use_socks5", "INTEGER");
  addColumnIfNotExists("ssh_data", "socks5_host", "TEXT");
  addColumnIfNotExists("ssh_data", "socks5_port", "INTEGER");
  addColumnIfNotExists("ssh_data", "socks5_username", "TEXT");
  addColumnIfNotExists("ssh_data", "socks5_password", "TEXT");
  addColumnIfNotExists("ssh_data", "socks5_proxy_chain", "TEXT");

  addColumnIfNotExists("ssh_credentials", "private_key", "TEXT");
  addColumnIfNotExists("ssh_credentials", "public_key", "TEXT");
  addColumnIfNotExists("ssh_credentials", "detected_key_type", "TEXT");

  addColumnIfNotExists("ssh_credentials", "system_password", "TEXT");
  addColumnIfNotExists("ssh_credentials", "system_key", "TEXT");
  addColumnIfNotExists("ssh_credentials", "system_key_password", "TEXT");

  addColumnIfNotExists("file_manager_recent", "host_id", "INTEGER NOT NULL");
  addColumnIfNotExists("file_manager_pinned", "host_id", "INTEGER NOT NULL");
  addColumnIfNotExists("file_manager_shortcuts", "host_id", "INTEGER NOT NULL");

  addColumnIfNotExists("snippets", "folder", "TEXT");
  addColumnIfNotExists("snippets", "order", "INTEGER NOT NULL DEFAULT 0");

  try {
    sqlite
      .prepare("SELECT id FROM snippet_folders LIMIT 1")
      .get();
  } catch {
    try {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS snippet_folders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          color TEXT,
          icon TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        );
      `);
    } catch (createError) {
      databaseLogger.warn("Failed to create snippet_folders table", {
        operation: "schema_migration",
        error: createError,
      });
    }
  }

  try {
    sqlite
      .prepare("SELECT id FROM sessions LIMIT 1")
      .get();
  } catch {
    try {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          jwt_token TEXT NOT NULL,
          device_type TEXT NOT NULL,
          device_info TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          expires_at TEXT NOT NULL,
          last_active_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users (id)
        );
      `);
    } catch (createError) {
      databaseLogger.warn("Failed to create sessions table", {
        operation: "schema_migration",
        error: createError,
      });
    }
  }

  try {
    sqlite
      .prepare("SELECT id FROM network_topology LIMIT 1")
      .get();
  } catch {
    try {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS network_topology (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          topology TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        );
      `);
    } catch (createError) {
      databaseLogger.warn("Failed to create network_topology table", {
        operation: "schema_migration",
        error: createError,
      });
    }
  }

  try {
    sqlite.prepare("SELECT id FROM host_access LIMIT 1").get();
  } catch {
    try {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS host_access (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          host_id INTEGER NOT NULL,
          user_id TEXT,
          role_id INTEGER,
          granted_by TEXT NOT NULL,
          permission_level TEXT NOT NULL DEFAULT 'use',
          expires_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_accessed_at TEXT,
          access_count INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY (host_id) REFERENCES ssh_data (id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
          FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE,
          FOREIGN KEY (granted_by) REFERENCES users (id) ON DELETE CASCADE
        );
      `);
    } catch (createError) {
      databaseLogger.warn("Failed to create host_access table", {
        operation: "schema_migration",
        error: createError,
      });
    }
  }

  try {
    sqlite.prepare("SELECT role_id FROM host_access LIMIT 1").get();
  } catch {
    try {
      sqlite.exec("ALTER TABLE host_access ADD COLUMN role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE");
    } catch (alterError) {
      databaseLogger.warn("Failed to add role_id column", {
        operation: "schema_migration",
        error: alterError,
      });
    }
  }

  try {
    sqlite.prepare("SELECT sudo_password FROM ssh_data LIMIT 1").get();
  } catch {
    try {
      sqlite.exec("ALTER TABLE ssh_data ADD COLUMN sudo_password TEXT");
    } catch (alterError) {
      databaseLogger.warn("Failed to add sudo_password column", {
        operation: "schema_migration",
        error: alterError,
      });
    }
  }

  try {
    sqlite.prepare("SELECT id FROM roles LIMIT 1").get();
  } catch {
    try {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS roles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          display_name TEXT NOT NULL,
          description TEXT,
          is_system INTEGER NOT NULL DEFAULT 0,
          permissions TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
    } catch (createError) {
      databaseLogger.warn("Failed to create roles table", {
        operation: "schema_migration",
        error: createError,
      });
    }
  }

  try {
    sqlite.prepare("SELECT id FROM user_roles LIMIT 1").get();
  } catch {
    try {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS user_roles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          role_id INTEGER NOT NULL,
          granted_by TEXT,
          granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, role_id),
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
          FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE,
          FOREIGN KEY (granted_by) REFERENCES users (id) ON DELETE SET NULL
        );
      `);
    } catch (createError) {
      databaseLogger.warn("Failed to create user_roles table", {
        operation: "schema_migration",
        error: createError,
      });
    }
  }

  try {
    sqlite.prepare("SELECT id FROM audit_logs LIMIT 1").get();
  } catch {
    try {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          username TEXT NOT NULL,
          action TEXT NOT NULL,
          resource_type TEXT NOT NULL,
          resource_id TEXT,
          resource_name TEXT,
          details TEXT,
          ip_address TEXT,
          user_agent TEXT,
          success INTEGER NOT NULL,
          error_message TEXT,
          timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        );
      `);
    } catch (createError) {
      databaseLogger.warn("Failed to create audit_logs table", {
        operation: "schema_migration",
        error: createError,
      });
    }
  }

  try {
    sqlite.prepare("SELECT id FROM session_recordings LIMIT 1").get();
  } catch {
    try {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS session_recordings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          host_id INTEGER NOT NULL,
          user_id TEXT NOT NULL,
          access_id INTEGER,
          started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          ended_at TEXT,
          duration INTEGER,
          commands TEXT,
          dangerous_actions TEXT,
          recording_path TEXT,
          terminated_by_owner INTEGER DEFAULT 0,
          termination_reason TEXT,
          FOREIGN KEY (host_id) REFERENCES ssh_data (id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
          FOREIGN KEY (access_id) REFERENCES host_access (id) ON DELETE SET NULL
        );
      `);
    } catch (createError) {
      databaseLogger.warn("Failed to create session_recordings table", {
        operation: "schema_migration",
        error: createError,
      });
    }
  }

  try {
    sqlite.prepare("SELECT id FROM shared_credentials LIMIT 1").get();
  } catch {
    try {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS shared_credentials (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          host_access_id INTEGER NOT NULL,
          original_credential_id INTEGER NOT NULL,
          target_user_id TEXT NOT NULL,
          encrypted_username TEXT NOT NULL,
          encrypted_auth_type TEXT NOT NULL,
          encrypted_password TEXT,
          encrypted_key TEXT,
          encrypted_key_password TEXT,
          encrypted_key_type TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          needs_re_encryption INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY (host_access_id) REFERENCES host_access (id) ON DELETE CASCADE,
          FOREIGN KEY (original_credential_id) REFERENCES ssh_credentials (id) ON DELETE CASCADE,
          FOREIGN KEY (target_user_id) REFERENCES users (id) ON DELETE CASCADE
        );
      `);
    } catch (createError) {
      databaseLogger.warn("Failed to create shared_credentials table", {
        operation: "schema_migration",
        error: createError,
      });
    }
  }

  try {
    const existingRoles = sqlite.prepare("SELECT name, is_system FROM roles").all() as Array<{ name: string; is_system: number }>;

    try {
      const validSystemRoles = ['admin', 'user'];
      const unwantedRoleNames = ['superAdmin', 'powerUser', 'readonly', 'member'];
      let deletedCount = 0;

      const deleteByName = sqlite.prepare("DELETE FROM roles WHERE name = ?");
      for (const roleName of unwantedRoleNames) {
        const result = deleteByName.run(roleName);
        if (result.changes > 0) {
          deletedCount += result.changes;
        }
      }

      const deleteOldSystemRole = sqlite.prepare("DELETE FROM roles WHERE name = ? AND is_system = 1");
      for (const role of existingRoles) {
        if (role.is_system === 1 && !validSystemRoles.includes(role.name) && !unwantedRoleNames.includes(role.name)) {
          const result = deleteOldSystemRole.run(role.name);
          if (result.changes > 0) {
            deletedCount += result.changes;
          }
        }
      }
    } catch (cleanupError) {
      databaseLogger.warn("Failed to clean up old system roles", {
        operation: "schema_migration",
        error: cleanupError,
      });
    }

    const systemRoles = [
      {
        name: "admin",
        displayName: "rbac.roles.admin",
        description: "Administrator with full access",
        permissions: null,
      },
      {
        name: "user",
        displayName: "rbac.roles.user",
        description: "Regular user",
        permissions: null,
      },
    ];

    for (const role of systemRoles) {
      const existingRole = sqlite.prepare("SELECT id FROM roles WHERE name = ?").get(role.name);
      if (!existingRole) {
        try {
          sqlite.prepare(`
            INSERT INTO roles (name, display_name, description, is_system, permissions)
            VALUES (?, ?, ?, 1, ?)
          `).run(role.name, role.displayName, role.description, role.permissions);
        } catch (insertError) {
          databaseLogger.warn(`Failed to create system role: ${role.name}`, {
            operation: "schema_migration",
            error: insertError,
          });
        }
      }
    }

    try {
      const adminUsers = sqlite.prepare("SELECT id FROM users WHERE is_admin = 1").all() as { id: string }[];
      const normalUsers = sqlite.prepare("SELECT id FROM users WHERE is_admin = 0").all() as { id: string }[];

      const adminRole = sqlite.prepare("SELECT id FROM roles WHERE name = 'admin'").get() as { id: number } | undefined;
      const userRole = sqlite.prepare("SELECT id FROM roles WHERE name = 'user'").get() as { id: number } | undefined;

      if (adminRole) {
        const insertUserRole = sqlite.prepare(`
          INSERT OR IGNORE INTO user_roles (user_id, role_id, granted_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
        `);

        for (const admin of adminUsers) {
          try {
            insertUserRole.run(admin.id, adminRole.id);
          } catch (error) {
            // Ignore duplicate errors
          }
        }
      }

      if (userRole) {
        const insertUserRole = sqlite.prepare(`
          INSERT OR IGNORE INTO user_roles (user_id, role_id, granted_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
        `);

        for (const user of normalUsers) {
          try {
            insertUserRole.run(user.id, userRole.id);
          } catch (error) {
            // Ignore duplicate errors
          }
        }
      }
    } catch (migrationError) {
      databaseLogger.warn("Failed to migrate existing users to roles", {
        operation: "schema_migration",
        error: migrationError,
      });
    }
  } catch (seedError) {
    databaseLogger.warn("Failed to seed system roles", {
      operation: "schema_migration",
      error: seedError,
    });
  }

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

    try {
      const sessionCount = memoryDatabase
        .prepare("SELECT COUNT(*) as count FROM sessions")
        .get() as { count: number };
    } catch (countError) {
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
        } catch {
        }
      }

      try {
        fs.rmdirSync(tempDir);
      } catch {
      }
    }
  } catch {
  }
}

process.on("exit", () => {
  if (sqlite) {
    try {
      sqlite.close();
    } catch {
    }
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
