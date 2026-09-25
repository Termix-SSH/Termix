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
  entry("auth:provide", "high"),
  entry("device:serial", "high"),

  entry("hosts:write", "medium"),
  entry("credentials:use", "medium"),
  entry("credentials:write", "medium"),
  entry("network:outbound", "medium"),
  entry("network:serve", "medium"),
  entry("network:broadcast", "medium"),
  entry("users:read", "medium"),
  entry("events:core", "medium"),
  entry("notify:send", "medium"),
  entry("audit:read", "medium"),
  entry("desktop:window", "medium"),

  entry("hosts:read", "low"),
  entry("db:own", "low"),
  entry("kv:own", "low"),
  entry("files:own", "low"),
  entry("secrets:own", "low"),
  entry("settings:read-core", "low"),
  entry("ui:surface", "low"),
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
