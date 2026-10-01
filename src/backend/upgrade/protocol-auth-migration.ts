/**
 * Copies each host's 2.8 RDP, VNC and Telnet logins out of the ssh_data
 * columns into host_protocol_auth, re-encrypted with the owner's data key
 * under the new table's context.
 *
 * The columns stay in the database, unused, until 3.0.0. A user's hosts are
 * copied once their data key opens (at boot for a system-wrapped key, at the
 * next password login for a 2.8 key that only the password opens), and a
 * per-user marker then stops a later boot from bringing back a login the
 * user removed. A host that already has a login for a protocol is skipped,
 * so a run that stopped half way is safe to repeat.
 *
 * Very old installs kept a remote desktop host's login in username,
 * password and domain; 2.8 copied those into the protocol columns on every
 * boot, and this does the same for a host whose protocol columns are empty.
 */

import { sql } from "drizzle-orm";
import { databaseLogger } from "../utils/logger.js";
import { DataCrypto } from "../utils/data-crypto.js";
import { FieldCrypto } from "../utils/field-crypto.js";
import {
  createCurrentHostProtocolAuthRepository,
  createCurrentSettingsRepository,
} from "../database/repositories/factory.js";
import type { HostProtocolLogin } from "../database/repositories/host-protocol-auth-repository.js";
import {
  selectLegacyRows,
  selectRows,
} from "../utils/crypto-migration/raw-rows.js";

interface LegacyProtocol {
  id: string;
  user: string;
  password: string;
  passwordField: string;
  credential: string;
  authType: string;
  domain?: string;
}

const PROTOCOLS: LegacyProtocol[] = [
  {
    id: "rdp",
    user: "rdp_user",
    password: "rdp_password",
    passwordField: "rdpPassword",
    credential: "rdp_credential_id",
    authType: "rdp_auth_type",
    domain: "rdp_domain",
  },
  {
    id: "vnc",
    user: "vnc_user",
    password: "vnc_password",
    passwordField: "vncPassword",
    credential: "vnc_credential_id",
    authType: "vnc_auth_type",
  },
  {
    id: "telnet",
    user: "telnet_user",
    password: "telnet_password",
    passwordField: "telnetPassword",
    credential: "telnet_credential_id",
    authType: "telnet_auth_type",
  },
];

const AUTH_TYPES = new Set(["direct", "credential", "none"]);

export function copiedMarker(userId: string): string {
  return `protocol_auth_copied_v1:${userId}`;
}

type LegacyRow = Record<string, unknown> & { id: number; user_id: string };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * A 2.8 secret column read raw: plaintext, or an envelope written under the
 * field's own name, its column name, or "password" when 2.8 copied the
 * host's password blob into it.
 */
export function openLegacySecret(
  value: unknown,
  dek: Buffer,
  recordId: string,
  fieldNames: string[],
): string | null {
  const raw = typeof value === "string" ? value : "";
  if (!raw) return null;
  if (!FieldCrypto.isEncrypted(raw)) return raw;
  for (const fieldName of fieldNames) {
    try {
      return FieldCrypto.decryptField(raw, dek, recordId, fieldName);
    } catch {
      // Try the next name.
    }
  }
  return null;
}

/** The login a 2.8 host row held for one protocol, or null for none. */
export function legacyLogin(
  row: LegacyRow,
  protocol: LegacyProtocol,
  dek: Buffer,
  credentialExists: (id: number) => boolean,
): HostProtocolLogin | null {
  const recordId = String(row.id);
  const storedType = text(row[protocol.authType]);
  const credentialValue = Number(row[protocol.credential]);
  const credentialId =
    Number.isInteger(credentialValue) &&
    credentialValue > 0 &&
    credentialExists(credentialValue)
      ? credentialValue
      : null;
  let username = text(row[protocol.user]);
  let password = openLegacySecret(row[protocol.password], dek, recordId, [
    protocol.passwordField,
    protocol.password,
    "password",
  ]);
  let domain = protocol.domain ? text(row[protocol.domain]) : "";
  const hasOwn =
    !!storedType ||
    !!row[protocol.credential] ||
    !!username ||
    !!row[protocol.password] ||
    !!domain;

  if (!hasOwn) {
    if (text(row.connection_type) !== protocol.id) return null;
    username = text(row.username);
    password = openLegacySecret(row.password, dek, recordId, ["password"]);
    domain = protocol.domain ? text(row.domain) : "";
    if (!username && !password && !domain) return null;
  } else if (protocol.domain && row[protocol.domain] == null) {
    // A saved empty domain was cleared on purpose, so only fill a missing one.
    domain = text(row.domain);
  }

  const authType = AUTH_TYPES.has(storedType)
    ? storedType
    : credentialId
      ? "credential"
      : "direct";
  const direct = authType === "direct";
  return {
    protocol: protocol.id,
    authType,
    credentialId: authType === "credential" ? credentialId : null,
    username: direct ? username || null : null,
    password: direct ? password : null,
    fields: domain ? { domain } : {},
    secretFields: {},
  };
}

export interface ProtocolAuthMigrationResult {
  copied: number;
  pendingUsers: number;
}

/** Copies every user's logins, or only `userId`'s after a login opened their key. */
export async function runProtocolAuthMigration(
  userId?: string,
): Promise<ProtocolAuthMigrationResult> {
  const result: ProtocolAuthMigrationResult = { copied: 0, pendingUsers: 0 };
  const rows = await selectLegacyRows<LegacyRow>(sql`
    SELECT id, user_id, connection_type, username, password, domain,
      rdp_user, rdp_password, rdp_domain, rdp_credential_id, rdp_auth_type,
      vnc_user, vnc_password, vnc_credential_id, vnc_auth_type,
      telnet_user, telnet_password, telnet_credential_id, telnet_auth_type
    FROM ssh_data
  `);
  if (rows.length === 0) return result;

  let credentialIds: Set<number>;
  try {
    credentialIds = new Set(
      (
        await selectRows<{ id: number | string }>(
          sql`SELECT id FROM ssh_credentials`,
        )
      ).map((row) => Number(row.id)),
    );
  } catch {
    return result;
  }
  const settings = createCurrentSettingsRepository();
  const repository = createCurrentHostProtocolAuthRepository();

  const byUser = new Map<string, LegacyRow[]>();
  for (const row of rows) {
    const owner = String(row.user_id);
    if (userId && owner !== userId) continue;
    byUser.set(owner, [...(byUser.get(owner) ?? []), row]);
  }

  for (const [owner, hosts] of byUser) {
    try {
      if ((await settings.get(copiedMarker(owner))) === "done") continue;
      const dek = DataCrypto.getUserDataKey(owner);
      if (!dek) {
        result.pendingUsers++;
        continue;
      }
      for (const host of hosts) {
        const hostId = Number(host.id);
        for (const protocol of PROTOCOLS) {
          const login = legacyLogin(host, protocol, dek, (id) =>
            credentialIds.has(id),
          );
          if (!login) continue;
          if (await repository.findRow(hostId, protocol.id)) continue;
          await repository.upsert(owner, hostId, login, dek);
          result.copied++;
        }
      }
      await settings.set(copiedMarker(owner), "done");
    } catch (error) {
      databaseLogger.warn("Protocol login copy failed for a user", {
        operation: "protocol_auth_migration",
        userId: owner,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (result.copied > 0) {
    databaseLogger.info(
      `Moved ${result.copied} remote desktop login(s) into host_protocol_auth`,
      { operation: "protocol_auth_migration" },
    );
  }
  return result;
}
