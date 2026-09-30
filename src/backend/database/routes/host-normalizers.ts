import { parseDefaultOverrides } from "../../../types/host-defaults.js";
import {
  parseSshOptions,
  type HostSshOptions,
} from "../../hosts/ssh-options.js";
import { listHostProtocols } from "../../hosts/protocol-auth/registry.js";
import { sanitizeProtocolAuthForRecipient } from "../../hosts/protocol-auth/summary.js";

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isValidPort(port: unknown): port is number {
  return typeof port === "number" && port > 0 && port <= 65535;
}

export function isOptionalBoolean(
  value: unknown,
): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

export function applyHostKeyTypeUpdate(
  target: Record<string, unknown>,
  keyType: unknown,
): void {
  if (keyType !== undefined) {
    target.keyType = keyType || null;
  }
}

const PROTOCOL_ENABLE_FIELDS = ["enableSsh"] as const;

export function normalizeProtocolEnableFields(
  values: Record<string, unknown>,
): Partial<Record<(typeof PROTOCOL_ENABLE_FIELDS)[number], 0 | 1>> {
  return Object.fromEntries(
    PROTOCOL_ENABLE_FIELDS.flatMap((field) =>
      typeof values[field] === "boolean"
        ? [[field, values[field] ? 1 : 0]]
        : [],
    ),
  );
}

/**
 * The owner's SSH authentication, which a shared editor may not change. A
 * plugin protocol's login is guarded in writeProtocolAuth instead.
 */
export const OWNER_PRIVATE_AUTH_FIELDS = {
  ssh: [
    "authType",
    "authMethod",
    "credentialId",
    "overrideCredentialUsername",
    "shareSshAuth",
    "password",
    "key",
    "keyPassword",
    "keyType",
    "sudoPassword",
  ],
} as const;

export const OWNER_PRIVATE_TERMINAL_CONFIG_FIELDS = [
  "sudoPassword",
  "agentSocketPath",
] as const;

/** SSH options only the host's owner may change. */
export const OWNER_PRIVATE_SSH_OPTION_FIELDS = ["agentSocketPath"] as const;

export function containsOwnerPrivateAuthUpdate(
  hostData: Record<string, unknown>,
  protocol: keyof typeof OWNER_PRIVATE_AUTH_FIELDS,
): boolean {
  return OWNER_PRIVATE_AUTH_FIELDS[protocol].some((field) =>
    Object.prototype.hasOwnProperty.call(hostData, field),
  );
}

const FOLDER_PATH_SEPARATOR = " / ";

/**
 * Re-paths a folder string when its ancestor folder is renamed. Returns the new
 * path for an exact match or any nested child, or null when the path is unrelated.
 * Mirrors the SQL CASE expression used in the folder rename route.
 */
export function renameFolderPath(
  folderPath: string,
  oldName: string,
  newName: string,
): string | null {
  if (folderPath === oldName) return newName;
  const prefix = `${oldName}${FOLDER_PATH_SEPARATOR}`;
  if (folderPath.startsWith(prefix)) {
    return `${newName}${FOLDER_PATH_SEPARATOR}${folderPath.slice(prefix.length)}`;
  }
  return null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asPort(value: unknown): number | undefined {
  const port =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : NaN;

  return isValidPort(port) ? port : undefined;
}

function asInteger(value: unknown): number | undefined {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : NaN;

  return Number.isInteger(number) ? number : undefined;
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }

  return fallback;
}

function normalizeImportTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((tag) => asString(tag))
      .filter((tag): tag is string => !!tag);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  return [];
}

export type NormalizedImportedHost = Record<string, unknown> & {
  connectionType: string;
  name?: string;
  ip?: string;
  port: number;
  username?: string;
  folder?: string;
  tags: string[];
  authType?: string;
  password?: string;
  key?: string;
  keyPassword?: string;
  keyType?: string;
  credentialId?: number;
  credentialAlias?: string;
  pin?: unknown;
  sudoPassword?: unknown;
  jumpHosts?: unknown;
  statusCheckEnabled?: unknown;
  statusCheckInterval?: unknown;
  terminalConfig?: unknown;
  sshOptions?: unknown;
  forceKeyboardInteractive?: unknown;
  notes?: unknown;
  useSocks5?: unknown;
  socks5Host?: unknown;
  socks5Port?: unknown;
  socks5Username?: unknown;
  socks5Password?: unknown;
  socks5ProxyChain?: unknown;
  portKnockSequence?: unknown;
  overrideCredentialUsername?: unknown;
  enableSsh: boolean;
};

