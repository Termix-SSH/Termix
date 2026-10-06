import {
  CAPABILITY_RISK_ORDER,
  getCapabilityInfo,
  type CapabilityRisk,
} from "@termix-ssh/plugin-sdk/capabilities";
import type {
  PluginSummary,
  RegistryPluginEntry,
  RegistryPluginVersion,
} from "@/api/plugins-api";

export type PluginStatus = "running" | "disabled" | "failed" | "blocked";

/** One row of the Plugins tab: what is installed merged with the registry. */
export interface PluginEntry {
  id: string;
  name: string;
  description: string;
  author: string;
  category: string;
  icon?: string;
  repository?: string;
  installed: boolean;
  version: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  addedCapabilities: string[];
  versions: RegistryPluginVersion[];
  capabilities: string[];
  status: PluginStatus | null;
  enabled: boolean;
  lastError: string | null;
  autoUpdate: boolean;
  pinnedVersion: string | null;
  bundled: boolean;
  inRegistry: boolean;
  contributes: Record<string, unknown> | null;
  publishedAt: string | null;
}

export function pluginStatus(summary: PluginSummary): PluginStatus {
  if (summary.state === "failed") return "failed";
  if (summary.state === "blocked") return "blocked";
  if (!summary.enabled) return "disabled";
  return "running";
}

export function mergePlugins(
  installed: PluginSummary[],
  registry: RegistryPluginEntry[] | null,
): PluginEntry[] {
  const byId = new Map((registry ?? []).map((entry) => [entry.id, entry]));
  const rows: PluginEntry[] = [];

  for (const summary of installed) {
    const entry = byId.get(summary.id);
    byId.delete(summary.id);
    rows.push({
      id: summary.id,
      name: summary.name,
      description: summary.description ?? entry?.description ?? "",
      author: summary.author ?? entry?.author ?? "",
      category: entry?.category ?? "",
      icon: summary.icon ?? entry?.icon,
      repository: summary.repository ?? entry?.repository,
      installed: true,
      version: summary.version,
      latestVersion: entry?.latestVersion ?? null,
      updateAvailable: entry?.updateAvailable ?? false,
      addedCapabilities: entry?.addedCapabilities ?? [],
      versions: entry?.versions ?? [],
      capabilities: summary.capabilities ?? [],
      status: pluginStatus(summary),
      enabled: summary.enabled,
      lastError: summary.lastError ?? null,
      autoUpdate: summary.autoUpdate ?? entry?.autoUpdate ?? false,
      pinnedVersion: summary.pinnedVersion ?? entry?.pinnedVersion ?? null,
      bundled: entry?.bundled ?? summary.tier === "bundled",
      inRegistry: Boolean(entry),
      contributes: (summary.contributes as Record<string, unknown>) ?? null,
      publishedAt: latestPublished(entry?.versions ?? []),
    });
  }

  for (const entry of byId.values()) {
    const latest =
      entry.versions.find((v) => v.version === entry.latestVersion) ??
      entry.versions[0];
    rows.push({
      id: entry.id,
      name: entry.name,
      description: entry.description,
      author: entry.author,
      category: entry.category,
      icon: entry.icon,
      repository: entry.repository,
      installed: false,
      version: null,
      latestVersion: entry.latestVersion,
      updateAvailable: false,
      addedCapabilities: [],
      versions: entry.versions,
      capabilities: latest?.capabilities ?? [],
      status: null,
      enabled: false,
      lastError: null,
      autoUpdate: false,
      pinnedVersion: null,
      bundled: entry.bundled,
      inRegistry: true,
      contributes: null,
      publishedAt: latestPublished(entry.versions),
    });
  }

  return rows;
}

function latestPublished(versions: RegistryPluginVersion[]): string | null {
  const dates = versions
    .map((v) => v.publishedAt)
    .filter((d): d is string => Boolean(d))
    .sort();
  return dates.at(-1) ?? null;
}

export type SortKey = "name" | "updated" | "category";

export function sortPlugins(rows: PluginEntry[], key: SortKey): PluginEntry[] {
  const sorted = [...rows];
  if (key === "updated") {
    sorted.sort((a, b) =>
      (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""),
    );
  } else if (key === "category") {
    sorted.sort(
      (a, b) =>
        a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
    );
  } else {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
  }
  return sorted;
}

export function matchesQuery(row: PluginEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    row.name.toLowerCase().includes(q) ||
    row.description.toLowerCase().includes(q) ||
    row.id.includes(q)
  );
}

export function categoriesOf(rows: PluginEntry[]): string[] {
  return [...new Set(rows.map((row) => row.category).filter(Boolean))].sort();
}

export function capabilityRisk(capability: string): CapabilityRisk {
  return getCapabilityInfo(capability)?.risk ?? "medium";
}

/** Worst first, the order the consent copy is read in. */
export function orderByRisk(capabilities: string[]): string[] {
  return [...capabilities].sort(
    (a, b) =>
      CAPABILITY_RISK_ORDER.indexOf(capabilityRisk(a)) -
      CAPABILITY_RISK_ORDER.indexOf(capabilityRisk(b)),
  );
}

export function isSevere(capability: string): boolean {
  const risk = capabilityRisk(capability);
  return risk === "critical" || risk === "high";
}

/** Contribution kinds worth naming in "Adds to Termix", with a count each. */
const CONTRIBUTION_KINDS = [
  "tabs",
  "panels",
  "dashboardCards",
  "actions",
  "protocols",
  "auth",
  "settings",
  "hostCapability",
  "permissions",
  "keybindingActions",
  "syncEntities",
] as const;

export type ContributionKind = (typeof CONTRIBUTION_KINDS)[number];

export function describeContributions(
  contributes: Record<string, unknown> | null,
): Array<{ kind: ContributionKind; count: number }> {
  if (!contributes) return [];
  const result: Array<{ kind: ContributionKind; count: number }> = [];
  for (const kind of CONTRIBUTION_KINDS) {
    const value = contributes[kind];
    if (value === undefined || value === null || value === false) continue;
    if (Array.isArray(value)) {
      if (value.length > 0) result.push({ kind, count: value.length });
      continue;
    }
    if (kind === "auth" && typeof value === "object") {
      const auth = value as {
        loginMethods?: unknown[];
        secondFactors?: unknown[];
      };
      const count =
        (auth.loginMethods?.length ?? 0) + (auth.secondFactors?.length ?? 0);
      if (count > 0) result.push({ kind, count });
      continue;
    }
    result.push({ kind, count: 1 });
  }
  return result;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}
