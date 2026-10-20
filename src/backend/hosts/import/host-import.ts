import {
  prepareHostImports,
  remapImportedJumpHosts,
} from "../../database/routes/host-import-order.js";
import { sshOptionsForWrite } from "../ssh-options.js";
import {
  applyDefaultsAfterHostWrites,
  applyHostDefaultsToWrite,
} from "../defaults/index.js";
import {
  keepUsableProtocolCredentials,
  readProtocolAuthPayload,
  writeProtocolAuth,
} from "../protocol-auth/protocol-auth.js";
import { getErrorMessage } from "../../utils/error-message.js";
import { pluginEvents, TOPICS } from "../../plugins/events.js";
import {
  createCurrentCredentialRepository,
  createCurrentHostRepository,
  createCurrentHostResolutionRepository,
  createCurrentHostDefaultsRepository,
} from "../../database/repositories/factory.js";
import {
  listSshAuthProviders,
  listSshAuthTypeOwners,
} from "../connect/auth-provider-registry.js";
import { applyPluginHostImportSettings } from "../../database/routes/host-plugin-settings.js";
import {
  isNonEmptyString,
  isValidPort,
  normalizeImportedHost,
} from "../../database/routes/host-normalizers.js";
import { hasHostLocks, hostLock, manualCreateBlockedBy } from "../locks.js";

/** A request the caller got wrong. Routes answer it with a 400. */
export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

export interface ImportResults {
  success: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: string[];
  /** Hosts this call created. */
  createdHostIds: number[];
  /** True when atomic was set and a failure undid the creates. */
  rolledBack?: boolean;
}

export interface BulkImportInput {
  hosts: unknown;
  overwrite?: unknown;
  credentials?: unknown;
  /** All or nothing: any failure deletes what this call created. */
  atomic?: boolean;
}

type SSHConfigHost = {
  name: string;
  hostname?: string;
  user?: string;
  port?: number;
  identityFile?: string;
  proxyJump?: string;
};

type ShareCredential = {
  alias?: unknown;
  name?: unknown;
  description?: unknown;
  folder?: unknown;
  tags?: unknown;
  authType?: unknown;
  username?: unknown;
  keyType?: unknown;
};

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function tagString(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((tag) => textValue(tag))
      .filter((tag): tag is string => !!tag)
      .join(",");
  }
  return textValue(value) || "";
}

function normalizeCredentialAuthType(value: unknown): "password" | "key" {
  return value === "key" ? "key" : "password";
}

export function parseSSHConfig(content: string): SSHConfigHost[] {
  const results: SSHConfigHost[] = [];
  let current: SSHConfigHost | null = null;

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = /^(\S+?)(?:\s*=\s*|\s+)(.+)$/.exec(line);
    if (!match) continue;

    const key = match[1].toLowerCase();
    const value = match[2];

    if (key === "host") {
      if (current && current.hostname) results.push(current);
      // Skip wildcard patterns
      if (value === "*" || value.includes("*") || value.includes("?")) {
        current = null;
      } else {
        current = { name: value };
      }
      continue;
    }

    if (!current) continue;

    switch (key) {
      case "hostname":
        current.hostname = value;
        break;
      case "user":
        current.user = value;
        break;
      case "port": {
        const p = Number.parseInt(value, 10);
        if (p > 0 && p <= 65535) current.port = p;
        break;
      }
      case "identityfile":
        if (!current.identityFile) current.identityFile = value;
        break;
      case "proxyjump":
        current.proxyJump = value;
        break;
    }
  }

  if (current && current.hostname) results.push(current);

  return results;
}

/**
 * Tells status checks and other pollers about hosts an import wrote, the way
 * a single host create or update does.
 */
export function notifyImportedHosts(
  userId: string,
  hostIds: number[],
  createdHostIds: number[],
): void {
  for (const hostId of createdHostIds) {
    pluginEvents.emit(TOPICS.hostCreated, { hostId, userId });
  }
  for (const hostId of hostIds) {
    pluginEvents.emit(TOPICS.hostUpdated, { hostId, userId });
  }
}

