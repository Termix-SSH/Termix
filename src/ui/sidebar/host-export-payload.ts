export type FieldGroup =
  | "connection"
  | "notes"
  | "tags"
  | "proxy"
  | "jumpHosts"
  | "featureFlags"
  | "advanced";

export interface ExportPayload {
  version?: string;
  exportedAt?: string;
  credentials?: Record<string, unknown>[];
  hosts: Record<string, unknown>[];
}

const FIELD_GROUP_KEYS: Record<FieldGroup, string[]> = {
  connection: [
    "connectionType",
    "name",
    "ip",
    "port",
    "username",
    "folder",
    "domain",
    "security",
    "ignoreCert",
  ],
  notes: ["notes"],
  tags: ["tags", "pin"],
  proxy: [
    "useSocks5",
    "socks5Host",
    "socks5Port",
    "socks5Username",
    "socks5ProxyChain",
  ],
  jumpHosts: ["jumpHosts"],
  // Every plugin's host settings, enable switches included.
  featureFlags: ["pluginSettings", "forceKeyboardInteractive"],
  advanced: [
    "statusCheckEnabled",
    "statusCheckInterval",
    "terminalConfig",
    "sshOptions",
  ],
};

export const SECRET_KEYS = [
  "password",
  "key",
  "keyPassword",
  "sudoPassword",
  "socks5Password",
];

const CREDENTIAL_KEYS = [
  ...SECRET_KEYS,
  "authType",
  "keyType",
  "credentialAlias",
  "credentialId",
  "overrideCredentialUsername",
];

const TUPLE_KEYS = ["name", "ip", "port", "username", "connectionType"];

/**
 * Keys inside a plugin's JSON host settings that hold secrets, per plugin and
 * field, from each manifest's `secretKeys`.
 */
export type PluginSecretKeys = Record<string, Record<string, string[]>>;

/** Reads the secret keys the plugins declare in their host settings. */
export function pluginSecretKeys(
  summaries: Array<{
    id: string;
    contributes?: {
      settings?: {
        host?: { fields?: Array<{ key: string; secretKeys?: string[] }> };
      };
    } | null;
  }>,
): PluginSecretKeys {
  const result: PluginSecretKeys = {};
  for (const summary of summaries) {
    for (const field of summary.contributes?.settings?.host?.fields ?? []) {
      if (!field.secretKeys?.length) continue;
      (result[summary.id] ??= {})[field.key] = field.secretKeys;
    }
  }
  return result;
}

const NESTED_SECRET_ARRAYS: { container: string; field: string }[] = [
  { container: "socks5ProxyChain", field: "password" },
];

/** Rewrites each declared secret inside a plugin's JSON host settings. */
function mapPluginSecrets(
  pluginSettings: unknown,
  secrets: PluginSecretKeys,
  replace: (value: unknown) => unknown,
): unknown {
  if (!pluginSettings || typeof pluginSettings !== "object") {
    return pluginSettings;
  }
  const perPlugin: Record<string, unknown> = {};
  for (const [pluginId, values] of Object.entries(
    pluginSettings as Record<string, unknown>,
  )) {
    const copy = { ...(values as Record<string, unknown>) };
    for (const [field, keys] of Object.entries(secrets[pluginId] ?? {})) {
      const blob = copy[field];
      if (!blob || typeof blob !== "object") continue;
      const record = { ...(blob as Record<string, unknown>) };
      for (const key of keys) {
        if (key in record) record[key] = replace(record[key]);
      }
      copy[field] = record;
    }
    perPlugin[pluginId] = copy;
  }
  return perPlugin;
}

export function hostKey(host: Record<string, unknown>): string {
  return JSON.stringify(TUPLE_KEYS.map((k) => String(host[k] ?? "")));
}

export function buildExportPayload(
  raw: ExportPayload,
  selected: Set<string> | null,
  groups: Set<FieldGroup>,
  withCredentials: boolean,
  pluginSecrets: PluginSecretKeys = {},
): ExportPayload {
  const allowed = new Set<string>([
    "exportId",
    ...CREDENTIAL_KEYS,
    ...FIELD_GROUP_KEYS.connection,
  ]);
  for (const group of groups) {
    for (const key of FIELD_GROUP_KEYS[group]) allowed.add(key);
  }

  const hosts = (raw.hosts ?? [])
    .filter((host) => selected === null || selected.has(hostKey(host)))
    .map((host) => {
      const shaped: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(host)) {
        if (allowed.has(key)) shaped[key] = value;
      }
      if (!withCredentials) {
        shaped.pluginSettings = mapPluginSecrets(
          shaped.pluginSettings,
          pluginSecrets,
          () => null,
        );
        for (const { container, field } of NESTED_SECRET_ARRAYS) {
          const arr = shaped[container];
          if (Array.isArray(arr)) {
            shaped[container] = arr.map((entry) =>
              entry && typeof entry === "object"
                ? { ...(entry as Record<string, unknown>), [field]: null }
                : entry,
            );
          }
        }
      }
      return shaped;
    });

  const result: ExportPayload = { ...raw, hosts };

  if (raw.credentials) {
    const used = new Set(
      hosts.map((host) => host.credentialAlias).filter(Boolean),
    );
    result.credentials = raw.credentials.filter((entry) =>
      used.has(entry.alias),
    );
  }

  return result;
}

export function maskSecrets(
  payload: ExportPayload,
  pluginSecrets: PluginSecretKeys = {},
): ExportPayload {
  return {
    ...payload,
    hosts: payload.hosts.map((host) => {
      const masked = { ...host };
      for (const key of SECRET_KEYS) {
        if (
          masked[key] !== undefined &&
          masked[key] !== null &&
          masked[key] !== ""
        ) {
          masked[key] = "<included>";
        }
      }
      masked.pluginSettings = mapPluginSecrets(
        masked.pluginSettings,
        pluginSecrets,
        (value) => (value ? "<included>" : value),
      );
      for (const { container, field } of NESTED_SECRET_ARRAYS) {
        const arr = masked[container];
        if (Array.isArray(arr)) {
          masked[container] = arr.map((entry) => {
            if (entry && typeof entry === "object") {
              const record = entry as Record<string, unknown>;
              if (record[field]) return { ...record, [field]: "<included>" };
            }
            return entry;
          });
        }
      }
      return masked;
    }),
  };
}
