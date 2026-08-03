export type FieldGroup =
  | "connection"
  | "notes"
  | "tags"
  | "tunnels"
  | "jumpHosts"
  | "quickActions"
  | "featureFlags"
  | "advanced";

export interface ExportPayload {
  version?: string;
  exportedAt?: string;
  credentials?: Record<string, unknown>[];
  hosts: Record<string, unknown>[];
}

export const FIELD_GROUP_KEYS: Record<FieldGroup, string[]> = {
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
  tunnels: [
    "tunnelConnections",
    "useSocks5",
    "socks5Host",
    "socks5Port",
    "socks5Username",
    "socks5ProxyChain",
  ],
  jumpHosts: ["jumpHosts"],
  quickActions: ["quickActions"],
  featureFlags: [
    "enableTerminal",
    "enableTunnel",
    "enableFileManager",
    "enableDocker",
    "enableProxmox",
    "enableTmuxMonitor",
    "showTerminalInSidebar",
    "showFileManagerInSidebar",
    "showTunnelInSidebar",
    "showDockerInSidebar",
    "showServerStatsInSidebar",
    "defaultPath",
    "forceKeyboardInteractive",
  ],
  advanced: [
    "statsConfig",
    "dockerConfig",
    "proxmoxConfig",
    "terminalConfig",
    "guacamoleConfig",
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

const NESTED_SECRETS: { container: string; field: string }[] = [
  { container: "guacamoleConfig", field: "gateway-password" },
];

const NESTED_SECRET_ARRAYS: { container: string; field: string }[] = [
  { container: "socks5ProxyChain", field: "password" },
];

function nestedSecret(
  host: Record<string, unknown>,
  container: string,
  field: string,
): Record<string, unknown> | null {
  const blob = host[container];
  if (!blob || typeof blob !== "object") return null;
  const record = blob as Record<string, unknown>;
  return field in record ? record : null;
}

export function hostKey(host: Record<string, unknown>): string {
  return JSON.stringify(TUPLE_KEYS.map((k) => String(host[k] ?? "")));
}

export function buildExportPayload(
  raw: ExportPayload,
  selected: Set<string> | null,
  groups: Set<FieldGroup>,
  withCredentials: boolean,
): ExportPayload {
  const allowed = new Set<string>([
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
        for (const { container, field } of NESTED_SECRETS) {
          const record = nestedSecret(shaped, container, field);
          if (record) shaped[container] = { ...record, [field]: null };
        }
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

export function maskSecrets(payload: ExportPayload): ExportPayload {
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
      for (const { container, field } of NESTED_SECRETS) {
        const record = nestedSecret(masked, container, field);
        if (record && record[field]) {
          masked[container] = { ...record, [field]: "<included>" };
        }
      }
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