export function importedHostUsername(
  connectionType: string,
  authType: unknown,
  username: unknown,
): string | null {
  if (isNonEmptyString(username)) return username;
  if (connectionType !== "ssh" || authType === "credential") return "";
  return null;
}

/**
 * Status check fields from an import row. Exports from before 2.9.0 carried
 * them inside statsConfig.
 */
function importedStatusCheck(raw: Record<string, unknown>): {
  statusCheckEnabled: boolean;
  statusCheckInterval: number | null;
} {
  const legacy =
    raw.statsConfig && typeof raw.statsConfig === "object"
      ? (raw.statsConfig as Record<string, unknown>)
      : {};
  const enabled = raw.statusCheckEnabled ?? legacy.statusCheckEnabled;
  const useGlobal = legacy.useGlobalStatusInterval !== false;
  const interval =
    raw.statusCheckInterval ?? (useGlobal ? null : legacy.statusCheckInterval);
  const seconds = Number(interval);
  return {
    statusCheckEnabled: enabled !== false && legacy.disableTcpPing !== true,
    statusCheckInterval:
      interval != null && Number.isInteger(seconds) && seconds >= 5
        ? seconds
        : null,
  };
}

const BUILTIN_SSH_AUTH_TYPES = [
  "password",
  "key",
  "credential",
  "agent",
  "none",
];

/** Core's own types plus every type a plugin registers or declares. */
function listKnownAuthTypes(): Set<string> {
  return new Set([
    ...BUILTIN_SSH_AUTH_TYPES,
    ...listSshAuthProviders().map((provider) => provider.type),
    ...listSshAuthTypeOwners().map((owner) => owner.type),
  ]);
}

/** Fills an imported host's inherited keys and records what it sets itself. */
async function withHostDefaults(
  userId: string,
  hostId: number | null,
  columns: Record<string, unknown>,
  body: Record<string, unknown>,
): Promise<void> {
  const stored =
    hostId === null
      ? null
      : ((
          await createCurrentHostDefaultsRepository().listHosts({
            hostIds: [hostId],
          })
        )[0] ?? null);
  columns.defaultOverrides = JSON.stringify(
    await applyHostDefaultsToWrite({
      ownerId: userId,
      hostId,
      columns,
      body,
      stored,
    }),
  );
}

export function importSummary(results: ImportResults): string {
  return `Import completed: ${results.success} created, ${results.updated} updated, ${results.skipped} skipped, ${results.failed} failed`;
}

export function importResponse(results: ImportResults) {
  return {
    message: importSummary(results),
    success: results.success,
    updated: results.updated,
    skipped: results.skipped,
    failed: results.failed,
    errors: results.errors,
  };
}

export const MAX_IMPORT_HOSTS = 100;

/** Why an import row can't be written while a plugin manages hosts, if it can't. */
function importLockError(existingId: number | undefined): string | null {
  if (!hasHostLocks()) return null;
  if (existingId === undefined) {
    const blocked = manualCreateBlockedBy();
    return blocked
      ? `Hosts are managed by ${blocked.pluginName}, so new hosts can't be added`
      : null;
  }
  const lock = hostLock(existingId);
  return lock ? `This host is managed by ${lock.pluginName}` : null;
}

/** Deletes what an atomic import created, newest first. */
async function rollBackCreated(
  userId: string,
  results: ImportResults,
): Promise<void> {
  const repository = createCurrentHostRepository();
  for (const hostId of [...results.createdHostIds].reverse()) {
    await repository.deleteForUser(userId, hostId).catch(() => {});
  }
  results.rolledBack = true;
  results.success = 0;
  results.createdHostIds = [];
}

/**
 * The Termix JSON import: shared by POST /host/bulk-import and
 * ctx.hosts.importMany. Callers wrap it in DatabaseSaveTrigger.batched.
 */
