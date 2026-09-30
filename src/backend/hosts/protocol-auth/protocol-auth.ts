/**
 * Per-host logins for the protocols plugins declare (contributes.protocols).
 *
 * Core stores them in host_protocol_auth, encrypted with the host owner's
 * data key, and knows each protocol only by its declaration: which extra
 * fields a login carries and which of those are secret. Writes, the host
 * payload, sharing, export and sync all go through here, so a new protocol
 * needs no core change.
 */

import {
  createCurrentHostProtocolAuthRepository,
  createCurrentSharedHostAuthOverrideRepository,
} from "../../database/repositories/factory.js";
import {
  decryptProtocolLogin,
  type HostProtocolAuthRecord,
  type HostProtocolLogin,
} from "../../database/repositories/host-protocol-auth-repository.js";
import { DataCrypto } from "../../utils/data-crypto.js";
import { findUsableCredential } from "../usable-credential.js";
import {
  isSecretReference,
  resolveSecretReference,
} from "../external-secrets.js";
import {
  findHostProtocol,
  listHostProtocols,
  plainFieldKeys,
  secretFieldKeys,
  type DeclaredHostProtocol,
} from "./registry.js";
import type { ProtocolAuthSummary } from "./summary.js";

export type { ProtocolAuthSummary } from "./summary.js";

export const PROTOCOL_AUTH_TYPES = ["direct", "credential", "none"] as const;
export type ProtocolAuthType = (typeof PROTOCOL_AUTH_TYPES)[number];

/** One protocol's login as a client sends it. Absent keys keep what is stored. */
export interface ProtocolAuthInput {
  authType?: unknown;
  credentialId?: unknown;
  username?: unknown;
  password?: unknown;
  fields?: Record<string, unknown>;
}

/** Protocol id to its new login, or null to remove it. */
export type ProtocolAuthPatch = Map<string, ProtocolAuthInput | null>;

/** A login ready to hand to the program that connects. */
export interface ResolvedProtocolLogin {
  authType: string;
  username: string;
  password: string;
  fields: Record<string, string>;
}

export class ProtocolAuthWriteError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ProtocolAuthWriteError";
  }
}

