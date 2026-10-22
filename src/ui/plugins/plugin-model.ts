import {
  CAPABILITY_RISK_ORDER,
  getCapabilityInfo,
  type CapabilityRisk,
} from "@termix-ssh/plugin-sdk/capabilities";
import type { PluginEnvVar } from "@termix-ssh/plugin-sdk/docs";
import semver from "semver";
import {
  CHANGE_TYPES,
  type ChangeType,
  type ChangelogChange,
  type ChangelogRelease,
} from "@termix-ssh/plugin-sdk/changelog";
import type {
  PluginChannel,
  PluginSummary,
  PluginUploadPreview,
  RegistryPluginEntry,
  RegistryPluginVersion,
} from "@/api/plugins-api";
import {
  buildIssueUrl,
  describeEnvironment,
  normalizeGitHubRepo,
} from "@/lib/issue-url";

export type PluginStatus =
  "running" | "disabled" | "failed" | "blocked" | "server" | "safeMode";

/** One row of the Plugins tab: what is installed merged with the registry. */
export interface PluginEntry {
  id: string;
  name: string;
  description: string;
  author: string;
  category: string;
  icon?: string;
  repository?: string;
  videoId?: string;
  features: string[];
  /** Docs link: the installed manifest's, else the registry's. */
  docs?: string;
  env: PluginEnvVar[];
  installed: boolean;
  version: string | null;
  latestVersion: string | null;
  /** Newest beta, when one is newer than stable. */
  latestBeta: string | null;
  channel: PluginChannel;
  /** The installed copy is a beta. */
  isBeta: boolean;
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
  downloads: number | null;
  source: PluginSource;
  /** Installed from a file or folder with no registry signature behind it. */
  unverified: boolean;
  /** The registry it is listed in or was installed from. */
  registryId: string | null;
  registryName: string | null;
  /** A linked server decides whether it runs here. */
  managedByServer: boolean;
  /** The app is drawn with it by default, so it can be swapped but not uninstalled. */
  defaultLook: boolean;
  /** Contribution keys from the manifest or the registry, like layouts. */
  kinds: string[];
  /** Listed, but no release runs on this build. */
  unsupported: boolean;
  /** The Termix range the newest release needs, when this build is too old. */
  needsTermix: string | null;
}

export type PluginSource =
  "bundled" | "official" | "community" | "custom" | "unverified";

export function isPrerelease(version: string | null | undefined): boolean {
  return Boolean(
    version && semver.valid(version) && semver.prerelease(version),
  );
}

/** A beta newer than what is installed, worth offering with "Try beta". */
export function betaToTry(
  plugin: Pick<PluginEntry, "installed" | "version" | "latestBeta" | "channel">,
): string | null {
  const { latestBeta, version } = plugin;
  if (!plugin.installed || plugin.channel === "beta" || !latestBeta) {
    return null;
  }
  if (!version || !semver.valid(version) || !semver.valid(latestBeta)) {
    return null;
  }
  return semver.gt(latestBeta, version) ? latestBeta : null;
}

/** Where an installed copy came from, as the issue report names it. */
export function pluginSource(summary: PluginSummary): PluginSource {
  if (summary.tier === "unverified") return "unverified";
  if (summary.source === "bundled" || summary.tier === "bundled") {
    return "bundled";
  }
  if (!summary.signedBy) return "unverified";
  return summary.tier === "community" || summary.tier === "custom"
    ? summary.tier
    : "official";
}

