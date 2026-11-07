import type { Response } from "express";
import { getCurrentSettingValue } from "../database/repositories/factory.js";

/** Admin setting: "false" stops Termix from saving passwords and keys. */
export const CREDENTIAL_STORAGE_SETTING = "allow_credential_storage";

const HOST_SECRETS = [
  "password",
  "key",
  "keyPassword",
  "sudoPassword",
  "socks5Password",
] as const;
const CREDENTIAL_SECRETS = [
  "password",
  "privateKey",
  "keyPassword",
  "key",
] as const;

export type SecretTable = "ssh_data" | "ssh_credentials" | "protocol_auth";

export class CredentialStorageError extends Error {
  readonly status = 403;
  readonly code = "CREDENTIAL_STORAGE_OFF";
  constructor() {
    super("Saving passwords and keys is turned off on this server");
    this.name = "CredentialStorageError";
  }
}

export function credentialStorageAllowed(): boolean {
  try {
    return getCurrentSettingValue(CREDENTIAL_STORAGE_SETTING) !== "false";
  } catch {
    return true;
  }
}

function filled(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

function parseList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Secret fields of a write that would store a value. */
export function storedSecretFields(
  table: SecretTable,
  record: Record<string, unknown>,
): string[] {
  const found: string[] = [];
  if (table === "protocol_auth") {
    if (filled(record.password)) found.push("password");
    const secrets = record.secretFields;
    if (secrets && typeof secrets === "object") {
      for (const [field, value] of Object.entries(secrets)) {
        if (filled(value)) found.push(field);
      }
    }
    return found;
  }
  const fields = table === "ssh_data" ? HOST_SECRETS : CREDENTIAL_SECRETS;
  for (const field of fields) {
    if (filled(record[field])) found.push(field);
  }
  if (table === "ssh_data") {
    for (const field of ["socks5ProxyChain", "jumpHosts"]) {
      const hasPassword = parseList(record[field]).some(
        (node) =>
          !!node &&
          typeof node === "object" &&
          filled((node as Record<string, unknown>).password),
      );
      if (hasPassword) found.push(field);
    }
  }
  return found;
}

/** Throws when the setting is off and the write would store a secret. */
export function assertSecretsAllowed(
  table: SecretTable,
  record: Record<string, unknown>,
): void {
  if (credentialStorageAllowed()) return;
  if (storedSecretFields(table, record).length > 0) {
    throw new CredentialStorageError();
  }
}

/** Drops secrets from a synced row instead of refusing it. */
export function stripSecrets(
  table: Exclude<SecretTable, "protocol_auth">,
  record: Record<string, unknown>,
): Record<string, unknown> {
  if (credentialStorageAllowed()) return record;
  const out = { ...record };
  const fields = table === "ssh_data" ? HOST_SECRETS : CREDENTIAL_SECRETS;
  for (const field of fields) {
    if (filled(out[field])) out[field] = null;
  }
  return out;
}

export function sendCredentialStorageOff(res: Response): void {
  const error = new CredentialStorageError();
  res.status(error.status).json({ error: error.message, code: error.code });
}

/** The part of an update that differs from what is already stored. */
export function changedFields(
  update: Record<string, unknown>,
  current: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!current) return update;
  return Object.fromEntries(
    Object.entries(update).filter(([field, value]) => value !== current[field]),
  );
}