/** The owner's data key; throws while it is locked. */
function ownerKey(ownerId: string): Buffer {
  const dek = DataCrypto.getUserDataKey(ownerId);
  if (!dek) throw new Error(`The data key of ${ownerId} is locked`);
  return dek;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function asCredentialId(value: unknown): number | null {
  const id = typeof value === "string" ? Number(value) : value;
  return typeof id === "number" && Number.isInteger(id) && id > 0 ? id : null;
}

function asAuthType(value: unknown): ProtocolAuthType | undefined {
  return PROTOCOL_AUTH_TYPES.includes(value as ProtocolAuthType)
    ? (value as ProtocolAuthType)
    : undefined;
}

/**
 * The flat keys a 2.8 client or export used for a protocol:
 * `<id>User`, `<id>Password`, `<id>CredentialId`, `<id>AuthType` and
 * `<id><Field>` for each declared field.
 */
function legacyInput(
  hostData: Record<string, unknown>,
  protocol: DeclaredHostProtocol,
): ProtocolAuthInput | null | undefined {
  const prefix = protocol.id.replace(/-([a-z0-9])/g, (_, c: string) =>
    c.toUpperCase(),
  );
  const key = (suffix: string) => `${prefix}${suffix}`;
  const has = (name: string) =>
    Object.prototype.hasOwnProperty.call(hostData, name);
  const fieldKeys = (protocol.credentialFields ?? []).map((field) => field.key);
  const names = [
    key("User"),
    key("Password"),
    key("CredentialId"),
    key("AuthType"),
    ...fieldKeys.map((field) => key(capitalize(field))),
  ];
  if (!names.some(has)) return undefined;

  const input: ProtocolAuthInput = {};
  if (has(key("AuthType"))) input.authType = hostData[key("AuthType")];
  if (has(key("CredentialId"))) {
    input.credentialId = hostData[key("CredentialId")];
  }
  if (has(key("User"))) input.username = hostData[key("User")];
  if (has(key("Password"))) {
    // A 2.8 editor sent null for "leave the saved password alone".
    const password = hostData[key("Password")];
    if (password) input.password = password;
  }
  const fields: Record<string, unknown> = {};
  for (const field of fieldKeys) {
    const name = key(capitalize(field));
    if (has(name)) fields[field] = hostData[name];
  }
  if (Object.keys(fields).length) input.fields = fields;

  // A 2.8 editor cleared a protocol it switched off by sending nulls.
  if (
    has(key("AuthType")) &&
    input.authType == null &&
    !input.username &&
    !input.password &&
    !input.credentialId &&
    Object.values(fields).every((value) => !value)
  ) {
    return null;
  }
  return input;
}

/**
 * The protocol logins a host write carries: `protocolAuth` keyed by
 * protocol id, or the flat fields a 2.8 client sends. Null when it carries
 * none, which leaves every stored login alone.
 */
export function readProtocolAuthPayload(
  hostData: Record<string, unknown>,
): ProtocolAuthPatch | null {
  const patch: ProtocolAuthPatch = new Map();
  if (isObject(hostData.protocolAuth)) {
    for (const [id, value] of Object.entries(hostData.protocolAuth)) {
      if (!findHostProtocol(id)) continue;
      if (value === null) patch.set(id, null);
      else if (isObject(value)) patch.set(id, value as ProtocolAuthInput);
    }
  } else {
    for (const protocol of listHostProtocols()) {
      const input = legacyInput(hostData, protocol);
      if (input !== undefined) patch.set(protocol.id, input);
    }
  }
  return patch.size ? patch : null;
}

/** Folds a client's input over the stored login. Pure. */
export function mergeProtocolLogin(
  protocolId: string,
  declared: DeclaredHostProtocol | undefined,
  current: HostProtocolLogin | null,
  input: ProtocolAuthInput,
): HostProtocolLogin {
  const inputCredential =
    input.credentialId === undefined
      ? undefined
      : asCredentialId(input.credentialId);
  const authType: ProtocolAuthType =
    asAuthType(input.authType) ??
    (input.authType === undefined
      ? asAuthType(current?.authType)
      : undefined) ??
    (inputCredential ? "credential" : "direct");

  const credentialId =
    authType === "credential"
      ? inputCredential !== undefined
        ? inputCredential
        : (current?.credentialId ?? null)
      : null;

  const direct = authType === "direct";
  const username = direct
    ? input.username !== undefined
      ? str(input.username) || null
      : (current?.username ?? null)
    : null;
  // An empty password keeps the saved one, as 2.8 did: the editor never
  // shows it, and a shared editor cannot see whether one is set.
  const password = direct
    ? str(input.password) || (current?.password ?? null)
    : null;

  const incoming = isObject(input.fields) ? input.fields : {};
  const pick = (
    keys: string[],
    stored: Record<string, string>,
    keepEmpty: boolean,
  ): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const key of keys) {
      const given = Object.prototype.hasOwnProperty.call(incoming, key)
        ? str(incoming[key])
        : "";
      const value =
        given ||
        (keepEmpty || !Object.prototype.hasOwnProperty.call(incoming, key)
          ? (stored[key] ?? "")
          : "");
      if (value) out[key] = value;
    }
    return out;
  };

  return {
    protocol: protocolId,
    authType,
    credentialId,
    username,
    password,
    fields: declared
      ? pick(plainFieldKeys(declared), current?.fields ?? {}, false)
      : {},
    secretFields: declared
      ? pick(secretFieldKeys(declared), current?.secretFields ?? {}, true)
      : {},
  };
}

function isEmptyLogin(login: HostProtocolLogin): boolean {
  return (
    login.authType === "direct" &&
    !login.username &&
    !login.password &&
    Object.keys(login.fields).length === 0 &&
    Object.keys(login.secretFields).length === 0
  );
}