function legacyPrefix(protocolId: string): string {
  return protocolId.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function legacyKey(protocolId: string): string {
  const prefix = legacyPrefix(protocolId);
  return prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

export function normalizeImportedHost(
  hostData: Record<string, unknown>,
): NormalizedImportedHost {
  const credentialAlias =
    asString(hostData.credentialAlias) || asString(hostData.credentialName);
  // A row with no connectionType names its protocol the way a 2.8 export
  // did: an "enable<Protocol>" flag and a "<protocol>Port".
  const flagged = listHostProtocols().find((protocol) =>
    asBoolean(hostData[`enable${legacyKey(protocol.id)}`]),
  );
  const connectionType =
    asString(hostData.connectionType) || flagged?.id || "ssh";
  const protocol = listHostProtocols().find(
    (entry) => entry.id === connectionType,
  );

  const port =
    asPort(hostData.port) ||
    (protocol
      ? asPort(hostData[`${legacyPrefix(protocol.id)}Port`]) ||
        protocol.defaultPort ||
        22
      : asPort(hostData.sshPort) || 22);

  return {
    ...hostData,
    connectionType,
    name: asString(hostData.name) || asString(hostData.label),
    ip:
      asString(hostData.ip) ||
      asString(hostData.address) ||
      asString(hostData.host) ||
      asString(hostData.hostname),
    port,
    username: asString(hostData.username) || asString(hostData.user),
    folder: asString(hostData.folder) || asString(hostData.group),
    tags: normalizeImportTags(hostData.tags),
    credentialId: asInteger(hostData.credentialId),
    credentialAlias,
    authType:
      asString(hostData.authType) ||
      asString(hostData.authMethod) ||
      (hostData.credentialId || credentialAlias
        ? "credential"
        : hostData.key
          ? "key"
          : undefined),
    enableSsh:
      hostData.enableSsh === undefined
        ? connectionType === "ssh"
        : asBoolean(hostData.enableSsh),
  };
}

const SENSITIVE_FIELDS = [
  "key",
  "keyPassword",
  "password",
  "sudoPassword",
  "socks5Password",
];

export function stripSensitiveFields(
  host: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...host };
  const terminalConfigForSudo =
    host.terminalConfig &&
    typeof host.terminalConfig === "object" &&
    !Array.isArray(host.terminalConfig)
      ? (host.terminalConfig as Record<string, unknown>)
      : undefined;
  result.hasKey = !!host.key;
  result.hasKeyPassword = !!host.keyPassword;
  result.hasPassword = !!host.password;
  // 2.8 editors kept the sudo password inside terminal_config.
  result.hasSudoPassword =
    !!host.sudoPassword || !!terminalConfigForSudo?.sudoPassword;
  for (const field of SENSITIVE_FIELDS) {
    delete result[field];
  }
  if (
    result.terminalConfig &&
    typeof result.terminalConfig === "object" &&
    !Array.isArray(result.terminalConfig)
  ) {
    const terminalConfig = {
      ...(result.terminalConfig as Record<string, unknown>),
    };
    delete terminalConfig.sudoPassword;
    result.terminalConfig = terminalConfig;
  }
  return result;
}

// Connection essentials a connect-level recipient is allowed to see.
const CONNECT_LEVEL_FIELDS = new Set([
  "id",
  "userId",
  "ownerId",
  "ownerUsername",
  "isShared",
  "permissionLevel",
  "sharedExpiresAt",
  "name",
  "ip",
  "port",
  "username",
  "folder",
  "tags",
  "pin",
  "authType",
  "shareSshAuth",
  "authOverrides",
  "connectionType",
  "statusCheckEnabled",
  "statusCheckInterval",
  "enableSsh",
  "sshPort",
  "protocolAuth",
  "jumpHosts",
  "createdAt",
  "updatedAt",
]);

/**
 * Shapes a shared host row for its recipient. Secrets are always stripped
 * (all levels); connect-level recipients are additionally reduced to
 * connection essentials since they may not view the host's configuration.
 */
export function sanitizeHostForRecipient(
  host: Record<string, unknown>,
  permissionLevel: string | undefined,
): Record<string, unknown> {
  const stripped = stripSensitiveFields(host);
  delete stripped.credentialId;
  delete stripped.overrideCredentialUsername;
  // Sub-host nesting is per-owner tree structure; a recipient generally
  // can't see (or share permission on) the parent host row, so a shared
  // host always renders at root rather than leaking another host's id.
  delete stripped.parentHostId;
  for (const field of ["terminalConfig", "sshOptions"] as const) {
    const value = stripped[field];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const copy = { ...(value as Record<string, unknown>) };
      for (const key of OWNER_PRIVATE_SSH_OPTION_FIELDS) delete copy[key];
      stripped[field] = copy;
    }
  }
  const authOverrides =
    stripped.authOverrides &&
    typeof stripped.authOverrides === "object" &&
    !Array.isArray(stripped.authOverrides)
      ? (stripped.authOverrides as Record<string, unknown>)
      : undefined;
  const sshOverride =
    authOverrides?.ssh &&
    typeof authOverrides.ssh === "object" &&
    !Array.isArray(authOverrides.ssh)
      ? (authOverrides.ssh as Record<string, unknown>)
      : undefined;
  if (stripped.protocolAuth !== undefined) {
    stripped.protocolAuth = sanitizeProtocolAuthForRecipient(
      stripped.protocolAuth,
      permissionLevel,
    );
  }
  if (!sshOverride?.credentialId) {
    stripped.hasPassword = false;
    stripped.hasKey = false;
    stripped.hasKeyPassword = false;
    stripped.hasSudoPassword = false;
  }

  if (permissionLevel !== "connect") {
    return stripped;
  }

  const reduced: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stripped)) {
    if (CONNECT_LEVEL_FIELDS.has(key)) {
      reduced[key] = value;
    }
  }
  return reduced;
}