export function pluginStatus(summary: PluginSummary): PluginStatus {
  if (summary.runsOnServer) return "server";
  if (summary.state === "failed") return "failed";
  if (summary.state === "blocked") return "blocked";
  if (!summary.enabled) return "disabled";
  if (summary.state === "safe-mode") return "safeMode";
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
      videoId: summary.videoId ?? entry?.videoId,
      features: summary.features?.length
        ? summary.features
        : (entry?.features ?? []),
      docs: summary.docs ?? entry?.docs,
      env: summary.env ?? [],
      installed: true,
      version: summary.version,
      latestVersion: entry?.latestVersion ?? null,
      latestBeta: entry?.latestBeta ?? null,
      channel: summary.channel ?? entry?.channel ?? "stable",
      isBeta: isPrerelease(summary.version),
      // The server keeps its own copy up to date.
      updateAvailable: summary.runsOnServer
        ? false
        : (entry?.updateAvailable ?? false),
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
      downloads: entry?.downloads ?? null,
      source: pluginSource(summary),
      unverified: pluginSource(summary) === "unverified",
      registryId: entry?.registryId ?? summary.registryId ?? null,
      registryName: entry?.registryName ?? null,
      managedByServer: summary.managedByServer ?? false,
      defaultLook: summary.defaultLook ?? false,
      kinds: [
        ...new Set([
          ...Object.keys(summary.contributes ?? {}),
          ...(entry?.contributes ?? []),
        ]),
      ],
      unsupported: false,
      needsTermix: null,
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
      videoId: entry.videoId,
      features: entry.features ?? [],
      docs: entry.docs,
      env: [],
      installed: false,
      version: null,
      latestVersion: entry.latestVersion,
      latestBeta: entry.latestBeta ?? null,
      channel: "stable",
      isBeta: false,
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
      downloads: entry.downloads ?? null,
      source: entry.tier ?? "official",
      unverified: false,
      registryId: entry.registryId ?? "official",
      registryName: entry.registryName ?? null,
      managedByServer: false,
      defaultLook: false,
      kinds: entry.contributes ?? [],
      unsupported: entry.latestVersion === null,
      needsTermix:
        entry.latestVersion === null
          ? (entry.versions.find((v) => v.needsTermix)?.needsTermix ?? null)
          : null,
    });
  }

  return rows;
}

/** A row for a file that was uploaded but not installed yet. */
export function uploadEntry(preview: PluginUploadPreview): PluginEntry {
  return {
    id: preview.id,
    name: preview.name,
    description: preview.description,
    author: preview.author,
    features: preview.features ?? [],
    env: [],
    category: "",
    installed: preview.replaces !== null,
    version: preview.replaces,
    latestVersion: preview.version,
    latestBeta: null,
    channel: "stable",
    isBeta: isPrerelease(preview.replaces),
    updateAvailable: false,
    addedCapabilities: [],
    versions: [],
    capabilities: preview.capabilities,
    status: null,
    enabled: false,
    lastError: null,
    autoUpdate: false,
    pinnedVersion: null,
    bundled: false,
    inRegistry: false,
    contributes: null,
    publishedAt: null,
    downloads: null,
    source: "unverified",
    unverified: true,
    registryId: null,
    registryName: null,
    managedByServer: false,
    defaultLook: false,
    kinds: [],
    unsupported: false,
    needsTermix: null,
  };
}

function latestPublished(versions: RegistryPluginVersion[]): string | null {
  const dates = versions
    .map((v) => v.publishedAt)
    .filter((d): d is string => Boolean(d))
    .sort();
  return dates.at(-1) ?? null;
}

export type SortKey = "popular" | "name" | "updated" | "category";

export function sortPlugins(rows: PluginEntry[], key: SortKey): PluginEntry[] {
  const sorted = [...rows];
  if (key === "popular") {
    sorted.sort(
      (a, b) =>
        (b.downloads ?? -1) - (a.downloads ?? -1) ||
        a.name.localeCompare(b.name),
    );
  } else if (key === "updated") {
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
    row.features.some((f) => f.toLowerCase().includes(q)) ||
    row.id.includes(q)
  );
}

export function categoriesOf(rows: PluginEntry[]): string[] {
  return [...new Set(rows.map((row) => row.category).filter(Boolean))].sort();
}

/** Contribution keys worth filtering by, in the order the filter lists them. */
export const PLUGIN_KINDS = [
  "layouts",
  "themes",
  "tabs",
  "panels",
  "dashboardCards",
  "protocols",
  "auth",
  "actions",
  "hostCapability",
] as const;

export type PluginKind = (typeof PLUGIN_KINDS)[number];

/** The filterable kinds present in a set of rows, with how many have each. */
export function kindsOf(
  rows: PluginEntry[],
): Array<{ kind: PluginKind; count: number }> {
  return PLUGIN_KINDS.map((kind) => ({
    kind,
    count: rows.filter((row) => row.kinds.includes(kind)).length,
  })).filter((entry) => entry.count > 0);
}

/** One page of rows, with the page clamped to what exists. */
export function pageOf<T>(
  rows: T[],
  page: number,
  size: number,
): { items: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(1, page), pages);
  return {
    items: rows.slice((current - 1) * size, current * size),
    page: current,
    pages,
  };
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

