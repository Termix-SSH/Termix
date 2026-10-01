/**
 * Host defaults: the keys a host can inherit and how their values compare.
 *
 * Shared by the backend (resolution, materializing, the upgrade) and the host
 * editor (which fields show an inherited badge). A key is namespaced:
 * "core.<key>" for core's own fields, "<pluginId>.<field>" for a plugin's host
 * setting. Values are in the host API's shape, never in column form.
 */

export type HostDefaultsLevel = "admin" | "user" | "folder";

export const HOST_DEFAULTS_LEVELS: readonly HostDefaultsLevel[] = [
  "admin",
  "user",
  "folder",
];

export const CORE_NAMESPACE = "core";

/** Namespace -> keys the host sets itself. */
export type DefaultOverrides = Record<string, string[]>;

export interface HostDefaultSource {
  level: HostDefaultsLevel | "builtin";
  folderId?: number;
  folderName?: string;
}

export interface ResolvedHostDefault {
  value: unknown;
  source: HostDefaultSource;
}

export interface HostAuthDefault {
  authType: string;
  credentialId: number | null;
  overrideCredentialUsername: boolean;
  agentSocketPath: string | null;
  agentIdentity: string | null;
}

export interface HostSocks5Default {
  useSocks5: boolean;
  socks5Host: string | null;
  socks5Port: number | null;
  socks5Username: string | null;
  socks5ProxyChain: unknown[] | null;
}

export interface CoreHostDefault {
  key: string;
  /** Levels allowed to set it. A value that points at a user's row is never admin. */
  levels: readonly HostDefaultsLevel[];
  /** What a host gets when no level sets it. Undefined means nothing to inherit. */
  builtin: unknown;
  /** One canonical form, so two spellings of the same value compare equal. */
  normalize: (value: unknown) => unknown;
}

const ALL_LEVELS = HOST_DEFAULTS_LEVELS;
const OWN_LEVELS: readonly HostDefaultsLevel[] = ["user", "folder"];

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (value === true || value === 1 || value === "true" || value === "1")
    return true;
  if (value === false || value === 0 || value === "false" || value === "0")
    return false;
  return fallback;
}