export async function runBulkImport(
  userId: string,
  input: BulkImportInput,
): Promise<ImportResults> {
  const {
    hosts: hostsToImport,
    overwrite,
    credentials: credentialsToImport,
  } = input;
  if (input.atomic && overwrite) {
    throw new ImportError("An atomic import cannot overwrite existing hosts");
  }

  if (!Array.isArray(hostsToImport) || hostsToImport.length === 0) {
    throw new ImportError("Hosts array is required and must not be empty");
  }

  if (hostsToImport.length > 100) {
    throw new ImportError("Maximum 100 hosts allowed per import");
  }

  let orderedHosts: ReturnType<typeof prepareHostImports>;
  try {
    orderedHosts = prepareHostImports(hostsToImport);
  } catch (error) {
    throw new ImportError(getErrorMessage(error));
  }
  const importedIds = new Map<unknown, number>();

  const results: ImportResults = {
    success: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    createdHostIds: [],
  };

  const credentialAliasMap = new Map<string, number>();
  const addCredentialAlias = (alias: unknown, id: number) => {
    const key = textValue(alias);
    if (key) credentialAliasMap.set(key.toLowerCase(), id);
  };

  try {
    const credentialRepository = createCurrentCredentialRepository();
    const existingCredentials =
      await credentialRepository.listDecryptedByUserId(userId);

    for (const credential of existingCredentials) {
      addCredentialAlias(credential.name, credential.id as number);
    }

    if (Array.isArray(credentialsToImport)) {
      for (const rawCredential of credentialsToImport as ShareCredential[]) {
        const alias = textValue(rawCredential.alias);
        const name = textValue(rawCredential.name) || alias;
        if (!alias || !name) continue;

        const existingId = credentialAliasMap.get(name.toLowerCase());
        if (existingId) {
          addCredentialAlias(alias, existingId);
          continue;
        }

        const now = new Date().toISOString();
        const created = await credentialRepository.createEncryptedForUser(
          userId,
          {
            userId,
            name,
            description:
              textValue(rawCredential.description) ||
              "Imported placeholder. Add the secret before connecting.",
            folder: textValue(rawCredential.folder),
            tags: tagString(rawCredential.tags),
            authType: normalizeCredentialAuthType(rawCredential.authType),
            username: textValue(rawCredential.username),
            password: null,
            key: null,
            privateKey: null,
            publicKey: null,
            keyPassword: null,
            keyType: textValue(rawCredential.keyType),
            detectedKeyType: null,
            usageCount: 0,
            lastUsed: null,
            createdAt: now,
            updatedAt: now,
          },
        );

        const createdCredential = created as Record<string, unknown>;
        addCredentialAlias(alias, createdCredential.id as number);
        addCredentialAlias(name, createdCredential.id as number);
      }
    }
  } catch (error) {
    results.errors.push(
      `Credential placeholders: ${getErrorMessage(error, "failed to prepare credential aliases")}`,
    );
  }

  // Loaded for both modes: overwrite updates a match, skip leaves it alone.
  let existingHostMap: Map<string, { id: number }> | undefined;
  const hostRepository = createCurrentHostRepository();
  try {
    const allHosts =
      await createCurrentHostResolutionRepository().findHostsByUserId(userId);
    existingHostMap = new Map();
    for (const h of allHosts) {
      const key = `${h.ip}:${h.port}:${h.username}`;
      existingHostMap.set(key, { id: h.id as number });
    }
  } catch {
    existingHostMap = undefined;
  }

  const knownAuthTypes = listKnownAuthTypes();
  const writtenHostIds: number[] = [];
  const createdHostIds: number[] = [];
  for (const { host: hostData, index: i, exportId } of orderedHosts) {
    try {
      const effectiveConnectionType = hostData.connectionType || "ssh";

      if (
        effectiveConnectionType === "ssh" &&
        hostData.authType === "credential" &&
        !hostData.credentialId &&
        hostData.credentialAlias
      ) {
        hostData.credentialId = credentialAliasMap.get(
          hostData.credentialAlias.toLowerCase(),
        );
      }

      if (!isNonEmptyString(hostData.ip) || !isValidPort(hostData.port)) {
        results.failed++;
        results.errors.push(
          `Host ${i + 1}: Missing required fields (ip, port)`,
        );
        continue;
      }

      const username = importedHostUsername(
        effectiveConnectionType,
        hostData.authType,
        hostData.username,
      );
      if (username === null) {
        results.failed++;
        results.errors.push(
          `Host ${i + 1}: Username required for SSH connections`,
        );
        continue;
      }

      const lookupKey = `${hostData.ip}:${hostData.port}:${hostData.username}`;
      const existing = existingHostMap?.get(lookupKey);
      if (existing && !overwrite) {
        // Hosts that jump through this one still resolve to the kept host.
        if (exportId !== undefined) importedIds.set(exportId, existing.id);
        results.skipped++;
        continue;
      }
      const locked = importLockError(existing?.id);
      if (locked) {
        results.failed++;
        results.errors.push(`Host ${i + 1}: ${locked}`);
        continue;
      }

      if (
        effectiveConnectionType === "ssh" &&
        hostData.authType &&
        !knownAuthTypes.has(hostData.authType)
      ) {
        results.failed++;
        results.errors.push(
          `Host ${i + 1}: Invalid authType. Must be one of ${[...knownAuthTypes].join(", ")}`,
        );
        continue;
      }

      if (
        effectiveConnectionType === "ssh" &&
        hostData.authType === "password" &&
        !isNonEmptyString(hostData.password)
      ) {
        results.failed++;
        results.errors.push(
          `Host ${i + 1}: Password required for password authentication`,
        );
        continue;
      }

      if (
        effectiveConnectionType === "ssh" &&
        hostData.authType === "key" &&
        !isNonEmptyString(hostData.key)
      ) {
        results.failed++;
        results.errors.push(
          `Host ${i + 1}: Key required for key authentication`,
        );
        continue;
      }

      if (
        effectiveConnectionType === "ssh" &&
        hostData.authType === "credential" &&
        !hostData.credentialId
      ) {
        results.failed++;
        results.errors.push(
          `Host ${i + 1}: credentialId required for credential authentication`,
        );
        continue;
      }

      if (
        effectiveConnectionType === "ssh" &&
        hostData.authType === "credential" &&
        hostData.credentialId
      ) {
        const credentialRepository = createCurrentCredentialRepository();
        const cred = await credentialRepository.findByIdForUser(
          userId,
          hostData.credentialId,
        );

        if (!cred) {
          const fallback = await credentialRepository.listByUserId(userId);

          if (fallback.length > 0) {
            hostData.credentialId = fallback[0].id;
          } else if (isNonEmptyString(hostData.key)) {
            hostData.authType = "key";
            hostData.credentialId = undefined;
          } else if (isNonEmptyString(hostData.password)) {
            hostData.authType = "password";
            hostData.credentialId = undefined;
          } else {
            results.failed++;
            results.errors.push(
              `Host ${i + 1}: credentialId ${hostData.credentialId} not found and no fallback credential available`,
            );
            continue;
          }
        }
      }

      const jumpHosts = remapImportedJumpHosts(hostData.jumpHosts, importedIds);
      const sshDataObj: Record<string, unknown> = {
        userId: userId,
        connectionType: effectiveConnectionType,
        name: hostData.name || `${username}@${hostData.ip}`,
        folder: hostData.folder || "Default",
        tags: Array.isArray(hostData.tags) ? hostData.tags.join(",") : "",
        ip: hostData.ip,
        port: hostData.port,
        username,
        pin: hostData.pin || false,
        sudoPassword: hostData.sudoPassword || null,
        jumpHosts: jumpHosts ? JSON.stringify(jumpHosts) : null,
        ...importedStatusCheck(hostData as Record<string, unknown>),
        // A 2.8 export carries these inside terminalConfig.
        sshOptions:
          sshOptionsForWrite({
            sshOptions: hostData.sshOptions,
            terminalConfig: hostData.terminalConfig,
          }) ?? null,
        forceKeyboardInteractive: hostData.forceKeyboardInteractive
          ? "true"
          : "false",
        notes: hostData.notes || null,
        useSocks5: hostData.useSocks5 ? 1 : 0,
        socks5Host: hostData.socks5Host || null,
        socks5Port: hostData.socks5Port || null,
        socks5Username: hostData.socks5Username || null,
        socks5Password: hostData.socks5Password || null,
        socks5ProxyChain: hostData.socks5ProxyChain
          ? JSON.stringify(hostData.socks5ProxyChain)
          : null,
        portKnockSequence: hostData.portKnockSequence
          ? JSON.stringify(hostData.portKnockSequence)
          : null,
        overrideCredentialUsername: hostData.overrideCredentialUsername ? 1 : 0,
        enableSsh: hostData.enableSsh ?? effectiveConnectionType === "ssh",
        updatedAt: new Date().toISOString(),
      };

      if (effectiveConnectionType !== "ssh") {
        sshDataObj.password = hostData.password || null;
        sshDataObj.authType = "password";
        sshDataObj.credentialId = null;
        sshDataObj.key = null;
        sshDataObj.keyPassword = null;
        sshDataObj.keyType = null;
      } else {
        sshDataObj.password =
          hostData.authType === "password" ? hostData.password : null;
        sshDataObj.authType = hostData.authType || "password";
        sshDataObj.credentialId =
          hostData.authType === "credential" ? hostData.credentialId : null;
        sshDataObj.key = hostData.authType === "key" ? hostData.key : null;
        sshDataObj.keyPassword =
          hostData.authType === "key" ? hostData.keyPassword || null : null;
        sshDataObj.keyType =
          hostData.authType === "key" ? hostData.keyType || "auto" : null;
      }

      await withHostDefaults(
        userId,
        existing?.id ?? null,
        sshDataObj,
        hostData as Record<string, unknown>,
      );

      let savedHostId: number;
      if (existing) {
        const saved = await hostRepository.updateEncryptedForUser(
          userId,
          existing.id,
          sshDataObj,
        );
        if (!saved) throw new Error("Host no longer exists");
        if (exportId !== undefined) importedIds.set(exportId, existing.id);
        savedHostId = existing.id;
        results.updated++;
      } else {
        sshDataObj.createdAt = new Date().toISOString();
        const saved = await hostRepository.createEncryptedForUser(
          userId,
          sshDataObj,
        );
        if (exportId !== undefined) importedIds.set(exportId, saved.id);
        savedHostId = saved.id;
        createdHostIds.push(saved.id);
        results.success++;
      }

      const protocolAuth = readProtocolAuthPayload(
        hostData as Record<string, unknown>,
      );
      if (protocolAuth) {
        await writeProtocolAuth(
          userId,
          savedHostId,
          await keepUsableProtocolCredentials(protocolAuth, userId),
          { isOwner: true },
        );
      }

      // Every enabled plugin that declares host-scope settings and
      // registered a hostImportNormalizer validates and writes its own
      // fields here, so this loop does not need to know which plugins
      // exist. See host-plugin-settings.ts.
      await applyPluginHostImportSettings(
        savedHostId,
        hostData as Record<string, unknown>,
      );
      writtenHostIds.push(savedHostId);
    } catch (error) {
      results.failed++;
      results.errors.push(`Host ${i + 1}: ${getErrorMessage(error)}`);
    }
  }

  results.createdHostIds = createdHostIds;
  if (input.atomic && results.failed > 0) {
    await rollBackCreated(userId, results);
    return results;
  }

  await applyDefaultsAfterHostWrites(writtenHostIds);
  notifyImportedHosts(userId, writtenHostIds, createdHostIds);
  results.createdHostIds = createdHostIds;
  return results;
}

