import type Database from "better-sqlite3";

const MIGRATION_KEY = "shared_host_auth_overrides_v1";

const createProtocolAwareTableSql = `
  CREATE TABLE shared_host_auth_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    host_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    protocol TEXT NOT NULL DEFAULT 'ssh',
    credential_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (host_id) REFERENCES ssh_data (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (credential_id) REFERENCES ssh_credentials (id) ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX shared_host_auth_overrides_host_user_protocol_unique
    ON shared_host_auth_overrides (host_id, user_id, protocol);
`;

export type SharedHostAuthOverrideSchemaResult =
  "created" | "migrated" | "current";

/**
 * Keeps the override storage protocol-capable without enabling any additional
 * protocol. Pre-protocol rows are preserved as SSH overrides.
 */
export function ensureSharedHostAuthOverrideProtocolSchema(
  sqlite: Database.Database,
): SharedHostAuthOverrideSchemaResult {
  const tableExists = sqlite
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'shared_host_auth_overrides'",
    )
    .get();

  if (!tableExists) {
    sqlite.exec(createProtocolAwareTableSql);
    return "created";
  }

  const hasProtocol = sqlite
    .prepare(
      "SELECT 1 FROM pragma_table_info('shared_host_auth_overrides') WHERE name = 'protocol'",
    )
    .get();
  if (hasProtocol) {
    return "current";
  }

  sqlite.transaction(() => {
    sqlite.exec(`
      ALTER TABLE shared_host_auth_overrides
        RENAME TO shared_host_auth_overrides_pre_protocol;

      ${createProtocolAwareTableSql}

      INSERT INTO shared_host_auth_overrides
        (id, host_id, user_id, protocol, credential_id, created_at, updated_at)
      SELECT
        id, host_id, user_id, 'ssh', credential_id, created_at, updated_at
      FROM shared_host_auth_overrides_pre_protocol;

      DROP TABLE shared_host_auth_overrides_pre_protocol;
    `);
  })();

  return "migrated";
}

export function migrateLegacySharedHostAuthOverrides(
  sqlite: Database.Database,
  getSetting: (key: string) => string | null,
  setSetting: (key: string, value: string) => void,
): boolean {
  if (getSetting(MIGRATION_KEY) !== null) return false;

  const hasLegacyColumn = sqlite
    .prepare(
      "SELECT 1 FROM pragma_table_info('host_access') WHERE name = 'override_credential_id'",
    )
    .get();

  if (hasLegacyColumn) {
    sqlite.exec(`
      INSERT OR IGNORE INTO shared_host_auth_overrides
        (host_id, user_id, protocol, credential_id)
      SELECT host_id, user_id, 'ssh', override_credential_id
      FROM host_access
      WHERE user_id IS NOT NULL AND override_credential_id IS NOT NULL;

      UPDATE host_access
      SET override_credential_id = NULL
      WHERE override_credential_id IS NOT NULL;
    `);
  }

  setSetting(MIGRATION_KEY, "done");
  return true;
}
