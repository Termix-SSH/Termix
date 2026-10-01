import { and, eq, inArray } from "drizzle-orm";
import { hostProtocolAuth } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { FieldCrypto } from "../../utils/field-crypto.js";
import { databaseLogger } from "../../utils/logger.js";

export type HostProtocolAuthRecord = typeof hostProtocolAuth.$inferSelect;

/** A host's login for one plugin protocol, decrypted. */
export interface HostProtocolLogin {
  protocol: string;
  authType: string;
  credentialId: number | null;
  username: string | null;
  password: string | null;
  /** Non-secret declared fields. */
  fields: Record<string, string>;
  /** Secret declared fields. */
  secretFields: Record<string, string>;
}

/** The encryption context of a login's secret columns. */
export function protocolAuthRecordId(hostId: number, protocol: string): string {
  return `host-protocol-auth-${hostId}-${protocol}`;
}

function parseStringMap(value: string | null): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [key, entry] of Object.entries(parsed)) {
      if (typeof entry === "string") out[key] = entry;
    }
    return out;
  } catch {
    return {};
  }
}

function openField(
  value: string | null,
  dek: Buffer,
  recordId: string,
  fieldName: string,
): string | null {
  if (!value) return null;
  if (!FieldCrypto.isEncrypted(value)) return value;
  try {
    return FieldCrypto.decryptField(value, dek, recordId, fieldName);
  } catch (error) {
    // A value that does not open is treated as missing, never passed on.
    databaseLogger.warn("A host protocol login could not be decrypted", {
      operation: "host_protocol_auth_decrypt",
      recordId,
      fieldName,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function sealField(
  value: string | null,
  dek: Buffer,
  recordId: string,
  fieldName: string,
): string | null {
  if (!value) return null;
  return FieldCrypto.encryptField(value, dek, recordId, fieldName);
}

export function decryptProtocolLogin(
  row: HostProtocolAuthRecord,
  dek: Buffer,
): HostProtocolLogin {
  const recordId = protocolAuthRecordId(row.hostId, row.protocol);
  const secrets = openField(row.secretFields, dek, recordId, "secretFields");
  return {
    protocol: row.protocol,
    authType: row.authType || "direct",
    credentialId: row.credentialId ?? null,
    username: row.username ?? null,
    password: openField(row.password, dek, recordId, "password"),
    fields: parseStringMap(row.fields),
    secretFields: parseStringMap(secrets),
  };
}

export function encryptProtocolLogin(
  hostId: number,
  login: HostProtocolLogin,
  dek: Buffer,
): Pick<
  HostProtocolAuthRecord,
  | "authType"
  | "credentialId"
  | "username"
  | "password"
  | "fields"
  | "secretFields"
> {
  const recordId = protocolAuthRecordId(hostId, login.protocol);
  const secretFields = Object.keys(login.secretFields).length
    ? JSON.stringify(login.secretFields)
    : null;
  return {
    authType: login.authType || "direct",
    credentialId: login.credentialId ?? null,
    username: login.username || null,
    password: sealField(login.password, dek, recordId, "password"),
    fields: Object.keys(login.fields).length
      ? JSON.stringify(login.fields)
      : null,
    secretFields: sealField(secretFields, dek, recordId, "secretFields"),
  };
}

/**
 * host_protocol_auth: one login per host and plugin protocol, encrypted with
 * the host owner's data key.
 */
export class HostProtocolAuthRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async listRowsForHosts(hostIds: number[]): Promise<HostProtocolAuthRecord[]> {
    const unique = Array.from(new Set(hostIds));
    if (unique.length === 0) return [];
    return this.context.drizzle
      .select()
      .from(hostProtocolAuth)
      .where(inArray(hostProtocolAuth.hostId, unique));
  }

  async listRowsForHost(hostId: number): Promise<HostProtocolAuthRecord[]> {
    return this.listRowsForHosts([hostId]);
  }

  async findRow(
    hostId: number,
    protocol: string,
  ): Promise<HostProtocolAuthRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(hostProtocolAuth)
      .where(
        and(
          eq(hostProtocolAuth.hostId, hostId),
          eq(hostProtocolAuth.protocol, protocol),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async listForHost(hostId: number, dek: Buffer): Promise<HostProtocolLogin[]> {
    return (await this.listRowsForHost(hostId)).map((row) =>
      decryptProtocolLogin(row, dek),
    );
  }

  async find(
    hostId: number,
    protocol: string,
    dek: Buffer,
  ): Promise<HostProtocolLogin | null> {
    const row = await this.findRow(hostId, protocol);
    return row ? decryptProtocolLogin(row, dek) : null;
  }

  async upsert(
    ownerId: string,
    hostId: number,
    login: HostProtocolLogin,
    dek: Buffer,
  ): Promise<void> {
    const values = encryptProtocolLogin(hostId, login, dek);
    const existing = await this.findRow(hostId, login.protocol);
    if (existing) {
      await this.context.drizzle
        .update(hostProtocolAuth)
        .set({
          ...values,
          userId: ownerId,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(hostProtocolAuth.id, existing.id));
    } else {
      await this.context.drizzle.insert(hostProtocolAuth).values({
        ...values,
        hostId,
        userId: ownerId,
        protocol: login.protocol,
      });
    }
    await this.afterWrite();
  }

  async delete(hostId: number, protocol: string): Promise<boolean> {
    const existing = await this.findRow(hostId, protocol);
    if (!existing) return false;
    await this.context.drizzle
      .delete(hostProtocolAuth)
      .where(eq(hostProtocolAuth.id, existing.id));
    await this.afterWrite();
    return true;
  }

  /** The owner's hosts whose login for some protocol uses the credential. */
  async listHostIdsForCredential(
    ownerId: string,
    credentialId: number,
  ): Promise<number[]> {
    const rows = await this.context.drizzle
      .select({ hostId: hostProtocolAuth.hostId })
      .from(hostProtocolAuth)
      .where(
        and(
          eq(hostProtocolAuth.userId, ownerId),
          eq(hostProtocolAuth.credentialId, credentialId),
        ),
      );
    return Array.from(new Set(rows.map((row) => row.hostId)));
  }

  /** Every login a user owns, for an export. */
  async listRowsForUser(userId: string): Promise<HostProtocolAuthRecord[]> {
    return this.context.drizzle
      .select()
      .from(hostProtocolAuth)
      .where(eq(hostProtocolAuth.userId, userId));
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
