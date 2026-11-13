/**
 * What a plugin's code may do.
 *
 * A capability is declared in the manifest and checked by the SDK method that
 * needs it. It is not a user permission: those stay in core RBAC and are dotted
 * (hosts.view), while capabilities are colon-separated (hosts:read) so the two
 * can never be confused in a grant table or a log line.
 *
 * Adding one means an entry here plus the SDK method that checks it. The i18n
 * keys resolve against core's en.json under plugins.capabilities.<id>.
 *
 * The copy those keys carry describes the consequence to the person deciding,
 * not the mechanism. "Run commands on your servers", not "grants ssh:connect".
 */

export type CapabilityRisk = "low" | "medium" | "high" | "critical";

export interface CapabilityInfo {
  id: string;
  risk: CapabilityRisk;
  /** i18n key for the short consequence, e.g. "Run commands on your servers". */
  titleKey: string;
  /** i18n key for the qualifying sentence under the title. */
  consequenceKey: string;
}

function entry(id: string, risk: CapabilityRisk): CapabilityInfo {
  return {
    id,
    risk,
    titleKey: `plugins.capabilities.${id}.title`,
    consequenceKey: `plugins.capabilities.${id}.consequence`,
  };
}

/**
 * Ordered critical -> low. The install and review UI reads this order directly
 * so the worst line is never folded into a summary row.
 */
export const CAPABILITY_CATALOG: readonly CapabilityInfo[] = [
  entry("credentials:read", "critical"),
  entry("system:tls", "critical"),

  entry("ssh:connect", "high"),
  entry("process:spawn", "high"),
  entry("users:write", "high"),
  entry("users:impersonate", "high"),
  entry("db:core-refs", "high"),
  entry("auth:provide", "high"),
  entry("auth:policy", "high"),
  entry("sync:provide", "high"),
  entry("ssh:transport", "high"),
  entry("device:serial", "high"),
  entry("network:sockets", "high"),
  entry("notify:hub", "high"),
  entry("operations:invoke", "high"),
  entry("operations:approve", "high"),
  entry("ui:layout", "high"),

  entry("hosts:write", "medium"),
  entry("hosts:export", "high"),
  entry("credentials:use", "medium"),
  entry("credentials:write", "medium"),
  entry("network:outbound", "medium"),
  entry("network:serve", "medium"),
  entry("network:broadcast", "medium"),
  entry("network:probe", "medium"),
  entry("hosts:status-provide", "medium"),
  entry("hosts:activity-provide", "medium"),
  entry("hosts:lock", "medium"),
  entry("hosts:connect-policy", "high"),
  entry("users:read", "medium"),
  entry("events:core", "medium"),
  entry("notify:send", "medium"),
  entry("operations:provide", "medium"),
  entry("audit:read", "medium"),
  entry("desktop:window", "medium"),
  entry("desktop:local", "high"),

  entry("hosts:read", "low"),
  entry("db:own", "low"),
  entry("kv:own", "low"),
  entry("files:own", "low"),
  entry("secrets:own", "low"),
  entry("settings:read-core", "low"),
  entry("plugins:read", "low"),
  entry("ui:surface", "low"),
  entry("ui:theme", "low"),
] as const;

export const CAPABILITY_IDS: readonly string[] = CAPABILITY_CATALOG.map(
  (capability) => capability.id,
);

/**
 * Kept as a string rather than a union of the catalog ids: a capability is
 * data the runtime checks at load time, and a union here would force every
 * caller holding a manifest value to cast.
 */
export type Capability = string;

const BY_ID = new Map(
  CAPABILITY_CATALOG.map((capability) => [capability.id, capability]),
);

export function isKnownCapability(capability: string): boolean {
  return BY_ID.has(capability);
}

export function getCapabilityInfo(
  capability: string,
): CapabilityInfo | undefined {
  return BY_ID.get(capability);
}

export const CAPABILITY_RISK_ORDER: readonly CapabilityRisk[] = [
  "critical",
  "high",
  "medium",
  "low",
];

/**
 * What a capability lets a plugin's own process do (API 2). Every plugin
 * backend runs in its own Node process under the permission model; by default
 * it can read only its own folder and the runtime, write nothing, and open no
 * sockets, child processes, workers or native addons. Everything else goes
 * through ctx, which core checks.
 *
 * This is the one table. Core builds the process flags from it, the CLI's
 * validate warns from it, and the plugin guide prints it.
 */
export interface CapabilityProcessGrant {
  /** Node flags added to the plugin process. */
  flags: readonly string[];
  /** Write access to the plugin's own data folder. */
  writeDataDir?: boolean;
  /** Linux firewall rule for the plugin's user, when the admin allows it. */
  firewall?: "allow-all";
  /** Node modules a plugin may then use directly. */
  modules: readonly string[];
}

export const CAPABILITY_PROCESS_GRANTS: Readonly<
  Record<string, CapabilityProcessGrant>
> = {
  "network:sockets": {
    flags: ["--allow-net"],
    firewall: "allow-all",
    modules: ["net", "tls", "http", "https", "http2", "dgram", "dns"],
  },
  "process:spawn": {
    flags: ["--allow-child-process"],
    modules: ["child_process"],
  },
  "device:serial": {
    flags: ["--allow-addons"],
    modules: [],
  },
  "files:own": {
    flags: [],
    writeDataDir: true,
    modules: ["fs", "fs/promises"],
  },
};

/** Node modules no capability unlocks: workers do not keep the fence. */
export const SANDBOX_BLOCKED_MODULES: readonly string[] = [
  "worker_threads",
  "wasi",
  "inspector",
  "inspector/promises",
  "sqlite",
  "trace_events",
  "cluster",
];

/** The Node modules a set of capabilities lets a plugin use directly. */
export function modulesGrantedBy(capabilities: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const capability of capabilities) {
    for (const name of CAPABILITY_PROCESS_GRANTS[capability]?.modules ?? []) {
      out.add(name);
    }
  }
  return out;
}

/** Node modules that need a grant from the table above. */
export const SANDBOX_GATED_MODULES: readonly string[] = [
  ...new Set(
    Object.values(CAPABILITY_PROCESS_GRANTS).flatMap((grant) => grant.modules),
  ),
];
