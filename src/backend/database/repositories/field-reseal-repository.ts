import { asc, eq, gt } from "drizzle-orm";
import {
  hostProtocolAuth,
  hosts,
  sharedCredentialSecrets,
  sharedHostSecrets,
  sshCredentials,
} from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { protocolAuthRecordId } from "./host-protocol-auth-repository.js";
import {
  sharedCredentialSecretRecordId,
  sharedHostSecretRecordId,
} from "../../utils/sealed-record-ids.js";

/** A row with sealed columns, as the reseal migration sees it. */
export interface ResealRow {
  id: number;
  /** Whose data key the values are sealed with. */
  ownerId: string;
  /** The record id the values must be sealed for. */
  recordId: string;
  /** Column property name to stored value. */
  values: Record<string, string | null>;
}

export interface ResealTable {
  /** Table name, for logs and the backup file. */
  name: string;
  /** Column property name to the field name its values are sealed under. */
  fields: Record<string, string>;
  list(afterId: number, limit: number): Promise<ResealRow[]>;
  update(id: number, values: Record<string, string>): Promise<void>;
}

function pick(
  row: Record<string, unknown>,
  columns: string[],
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const column of columns) {
    const value = row[column];
    out[column] = typeof value === "string" ? value : null;
  }
  return out;
}

/**
 * Every core table whose secrets are sealed with FieldCrypto, with the record
 * id each row's values must carry.
 */
export class FieldResealRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  tables(): ResealTable[] {
    const db = this.context.drizzle;
    const afterWrite = async () => {
      await this.onWrite?.();
    };

    const hostFields = {
      password: "password",
      key: "key",
      keyPassword: "keyPassword",
      sudoPassword: "sudoPassword",
      socks5Password: "socks5Password",
    };
    const credentialFields = {
      password: "password",
      privateKey: "privateKey",
      keyPassword: "keyPassword",
      key: "key",
      publicKey: "publicKey",
    };
    const protocolFields = {
      password: "password",
      secretFields: "secretFields",
    };
    const sharedHostFields = {
      encryptedUsername: "username",
      encryptedPassword: "password",
      encryptedKey: "key",
      encryptedKeyPassword: "key_password",
      encryptedDomain: "domain",
      encryptedFields: "fields",
    };
    const sharedCredentialFields = {
      encryptedUsername: "username",
      encryptedPassword: "password",
      encryptedKey: "key",
      encryptedKeyPassword: "key_password",
    };