export type PlannedProtocolAuth = Array<[string, HostProtocolLogin | null]>;

/**
 * Works out a host write's protocol logins without writing them. A shared
 * editor works on the owner's record but may not point a login at a
 * different credential, which throws a 403 before anything is written.
 */
export async function planProtocolAuthWrite(
  ownerId: string,
  hostId: number,
  patch: ProtocolAuthPatch,
  options: { isOwner: boolean },
): Promise<PlannedProtocolAuth> {
  const repository = createCurrentHostProtocolAuthRepository();
  const dek = ownerKey(ownerId);

  const planned: PlannedProtocolAuth = [];
  for (const [protocolId, input] of patch) {
    const current = await repository.find(hostId, protocolId, dek);
    const next =
      input === null
        ? null
        : mergeProtocolLogin(
            protocolId,
            findHostProtocol(protocolId),
            current,
            input,
          );
    if (
      !options.isOwner &&
      (next?.credentialId ?? null) !== (current?.credentialId ?? null)
    ) {
      throw new ProtocolAuthWriteError(
        `Only the host owner can change the ${protocolId} credential`,
        403,
      );
    }
    planned.push([protocolId, next && isEmptyLogin(next) ? null : next]);
  }
  return planned;
}

export async function applyProtocolAuthPlan(
  ownerId: string,
  hostId: number,
  planned: PlannedProtocolAuth,
): Promise<void> {
  const repository = createCurrentHostProtocolAuthRepository();
  const dek = ownerKey(ownerId);
  for (const [protocolId, next] of planned) {
    if (next) await repository.upsert(ownerId, hostId, next, dek);
    else await repository.delete(hostId, protocolId);
  }
}

export async function writeProtocolAuth(
  ownerId: string,
  hostId: number,
  patch: ProtocolAuthPatch,
  options: { isOwner: boolean },
): Promise<void> {
  await applyProtocolAuthPlan(
    ownerId,
    hostId,
    await planProtocolAuthWrite(ownerId, hostId, patch, options),
  );
}

/**
 * An import names credentials by another server's ids. Any the importing
 * user cannot use falls back to a direct login.
 */
export async function keepUsableProtocolCredentials(
  patch: ProtocolAuthPatch,
  userId: string,
): Promise<ProtocolAuthPatch> {
  const out: ProtocolAuthPatch = new Map();
  for (const [protocol, input] of patch) {
    const credentialId = asCredentialId(input?.credentialId);
    if (
      input &&
      credentialId &&
      !(await findUsableCredential(credentialId, userId))
    ) {
      out.set(protocol, {
        ...input,
        credentialId: null,
        authType: input.authType === "credential" ? "direct" : input.authType,
      });
    } else {
      out.set(protocol, input);
    }
  }
  return out;
}

/** The first username a write's logins carry, for a host with no SSH username. */
export function firstProtocolUsername(patch: ProtocolAuthPatch | null): string {
  for (const input of patch?.values() ?? []) {
    const username = str(input?.username);
    if (username) return username;
  }
  return "";
}

/** Replaces every login of a host with the given ones, as a sync or import does. */
export async function replaceProtocolLogins(
  ownerId: string,
  hostId: number,
  logins: HostProtocolLogin[],
): Promise<void> {
  const repository = createCurrentHostProtocolAuthRepository();
  const dek = ownerKey(ownerId);
  const keep = new Set<string>();
  for (const login of logins) {
    keep.add(login.protocol);
    if (isEmptyLogin(login)) await repository.delete(hostId, login.protocol);
    else await repository.upsert(ownerId, hostId, login, dek);
  }
  for (const row of await repository.listRowsForHost(hostId)) {
    if (!keep.has(row.protocol)) await repository.delete(hostId, row.protocol);
  }
}

/** Every login of a host, decrypted with its owner's key. */
export async function listProtocolLogins(
  hostId: number,
  ownerId: string,
): Promise<HostProtocolLogin[]> {
  const dek = ownerKey(ownerId);
  return createCurrentHostProtocolAuthRepository().listForHost(hostId, dek);
}