function toNumber(value: unknown, fallback: number | null): number | null {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function toArray(value: unknown): unknown[] {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  return Array.isArray(parsed) ? parsed : [];
}

function toObject(value: unknown): Record<string, unknown> | null {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

/** Auth types whose login lives on the host itself, so it cannot be a default. */
export const SECRET_AUTH_TYPES = ["password", "key"];

export function normalizeAuthDefault(value: unknown): HostAuthDefault | null {
  const source = toObject(value);
  if (!source || typeof source.authType !== "string" || !source.authType)
    return null;
  const authType = source.authType;
  const credentialId = toNumber(source.credentialId, null);
  return {
    authType,
    credentialId: authType === "credential" ? credentialId : null,
    overrideCredentialUsername:
      authType === "credential"
        ? toBoolean(source.overrideCredentialUsername, false)
        : false,
    agentSocketPath:
      authType === "agent" ? toText(source.agentSocketPath) : null,
    agentIdentity: authType === "agent" ? toText(source.agentIdentity) : null,
  };
}

export function normalizeSocks5Default(value: unknown): HostSocks5Default {
  const source = toObject(value) ?? {};
  if (!toBoolean(source.useSocks5, false)) {
    return {
      useSocks5: false,
      socks5Host: null,
      socks5Port: null,
      socks5Username: null,
      socks5ProxyChain: null,
    };
  }
  const chain = toArray(source.socks5ProxyChain);
  if (chain.length > 0) {
    return {
      useSocks5: true,
      socks5Host: null,
      socks5Port: null,
      socks5Username: null,
      socks5ProxyChain: chain.map((node) => {
        const own = toObject(node) ?? {};
        // A proxy's password stays on the host.
        const { password: _password, ...rest } = own;
        return rest;
      }),
    };
  }
  return {
    useSocks5: true,
    socks5Host: toText(source.socks5Host),
    socks5Port: toNumber(source.socks5Port, 1080),
    socks5Username: toText(source.socks5Username),
    socks5ProxyChain: null,
  };
}

function normalizeJumpHosts(value: unknown): Array<{ hostId: number }> {
  return toArray(value)
    .map((entry) => toNumber(toObject(entry)?.hostId, null))
    .filter((hostId): hostId is number => hostId !== null)
    .map((hostId) => ({ hostId }));
}

function normalizePortKnock(value: unknown): unknown[] {
  return toArray(value).map((entry) => {
    const own = toObject(entry) ?? {};
    return {
      port: toNumber(own.port, 0),
      protocol: own.protocol === "udp" ? "udp" : "tcp",
      delay: toNumber(own.delay, 0),
    };
  });
}

function normalizeEnvironment(value: unknown): unknown[] {
  return toArray(value).map((entry) => {
    const own = toObject(entry) ?? {};
    return { key: String(own.key ?? ""), value: String(own.value ?? "") };
  });
}

export const CORE_HOST_DEFAULTS: readonly CoreHostDefault[] = [
  {
    key: "username",
    levels: ALL_LEVELS,
    builtin: undefined,
    normalize: toText,
  },
  {
    key: "sshPort",
    levels: ALL_LEVELS,
    builtin: 22,
    normalize: (value) => {
      const port = toNumber(value, 22);
      return port !== null && Number.isInteger(port) && port > 0 && port < 65536
        ? port
        : 22;
    },
  },
  {
    key: "auth",
    levels: ALL_LEVELS,
    builtin: undefined,
    normalize: normalizeAuthDefault,
  },
  {
    key: "forceKeyboardInteractive",
    levels: ALL_LEVELS,
    builtin: false,
    normalize: (value) => toBoolean(value, false),
  },
  {
    key: "keepaliveInterval",
    levels: ALL_LEVELS,
    builtin: 60,
    normalize: (value) => toNumber(value, 60),
  },
  {
    key: "keepaliveCountMax",
    levels: ALL_LEVELS,
    builtin: 5,
    normalize: (value) => toNumber(value, 5),
  },
  {
    key: "allowLegacyAlgorithms",
    levels: ALL_LEVELS,
    builtin: true,
    normalize: (value) => toBoolean(value, true),
  },
  {
    key: "agentForwarding",
    levels: ALL_LEVELS,
    builtin: false,
    normalize: (value) => toBoolean(value, false),
  },
  {
    key: "environmentVariables",
    levels: ALL_LEVELS,
    builtin: [],
    normalize: normalizeEnvironment,
  },
  {
    key: "socks5",
    levels: ALL_LEVELS,
    builtin: normalizeSocks5Default(null),
    normalize: normalizeSocks5Default,
  },
  {
    key: "jumpHosts",
    levels: OWN_LEVELS,
    builtin: [],
    normalize: normalizeJumpHosts,
  },
  {
    key: "portKnockSequence",
    levels: ALL_LEVELS,
    builtin: [],
    normalize: normalizePortKnock,
  },
  {
    key: "statusCheckEnabled",
    levels: ALL_LEVELS,
    builtin: true,
    normalize: (value) => toBoolean(value, true),
  },
  {
    key: "statusCheckInterval",
    levels: ALL_LEVELS,
    builtin: null,
    normalize: (value) => {
      const interval = toNumber(value, null);
      return interval !== null && interval > 0 ? Math.round(interval) : null;
    },
  },
];

export function findCoreHostDefault(key: string): CoreHostDefault | undefined {
  return CORE_HOST_DEFAULTS.find((entry) => entry.key === key);
}

/** "core.sshPort" -> ["core", "sshPort"]. The plugin id never has a dot. */
export function splitDefaultKey(fullKey: string): [string, string] {
  const dot = fullKey.indexOf(".");
  if (dot <= 0) return [CORE_NAMESPACE, fullKey];
  return [fullKey.slice(0, dot), fullKey.slice(dot + 1)];
}

export function joinDefaultKey(namespace: string, key: string): string {
  return `${namespace}.${key}`;
}

/** JSON with sorted object keys, so equal values stringify the same. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

export function defaultValuesEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

/** A stored or sent overrides value, or null when it is not one. */
export function parseDefaultOverrides(raw: unknown): DefaultOverrides | null {
  const source = toObject(raw);
  if (!source) return null;
  const result: DefaultOverrides = {};
  for (const [namespace, keys] of Object.entries(source)) {
    if (!Array.isArray(keys)) continue;
    result[namespace] = [
      ...new Set(keys.filter((key): key is string => typeof key === "string")),
    ].sort();
  }
  return result;
}

export function isDefaultOverridden(
  overrides: DefaultOverrides | null | undefined,
  namespace: string,
  key: string,
): boolean {
  return !!overrides?.[namespace]?.includes(key);
}
