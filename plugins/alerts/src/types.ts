export const CHANNEL_TYPES = ["webhook", "ntfy", "discord", "email"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export const SEVERITIES = ["info", "success", "warning", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Where an announcement from the Termix docs comes from in the inbox. */
export const ANNOUNCEMENT_SOURCE = "termix";

export interface AlertLink {
  tab?: string;
  url?: string;
}

export interface DeliveryResult {
  channelId: number;
  name: string;
  ok: boolean;
  error?: string;
}

export interface AlertItem {
  id: number;
  source: string;
  category: string;
  severity: Severity;
  title: string;
  body: string | null;
  link: AlertLink | null;
  context: Record<string, unknown> | null;
  deliveries: DeliveryResult[] | null;
  readAt: string | null;
  createdAt: string;
}

export interface ChannelSummary {
  id: number;
  name: string;
  type: ChannelType;
  enabled: boolean;
  createdAt: string;
  /** False when the config could not be read, e.g. still waiting on its upgrade. */
  usable: boolean;
}

export interface ChannelDetail extends ChannelSummary {
  config: Record<string, unknown>;
}

export interface AlertRule {
  id: number;
  name: string;
  match: string;
  minSeverity: Severity;
  channelIds: number[];
  enabled: boolean;
}

export interface AlertsMeta {
  emailAvailable: boolean;
  channelTypes: ChannelType[];
}

const RANK: Record<Severity, number> = {
  info: 0,
  success: 0,
  warning: 1,
  critical: 2,
};

export function isSeverity(value: unknown): value is Severity {
  return (
    typeof value === "string" &&
    (SEVERITIES as readonly string[]).includes(value)
  );
}

export function severityRank(severity: Severity): number {
  return RANK[severity];
}

/** Whether a category pattern ("*", "automations.*", "acme-ssl.renewal_failed") covers a category. */
export function matchesCategory(pattern: string, category: string): boolean {
  const trimmed = pattern.trim();
  if (!trimmed || trimmed === "*") return true;
  const escaped = trimmed
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`, "i").test(category);
}