function summarize(
  row: HostProtocolAuthRecord,
  dek: Buffer | null,
): ProtocolAuthSummary {
  const login = dek ? decryptProtocolLogin(row, dek) : null;
  let fields: Record<string, string> = {};
  try {
    const parsed = row.fields ? JSON.parse(row.fields) : {};
    if (isObject(parsed)) {
      fields = Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
    }
  } catch {
    fields = {};
  }
  return {
    authType: row.authType || "direct",
    credentialId: row.credentialId ?? null,
    username: row.username ?? null,
    fields,
    hasPassword: !!row.password,
    secretFieldKeys: login ? Object.keys(login.secretFields) : [],
  };
}

/** Browser-safe logins for a list of hosts, keyed by host id then protocol. */
export async function loadProtocolAuthSummaries(
  hosts: Array<Record<string, unknown>>,
): Promise<Map<number, Record<string, ProtocolAuthSummary>>> {
  const ids = hosts
    .map((host) => Number(host.id))
    .filter((id) => Number.isInteger(id) && id > 0);
  const result = new Map<number, Record<string, ProtocolAuthSummary>>();
  if (ids.length === 0) return result;
  const rows =
    await createCurrentHostProtocolAuthRepository().listRowsForHosts(ids);
  const keys = new Map<string, Buffer | null>();
  for (const row of rows) {
    if (!keys.has(row.userId)) {
      keys.set(row.userId, DataCrypto.getUserDataKey(row.userId));
    }
    const own = result.get(row.hostId) ?? {};
    own[row.protocol] = summarize(row, keys.get(row.userId) ?? null);
    result.set(row.hostId, own);
  }
  return result;
}

/** Sets `protocolAuth` on each host from the loaded summaries. */
export function attachProtocolAuth(
  hosts: Array<Record<string, unknown>>,
  summaries: Map<number, Record<string, ProtocolAuthSummary>>,
): void {
  for (const host of hosts) {
    host.protocolAuth = summaries.get(Number(host.id)) ?? {};
  }
}

export async function withProtocolAuth<T extends Record<string, unknown>>(
  host: T,
): Promise<T> {
  attachProtocolAuth([host], await loadProtocolAuthSummaries([host]));
  return host;
}

async function openReference(userId: string, value: string): Promise<string> {
  return isSecretReference(value)
    ? resolveSecretReference(userId, value)
    : value;
}

function withDeclaredFields(
  declared: DeclaredHostProtocol,
  ...sources: Array<Record<string, string> | undefined>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of declared.credentialFields ?? []) {
    out[field.key] = "";
    for (const source of sources) {
      if (source?.[field.key]) {
        out[field.key] = source[field.key];
        break;
      }
    }
  }
  return out;
}

/** The owner's own login: the stored one, or the credential it points at. */
export async function resolveOwnerProtocolLogin(
  host: Record<string, unknown>,
  declared: DeclaredHostProtocol,
): Promise<ResolvedProtocolLogin> {
  const hostId = Number(host.id);
  const ownerId = String(host.userId);
  const dek = ownerKey(ownerId);
  const login = await createCurrentHostProtocolAuthRepository().find(
    hostId,
    declared.id,
    dek,
  );

  const authType = login?.authType || "direct";
  let username = login?.username ?? "";
  let password = login?.password ?? "";
  if (authType === "credential" && login?.credentialId) {
    const credential = await findUsableCredential(login.credentialId, ownerId);
    // Only the login itself comes from a stored credential, never the fields.
    if (credential?.username) username = credential.username;
    if (credential?.password) password = credential.password;
  }

  const fallback = declared.hostLoginFallback ?? [];
  if (fallback.includes("username")) username ||= str(host.username);
  if (fallback.includes("password")) password ||= str(host.password);

  const secretFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(login?.secretFields ?? {})) {
    secretFields[key] = await openReference(ownerId, value);
  }

  return {
    authType,
    username,
    password: password ? await openReference(ownerId, password) : "",
    fields: withDeclaredFields(declared, secretFields, login?.fields),
  };
}