/** 1234 reads as 1.2k, so the number stays a rough ranking. */
export function formatCount(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) {
    return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`;
  }
  return `${(count / 1_000_000).toFixed(1)}M`;
}

/**
 * A new bug report on the plugin's own repo with what a maintainer asks first
 * already filled in. Official plugins use the org bug form and the plugin
 * template ships the same one. Null when the repository is not on GitHub.
 */
export function reportIssueUrl(
  plugin: Pick<
    PluginEntry,
    | "id"
    | "repository"
    | "version"
    | "latestVersion"
    | "status"
    | "source"
    | "lastError"
  >,
  termixVersion?: string,
): string | null {
  const repo = normalizeGitHubRepo(plugin.repository);
  if (!repo) return null;
  const version = plugin.version ?? plugin.latestVersion ?? "not installed";
  const state = `Plugin ${plugin.id}, ${plugin.source}, ${plugin.status ?? "not installed"}`;
  return buildIssueUrl(repo, {
    template: "bug_report.yml",
    fields: {
      "termix-version": termixVersion,
      "plugin-version": version,
      environment: `${describeEnvironment()}
${state}`,
      logs: plugin.lastError,
    },
  });
}

/**
 * Beta feedback on the plugin's own repo, through the org beta form. Null when
 * the repository is not on GitHub.
 */
export function betaFeedbackUrl(
  plugin: Pick<PluginEntry, "id" | "repository" | "version" | "lastError">,
  termixVersion?: string,
): string | null {
  const repo = normalizeGitHubRepo(plugin.repository);
  if (!repo) return null;
  return buildIssueUrl(repo, {
    template: "beta_feedback.yml",
    fields: {
      "termix-version": termixVersion,
      "plugin-version": plugin.version,
      environment: describeEnvironment(),
      logs: plugin.lastError,
    },
  });
}

/** A new feature request on the plugin's own repo, or null when not on GitHub. */
export function requestFeatureUrl(
  plugin: Pick<PluginEntry, "repository">,
): string | null {
  const repo = normalizeGitHubRepo(plugin.repository);
  if (!repo) return null;
  return buildIssueUrl(repo, { template: "feature_request.yml" });
}

/** One version in a plugin's release notes. */
export interface ReleaseRow {
  version: string;
  date: string | null;
  summary?: string;
  changes: ChangelogChange[];
  /** False only for a registry version this build cannot run. */
  compatible: boolean;
  releaseNotesUrl?: string;
}

/**
 * The registry's versions and the installed copy's CHANGELOG.md as one list,
 * newest first. The installed copy's notes win for a version in both.
 */
export function mergeReleaseNotes(
  versions: RegistryPluginVersion[],
  local: ChangelogRelease[],
): ReleaseRow[] {
  const rows = new Map<string, ReleaseRow>();
  for (const v of versions) {
    rows.set(v.version, {
      version: v.version,
      date: v.publishedAt ?? null,
      summary: v.notes?.summary,
      changes: v.notes?.changes ?? [],
      compatible: v.compatible,
      releaseNotesUrl: v.releaseNotesUrl,
    });
  }
  for (const release of local) {
    const row = rows.get(release.version);
    rows.set(release.version, {
      version: release.version,
      date: release.date ?? row?.date ?? null,
      summary: release.summary ?? row?.summary,
      changes:
        release.changes.length > 0 ? release.changes : (row?.changes ?? []),
      compatible: row?.compatible ?? true,
      releaseNotesUrl: row?.releaseNotesUrl,
    });
  }
  return [...rows.values()].sort((a, b) =>
    semver.valid(a.version) && semver.valid(b.version)
      ? semver.rcompare(a.version, b.version)
      : 0,
  );
}

/** The changes of one release grouped by type, in the changelog's order. */
export function groupChanges(
  changes: ChangelogChange[],
): Array<{ type: ChangeType; items: string[] }> {
  const groups: Array<{ type: ChangeType; items: string[] }> = [];
  for (const type of CHANGE_TYPES) {
    const items = changes.filter((c) => c.type === type).map((c) => c.text);
    if (items.length > 0) groups.push({ type, items });
  }
  return groups;
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** The embed address for a video id, or null for anything that is not one. */
export function youtubeEmbedUrl(videoId: string | undefined): string | null {
  return videoId && YOUTUBE_ID.test(videoId)
    ? `https://www.youtube-nocookie.com/embed/${videoId}?rel=0`
    : null;
}