/** The OpenSSH config import, shared by the route and ctx.hosts. */
export async function runSshConfigImport(
  userId: string,
  input: { content?: unknown; overwrite?: unknown; atomic?: boolean },
): Promise<ImportResults> {
  const { content, overwrite } = input;
  if (input.atomic && overwrite) {
    throw new ImportError("An atomic import cannot overwrite existing hosts");
  }

  if (!isNonEmptyString(content)) {
    throw new ImportError("content is required and must be a non-empty string");
  }

  let parsed: SSHConfigHost[];
  try {
    parsed = parseSSHConfig(content);
  } catch {
    throw new ImportError("Failed to parse SSH config file");
  }

  if (parsed.length === 0) {
    throw new ImportError("No valid Host entries found in the SSH config file");
  }

  if (parsed.length > 100) {
    throw new ImportError("Maximum 100 hosts allowed per import");
  }

  const hostsToImport = parsed.map((h) => ({
    name: h.name,
    ip: h.hostname,
    port: h.port ?? 22,
    username: h.user,
    authType: h.identityFile ? "key" : undefined,
    connectionType: "ssh",
    enableSsh: true,
    ...(h.proxyJump
      ? {
          jumpHosts: [{ host: h.proxyJump, port: 22 }],
        }
      : {}),
  }));

  const results: ImportResults = {
    success: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    createdHostIds: [],
  };

  let existingHostMap: Map<string, { id: number }> | undefined;
  const hostRepository = createCurrentHostRepository();
  try {
    const allHosts =
      await createCurrentHostResolutionRepository().findHostsByUserId(userId);
    existingHostMap = new Map();
    for (const h of allHosts) {
      const key = `${h.ip}:${h.port}:${h.username}`;
      existingHostMap.set(key, { id: h.id as number });
    }
  } catch {
    existingHostMap = undefined;
  }

  const writtenHostIds: number[] = [];
  const createdHostIds: number[] = [];
  for (let i = 0; i < hostsToImport.length; i++) {
    const hostData = normalizeImportedHost(
      hostsToImport[i] as Record<string, unknown>,
    );

    try {
      if (!isNonEmptyString(hostData.ip) || !isValidPort(hostData.port)) {
        results.failed++;
        results.errors.push(
          `Host "${parsed[i].name}": Missing required fields (HostName, Port)`,
        );
        continue;
      }

      const lookupKey = `${hostData.ip}:${hostData.port}:${hostData.username}`;
      const existing = existingHostMap?.get(lookupKey);
      if (existing && !overwrite) {
        results.skipped++;
        continue;
      }
      const locked = importLockError(existing?.id);
      if (locked) {
        results.failed++;
        results.errors.push(`Host "${parsed[i].name}": ${locked}`);
        continue;
      }

      const sshDataObj: Record<string, unknown> = {
        userId,
        connectionType: "ssh",
        name: hostData.name || hostData.ip,
        folder: "Default",
        tags: "",
        ip: hostData.ip,
        port: hostData.port,
        username: hostData.username || null,
        authType: hostData.authType || "none",
        password: null,
        key: null,
        keyPassword: null,
        keyType: null,
        credentialId: null,
        pin: false,
        sudoPassword: null,
        jumpHosts: hostData.jumpHosts
          ? JSON.stringify(hostData.jumpHosts)
          : null,
        statusCheckEnabled: true,
        statusCheckInterval: null,
        sshOptions: null,
        forceKeyboardInteractive: "false",
        notes: null,
        useSocks5: 0,
        socks5Host: null,
        socks5Port: null,
        socks5Username: null,
        socks5Password: null,
        socks5ProxyChain: null,
        portKnockSequence: null,
        overrideCredentialUsername: 0,
        enableSsh: true,
        updatedAt: new Date().toISOString(),
      };

      await withHostDefaults(
        userId,
        existing?.id ?? null,
        sshDataObj,
        hostData as unknown as Record<string, unknown>,
      );

      if (existing) {
        await hostRepository.updateEncryptedForUser(
          userId,
          existing.id,
          sshDataObj,
        );
        writtenHostIds.push(existing.id);
        results.updated++;
      } else {
        sshDataObj.createdAt = new Date().toISOString();
        const saved = await hostRepository.createEncryptedForUser(
          userId,
          sshDataObj,
        );
        writtenHostIds.push(saved.id);
        createdHostIds.push(saved.id);
        results.success++;
      }
    } catch (error) {
      results.failed++;
      results.errors.push(
        `Host "${parsed[i].name}": ${getErrorMessage(error)}`,
      );
    }
  }

  results.createdHostIds = createdHostIds;
  if (input.atomic && results.failed > 0) {
    await rollBackCreated(userId, results);
    return results;
  }

  await applyDefaultsAfterHostWrites(writtenHostIds);
  notifyImportedHosts(userId, writtenHostIds, createdHostIds);
  results.createdHostIds = createdHostIds;
  return results;
}