/**
 * A shared recipient's login: their own override credential, the owner's
 * shared snapshot, or nothing. Never the owner's stored secret.
 */
export async function resolveRecipientProtocolLogin(
  host: Record<string, unknown>,
  userId: string,
  declared: DeclaredHostProtocol,
): Promise<ResolvedProtocolLogin> {
  const hostId = Number(host.id);
  const { resolveRecipientSharedHostAuthentication } =
    await import("../../utils/shared-host-auth-resolver.js");
  const row = await createCurrentHostProtocolAuthRepository().findRow(
    hostId,
    declared.id,
  );
  const ownerFields = row ? summarize(row, null).fields : {};

  let resolution: Awaited<
    ReturnType<typeof resolveRecipientSharedHostAuthentication>
  >;
  try {
    resolution = await resolveRecipientSharedHostAuthentication(
      { ...host, password: null } as never,
      hostId,
      userId,
      declared.id,
    );
  } catch {
    resolution = { source: "required" };
  }

  if (resolution.source === "personal-override") {
    return {
      authType: "credential",
      username: str(resolution.credential.username),
      password: str(resolution.credential.password),
      fields: withDeclaredFields(declared, ownerFields),
    };
  }
  if (resolution.source === "owner-shared") {
    return {
      authType: resolution.authType,
      username: str(resolution.secret?.username),
      password: str(resolution.secret?.password),
      fields: withDeclaredFields(
        declared,
        resolution.secret?.fields,
        ownerFields,
      ),
    };
  }
  return {
    authType:
      resolution.source === "secretless" && row?.authType === "none"
        ? "none"
        : "direct",
    username: "",
    password: "",
    fields: withDeclaredFields(declared, ownerFields),
  };
}

/** Credential ids a recipient chose for this host, per protocol. */
export async function listRecipientOverrideIds(
  hostId: number,
  userId: string,
): Promise<Record<string, number>> {
  return (await createCurrentSharedHostAuthOverrideRepository().listCredentialIds(
    hostId,
    userId,
  )) as Record<string, number>;
}

/** A login in an export or on the sync wire: plaintext, keyed by protocol. */
export interface PortableProtocolLogin {
  authType: string;
  credentialId: number | null;
  username: string | null;
  password: string | null;
  fields: Record<string, string>;
}

export function toPortableLogins(
  logins: HostProtocolLogin[],
): Record<string, PortableProtocolLogin> {
  const out: Record<string, PortableProtocolLogin> = {};
  for (const login of logins) {
    out[login.protocol] = {
      authType: login.authType,
      credentialId: login.credentialId,
      username: login.username,
      password: login.password,
      fields: { ...login.fields, ...login.secretFields },
    };
  }
  return out;
}

/**
 * Reads a login back from an export or the wire. Fields are split by the
 * protocol's declaration; an undeclared protocol keeps every field secret.
 */
export function fromPortableLogin(
  protocolId: string,
  value: unknown,
  credentialId: number | null,
): HostProtocolLogin | null {
  if (!isObject(value)) return null;
  const declared = findHostProtocol(protocolId);
  const secret = new Set(declared ? secretFieldKeys(declared) : []);
  const plain = new Set(declared ? plainFieldKeys(declared) : []);
  const fields: Record<string, string> = {};
  const secretFields: Record<string, string> = {};
  if (isObject(value.fields)) {
    for (const [key, entry] of Object.entries(value.fields)) {
      if (typeof entry !== "string" || !entry) continue;
      if (plain.has(key)) fields[key] = entry;
      else if (secret.has(key) || !declared) secretFields[key] = entry;
    }
  }
  const authType = asAuthType(value.authType) ?? "direct";
  return {
    protocol: protocolId,
    authType,
    credentialId: authType === "credential" ? credentialId : null,
    username: str(value.username) || null,
    password: str(value.password) || null,
    fields,
    secretFields,
  };
}
