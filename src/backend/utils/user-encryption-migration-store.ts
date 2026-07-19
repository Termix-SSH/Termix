import { getCurrentRepositorySqlite } from "../database/repositories/factory.js";

export interface UserEncryptionMigrationRecord {
  id: number | string;
  [key: string]: unknown;
}

export interface UserEncryptionMigrationStore {
  listHostRecords(userId: string): UserEncryptionMigrationRecord[];
  listCredentialRecords(userId: string): UserEncryptionMigrationRecord[];
  getUserRecord(userId: string): UserEncryptionMigrationRecord | undefined;
  updateHostSensitiveFields(
    recordId: number | string,
    record: Record<string, unknown>,
  ): void;
  updateCredentialSensitiveFields(
    recordId: number | string,
    record: Record<string, unknown>,
  ): void;
  updateUserSensitiveFields(
    userId: string,
    record: Record<string, unknown>,
  ): void;
  updatePasswordResetFields(
    table: "ssh_data" | "ssh_credentials" | "users",
    recordId: number | string,
    fields: string[],
    record: Record<string, unknown>,
  ): void;
}

export interface LegacyDatabaseInstance {
  prepare: (sql: string) => {
    all: (param?: unknown) => UserEncryptionMigrationRecord[];
    get: (param?: unknown) => UserEncryptionMigrationRecord | undefined;
    run: (...params: unknown[]) => unknown;
  };
}

export class RawSqliteUserEncryptionMigrationStore implements UserEncryptionMigrationStore {
  constructor(private readonly db: LegacyDatabaseInstance) {}

  listHostRecords(userId: string): UserEncryptionMigrationRecord[] {
    return this.db
      .prepare("SELECT * FROM ssh_data WHERE user_id = ?")
      .all(userId);
  }

  listCredentialRecords(userId: string): UserEncryptionMigrationRecord[] {
    return this.db
      .prepare("SELECT * FROM ssh_credentials WHERE user_id = ?")
      .all(userId);
  }

  getUserRecord(userId: string): UserEncryptionMigrationRecord | undefined {
    return this.db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  }

  updateHostSensitiveFields(
    recordId: number | string,
    record: Record<string, unknown>,
  ): void {
    this.db
      .prepare(
        `
          UPDATE ssh_data
          SET password = ?, key = ?, key_password = ?, key_type = ?, autostart_password = ?, autostart_key = ?, autostart_key_password = ?, sudo_password = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
      )
      .run(
        record.password || null,
        record.key || null,
        record.key_password || null,
        record.key_type || null,
        record.autostart_password || null,
        record.autostart_key || null,
        record.autostart_key_password || null,
        record.sudo_password || null,
        recordId,
      );
  }

  updateCredentialSensitiveFields(
    recordId: number | string,
    record: Record<string, unknown>,
  ): void {
    this.db
      .prepare(
        `
          UPDATE ssh_credentials
          SET password = ?, key = ?, key_password = ?, private_key = ?, public_key = ?, key_type = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
      )
      .run(
        record.password || null,
        record.key || null,
        record.key_password || null,
        record.private_key || null,
        record.public_key || null,
        record.key_type || null,
        recordId,
      );
  }

  updateUserSensitiveFields(
    userId: string,
    record: Record<string, unknown>,
  ): void {
    this.db
      .prepare(
        `
          UPDATE users
          SET totp_secret = ?, totp_backup_codes = ?, client_secret = ?, oidc_identifier = ?
          WHERE id = ?
        `,
      )
      .run(
        record.totp_secret || null,
        record.totp_backup_codes || null,
        record.client_secret || null,
        record.oidc_identifier || null,
        userId,
      );
  }

  updatePasswordResetFields(
    table: "ssh_data" | "ssh_credentials" | "users",
    recordId: number | string,
    fields: string[],
    record: Record<string, unknown>,
  ): void {
    const setClause = fields.map((field) => `${field} = ?`).join(", ");
    const updateQuery =
      table === "users"
        ? `UPDATE ${table} SET ${setClause} WHERE id = ?`
        : `UPDATE ${table} SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
    const updateValues = fields.map((field) => record[field]);
    updateValues.push(recordId);

    this.db.prepare(updateQuery).run(...updateValues);
  }
}

export async function createCurrentUserEncryptionMigrationStore(): Promise<UserEncryptionMigrationStore> {
  return new RawSqliteUserEncryptionMigrationStore(
    getCurrentRepositorySqlite(),
  );
}