/** Who shared a host that a linked desktop holds a read-only copy of. */
export function parseSharedSource(
  value: unknown,
): { owner?: string; permissionLevel?: string } | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/**
 * sshOptions, and terminalConfig in the shape 2.8 clients and exports read:
 * core's own keys only, the SSH options. Everything else 2.8 kept there now
 * belongs to plugins' host settings, which they put back through their
 * hostPayloadLegacy. A sudo password 2.8 kept in terminal_config comes out as
 * sudoPassword, for the sanitizers to handle.
 */
export function hostTerminalExport(host: Record<string, unknown>): {
  sshOptions: HostSshOptions;
  terminalConfig?: Record<string, unknown>;
  sudoPassword?: unknown;
} {
  const raw = parseJsonObject(host.terminalConfig);
  const sshOptions = parseSshOptions(
    host.sshOptions != null ? host.sshOptions : raw,
  );
  const terminalConfig: Record<string, unknown> = { ...sshOptions };
  const legacySudo = !host.sudoPassword ? raw?.sudoPassword : undefined;
  return {
    sshOptions,
    terminalConfig:
      Object.keys(terminalConfig).length > 0 ? terminalConfig : undefined,
    ...(legacySudo ? { sudoPassword: legacySudo } : {}),
  };
}

export function transformHostResponse(
  host: Record<string, unknown>,
): Record<string, unknown> {
  const shared = parseSharedSource(host.sharedSource);
  return {
    ...host,
    sharedSource: undefined,
    localOnly: !!host.localOnly,
    sharedCopy: !!shared,
    ...(shared
      ? {
          isShared: true,
          ownerUsername: shared.owner || undefined,
          permissionLevel: shared.permissionLevel || "connect",
        }
      : {}),
    tags:
      typeof host.tags === "string"
        ? host.tags
          ? host.tags.split(",").filter(Boolean)
          : []
        : [],
    pin: !!host.pin,
    shareSshAuth: !!host.shareSshAuth,
    enableSsh: !!host.enableSsh,
    sshPort: host.sshPort ?? host.port ?? 22,
    jumpHosts: host.jumpHosts ? JSON.parse(host.jumpHosts as string) : [],
    // Moved into a plugin's host settings; its hostPayloadLegacy puts it
    // back for 2.8 clients.
    quickActions: undefined,
    statusCheckEnabled:
      host.statusCheckEnabled !== false && host.statusCheckEnabled !== 0,
    statusCheckInterval:
      typeof host.statusCheckInterval === "number"
        ? host.statusCheckInterval
        : null,
    ...hostTerminalExport(host),
    forceKeyboardInteractive: host.forceKeyboardInteractive === "true",
    socks5ProxyChain: host.socks5ProxyChain
      ? JSON.parse(host.socks5ProxyChain as string)
      : [],
    portKnockSequence: host.portKnockSequence
      ? JSON.parse(host.portKnockSequence as string)
      : [],
    defaultOverrides: parseDefaultOverrides(host.defaultOverrides),
  };
}