    return [
      {
        name: "ssh_data",
        fields: hostFields,
        list: async (afterId, limit) => {
          const rows = await db
            .select({
              id: hosts.id,
              userId: hosts.userId,
              password: hosts.password,
              key: hosts.key,
              keyPassword: hosts.keyPassword,
              sudoPassword: hosts.sudoPassword,
              socks5Password: hosts.socks5Password,
            })
            .from(hosts)
            .where(gt(hosts.id, afterId))
            .orderBy(asc(hosts.id))
            .limit(limit);
          return rows.map((row) => ({
            id: row.id,
            ownerId: row.userId,
            recordId: String(row.id),
            values: pick(row, Object.keys(hostFields)),
          }));
        },
        update: async (id, values) => {
          await db.update(hosts).set(values).where(eq(hosts.id, id));
          await afterWrite();
        },
      },
      {
        name: "ssh_credentials",
        fields: credentialFields,
        list: async (afterId, limit) => {
          const rows = await db
            .select({
              id: sshCredentials.id,
              userId: sshCredentials.userId,
              password: sshCredentials.password,
              privateKey: sshCredentials.privateKey,
              keyPassword: sshCredentials.keyPassword,
              key: sshCredentials.key,
              publicKey: sshCredentials.publicKey,
            })
            .from(sshCredentials)
            .where(gt(sshCredentials.id, afterId))
            .orderBy(asc(sshCredentials.id))
            .limit(limit);
          return rows.map((row) => ({
            id: row.id,
            ownerId: row.userId,
            recordId: String(row.id),
            values: pick(row, Object.keys(credentialFields)),
          }));
        },
        update: async (id, values) => {
          await db
            .update(sshCredentials)
            .set(values)
            .where(eq(sshCredentials.id, id));
          await afterWrite();
        },
      },
      {
        name: "host_protocol_auth",
        fields: protocolFields,
        list: async (afterId, limit) => {
          const rows = await db
            .select({
              id: hostProtocolAuth.id,
              hostId: hostProtocolAuth.hostId,
              userId: hostProtocolAuth.userId,
              protocol: hostProtocolAuth.protocol,
              password: hostProtocolAuth.password,
              secretFields: hostProtocolAuth.secretFields,
            })
            .from(hostProtocolAuth)
            .where(gt(hostProtocolAuth.id, afterId))
            .orderBy(asc(hostProtocolAuth.id))
            .limit(limit);
          return rows.map((row) => ({
            id: row.id,
            ownerId: row.userId,
            recordId: protocolAuthRecordId(row.hostId, row.protocol),
            values: pick(row, Object.keys(protocolFields)),
          }));
        },
        update: async (id, values) => {
          await db
            .update(hostProtocolAuth)
            .set(values)
            .where(eq(hostProtocolAuth.id, id));
          await afterWrite();
        },
      },
      {
        name: "shared_host_secrets",
        fields: sharedHostFields,
        list: async (afterId, limit) => {
          const rows = await db
            .select({
              id: sharedHostSecrets.id,
              hostAccessId: sharedHostSecrets.hostAccessId,
              targetUserId: sharedHostSecrets.targetUserId,
              protocol: sharedHostSecrets.protocol,
              encryptedUsername: sharedHostSecrets.encryptedUsername,
              encryptedPassword: sharedHostSecrets.encryptedPassword,
              encryptedKey: sharedHostSecrets.encryptedKey,
              encryptedKeyPassword: sharedHostSecrets.encryptedKeyPassword,
              encryptedDomain: sharedHostSecrets.encryptedDomain,
              encryptedFields: sharedHostSecrets.encryptedFields,
            })
            .from(sharedHostSecrets)
            .where(gt(sharedHostSecrets.id, afterId))
            .orderBy(asc(sharedHostSecrets.id))
            .limit(limit);
          return rows.map((row) => ({
            id: row.id,
            ownerId: row.targetUserId,
            recordId: sharedHostSecretRecordId(
              row.hostAccessId,
              row.targetUserId,
              row.protocol,
            ),
            values: pick(row, Object.keys(sharedHostFields)),
          }));
        },
        update: async (id, values) => {
          await db
            .update(sharedHostSecrets)
            .set(values)
            .where(eq(sharedHostSecrets.id, id));
          await afterWrite();
        },
      },
      {
        name: "shared_credential_secrets",
        fields: sharedCredentialFields,
        list: async (afterId, limit) => {
          const rows = await db
            .select({
              id: sharedCredentialSecrets.id,
              credentialAccessId: sharedCredentialSecrets.credentialAccessId,
              targetUserId: sharedCredentialSecrets.targetUserId,
              encryptedUsername: sharedCredentialSecrets.encryptedUsername,
              encryptedPassword: sharedCredentialSecrets.encryptedPassword,
              encryptedKey: sharedCredentialSecrets.encryptedKey,
              encryptedKeyPassword:
                sharedCredentialSecrets.encryptedKeyPassword,
            })
            .from(sharedCredentialSecrets)
            .where(gt(sharedCredentialSecrets.id, afterId))
            .orderBy(asc(sharedCredentialSecrets.id))
            .limit(limit);
          return rows.map((row) => ({
            id: row.id,
            ownerId: row.targetUserId,
            recordId: sharedCredentialSecretRecordId(
              row.credentialAccessId,
              row.targetUserId,
            ),
            values: pick(row, Object.keys(sharedCredentialFields)),
          }));
        },
        update: async (id, values) => {
          await db
            .update(sharedCredentialSecrets)
            .set(values)
            .where(eq(sharedCredentialSecrets.id, id));
          await afterWrite();
        },
      },
    ];
  }
}
