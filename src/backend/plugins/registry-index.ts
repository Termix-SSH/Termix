/**
 * Plugin registries: fetching an index and downloading a release.
 *
 * An index is a plain JSON file. Official and community live in
 * Termix-SSH/Termix-Registry, custom ones anywhere an admin points to.
 * Nothing in an index is trusted on its own: every download is checked
 * against the sha256 and Ed25519 signature listed for it, and the signature
 * must come from that registry's keys (built in for official and community,
 * pinned when an admin added a custom one). A tampered index can at most
 * point at a file that then fails the check.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import semver from "semver";
import {
  pluginDocsUrl,
  pluginFeatures,
  SUPPORTED_PLUGIN_API_VERSION,
  youtubeVideoId,
} from "@termix-ssh/plugin-sdk/manifest";
import { safeOutboundFetch } from "../utils/safe-outbound-fetch.js";
import { pluginLogger } from "../utils/logger.js";
import {
  COMMUNITY_PLUGIN_KEYS,
  TRUSTED_PLUGIN_KEYS,
  isPluginPublicKey,
  verifyPluginArtifact,
  type TrustedPluginKey,
} from "./trust.js";
import { readArtifactManifest, sameCapabilities } from "./artifact-manifest.js";
import { getPluginsDir } from "./paths.js";

export const OFFICIAL_REGISTRY_ID = "official";
export const OFFICIAL_REGISTRY_URL =
  "https://raw.githubusercontent.com/Termix-SSH/Termix-Registry/main/official/index.json";
export const COMMUNITY_REGISTRY_ID = "community";
export const COMMUNITY_REGISTRY_URL =
  "https://raw.githubusercontent.com/Termix-SSH/Termix-Registry/main/community/index.json";

export type RegistryTier = "official" | "community" | "custom";

/** Where an index lives and which keys may sign what it lists. */
export interface RegistrySource {
  id: string;
  name: string;
  url: string;
  tier: RegistryTier;
  keys: readonly TrustedPluginKey[];
}

const CACHE_MS = 15 * 60_000;
const MAX_INDEX_BYTES = 5 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 200 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const MAX_NOTES_LENGTH = 20_000;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export interface RegistryVersion {
  version: string;
  api: string;
  url: string;
  sha256: string;
  signature: string;
  size: number;
  capabilities: string[];
  releaseNotesUrl?: string;
  /** This version's CHANGELOG.md section, as Markdown. */
  notes?: string;
  publishedAt?: string;
  /** Listed under the plugin's prereleases: a beta. */
  prerelease?: boolean;
}

export type PluginChannel = "stable" | "beta";

export function parsePluginChannel(value: unknown): PluginChannel | null {
  return value === "stable" || value === "beta" ? value : null;
}

export interface RegistryPlugin {
  id: string;
  name: string;
  description: string;
  author: string;
  category: string;
  repository?: string;
  icon?: string;
  /** Only ever a YouTube video id, never a link. */
  videoId?: string;
  features: string[];
  /** https docs link from the index. */
  docs?: string;
  /** Stable releases, newest first. */
  versions: RegistryVersion[];
  /**
   * Betas newer than the newest stable release, newest first. A separate
   * list so cores from before channels never offer one.
   */
  prereleases: RegistryVersion[];
}

export interface RegistryIndex {
  registry: string;
  name: string;
  updatedAt?: string;
  /** The key the registry signs with, base64. Only read when adding one. */
  publicKey?: string;
  plugins: RegistryPlugin[];
}

export function getRegistryUrl(): string {
  return process.env.TERMIX_PLUGIN_REGISTRY_URL || OFFICIAL_REGISTRY_URL;
}

export function officialSource(): RegistrySource {
  return {
    id: OFFICIAL_REGISTRY_ID,
    name: "Termix Official Plugins",
    url: getRegistryUrl(),
    tier: "official",
    keys: TRUSTED_PLUGIN_KEYS,
  };
}

export function communitySource(): RegistrySource {
  return {
    id: COMMUNITY_REGISTRY_ID,
    name: "Termix Community Plugins",
    url: process.env.TERMIX_COMMUNITY_REGISTRY_URL || COMMUNITY_REGISTRY_URL,
    tier: "community",
    keys: COMMUNITY_PLUGIN_KEYS,
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseVersion(raw: unknown): RegistryVersion | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  const version = asString(entry.version);
  const url = asString(entry.url);
  const sha256 = asString(entry.sha256);
  const signature = asString(entry.signature);
  if (!version || !semver.valid(version) || !url || !sha256 || !signature) {
    return null;
  }
  if (!/^[a-f0-9]{64}$/i.test(sha256)) return null;
  try {
    if (new URL(url).protocol !== "https:") return null;
  } catch {
    return null;
  }
  return {
    version,
    api: asString(entry.api) ?? "",
    url,
    sha256: sha256.toLowerCase(),
    signature,
    size: typeof entry.size === "number" ? entry.size : 0,
    capabilities: Array.isArray(entry.capabilities)
      ? entry.capabilities.filter((c): c is string => typeof c === "string")
      : [],
    releaseNotesUrl: asString(entry.releaseNotesUrl),
    notes: asString(entry.notes)?.slice(0, MAX_NOTES_LENGTH),
    publishedAt: asString(entry.publishedAt),
  };
}

/** Validates a fetched index. Malformed entries are dropped, not fatal. */
export function parseRegistryIndex(raw: unknown): RegistryIndex {
  if (!raw || typeof raw !== "object") {
    throw new Error("registry index is not an object");
  }
  const index = raw as Record<string, unknown>;
  if (!Array.isArray(index.plugins)) {
    throw new Error("registry index has no plugins list");
  }

  const plugins: RegistryPlugin[] = [];
  for (const item of index.plugins) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const id = asString(entry.id);
    if (!id || !ID_PATTERN.test(id)) continue;
    const parseList = (list: unknown) =>
      (Array.isArray(list) ? list : [])
        .map(parseVersion)
        .filter((v): v is RegistryVersion => v !== null)
        .sort((a, b) => semver.rcompare(a.version, b.version));
    const versions = parseList(entry.versions).filter(
      (v) => !semver.prerelease(v.version),
    );
    const prereleases = parseList(entry.prereleases)
      .filter((v) => semver.prerelease(v.version))
      .map((v) => ({ ...v, prerelease: true }));
    if (versions.length === 0 && prereleases.length === 0) continue;
    plugins.push({
      id,
      name: asString(entry.name) ?? id,
      description: asString(entry.description) ?? "",
      author: asString(entry.author) ?? "",
      category: asString(entry.category) ?? "",
      repository: asString(entry.repository),
      icon: asString(entry.icon),
      videoId: youtubeVideoId(entry.video) ?? undefined,
      features: pluginFeatures(entry.features),
      docs: pluginDocsUrl(entry.docs) ?? undefined,
      versions,
      prereleases,
    });
  }

  return {
    registry: asString(index.registry) ?? OFFICIAL_REGISTRY_ID,
    name: asString(index.name) ?? "",
    updatedAt: asString(index.updatedAt),
    publicKey: isPluginPublicKey(index.publicKey) ? index.publicKey : undefined,
    plugins,
  };
}

/** Whether this build can run a release built against `api`. */
export function isApiCompatible(api: string): boolean {
  const major = semver.coerce(api)?.major;
  return major !== undefined && String(major) === SUPPORTED_PLUGIN_API_VERSION;
}

/** Follows redirects by hand so each hop still gets the outbound checks. */
async function fetchFollowing(url: string): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await safeOutboundFetch(current, {
      method: "GET",
      redirect: "manual",
      headers: { "User-Agent": "Termix" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`redirect without a location: ${current}`);
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) {
      throw new Error(`${current} answered ${response.status}`);
    }
    return response;
  }
  throw new Error(`too many redirects fetching ${url}`);
}

async function readLimited(response: Response, limit: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > limit) throw new Error("download is larger than allowed");
  if (!response.body) return Buffer.alloc(0);

  const chunks: Buffer[] = [];
  let total = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw new Error("download is larger than allowed");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

interface CacheEntry {
  index: RegistryIndex;
  at: number;
}

const caches = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<RegistryIndex>>();
const lastErrors = new Map<string, string>();

function cacheKey(source: RegistrySource): string {
  return `${source.id} ${source.url}`;
}

export interface RegistryStatus {
  url: string;
  lastCheckedAt: string | null;
  error: string | null;
}

export function getRegistryStatus(
  source: RegistrySource = officialSource(),
): RegistryStatus {
  const cache = caches.get(cacheKey(source));
  return {
    url: source.url,
    lastCheckedAt: cache ? new Date(cache.at).toISOString() : null,
    error: lastErrors.get(cacheKey(source)) ?? null,
  };
}

/** Fetches and parses an index with no caching, for previewing a new one. */
export async function fetchIndexAt(url: string): Promise<RegistryIndex> {
  const response = await fetchFollowing(url);
  const body = await readLimited(response, MAX_INDEX_BYTES);
  let raw: unknown;
  try {
    raw = JSON.parse(body.toString("utf8"));
  } catch {
    throw new Error("the registry index is not valid JSON");
  }
  return parseRegistryIndex(raw);
}

export async function fetchRegistryIndex(
  source: RegistrySource = officialSource(),
  options: { force?: boolean } = {},
): Promise<RegistryIndex> {
  const key = cacheKey(source);
  const cache = caches.get(key);
  if (!options.force && cache && Date.now() - cache.at < CACHE_MS) {
    return cache.index;
  }
  const running = inflight.get(key);
  if (running) return running;

  const request = (async () => {
    try {
      const index = await fetchIndexAt(source.url);
      caches.set(key, { index, at: Date.now() });
      lastErrors.delete(key);
      return index;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastErrors.set(key, message);
      // A stale index beats none when the registry is briefly unreachable.
      const stale = caches.get(key);
      if (stale) {
        pluginLogger.warn(
          `Plugin registry ${source.id} check failed: ${message}`,
          { operation: "plugin_registry" },
        );
        return stale.index;
      }
      throw error;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, request);
  return request;
}

export interface RegistryStats {
  /** Downloads per plugin id. */
  plugins: Map<string, number>;
}

/** stats.json sits next to index.json and is rebuilt daily by the registry. */
export function getStatsUrl(
  source: RegistrySource = officialSource(),
): string | null {
  if (source.tier === "custom") return null;
  if (source.tier === "official" && process.env.TERMIX_PLUGIN_STATS_URL) {
    return process.env.TERMIX_PLUGIN_STATS_URL;
  }
  const url = source.url;
  return /\/index\.json$/.test(url)
    ? url.replace(/\/index\.json$/, "/stats.json")
    : null;
}

function asCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

export function parseRegistryStats(raw: unknown): RegistryStats {
  const plugins = new Map<string, number>();
  const entries = (raw as { plugins?: unknown } | null)?.plugins;
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    return { plugins };
  }
  for (const [id, value] of Object.entries(entries)) {
    if (!ID_PATTERN.test(id) || !value || typeof value !== "object") continue;
    plugins.set(id, asCount((value as Record<string, unknown>).downloads) ?? 0);
  }
  return { plugins };
}

export async function fetchRegistryStats(
  source: RegistrySource = officialSource(),
): Promise<RegistryStats | null> {
  const url = getStatsUrl(source);
  if (!url) return null;
  const response = await fetchFollowing(url);
  const body = await readLimited(response, MAX_INDEX_BYTES);
  return parseRegistryStats(JSON.parse(body.toString("utf8")));
}

/** Test seam. */
export function resetRegistryCache(): void {
  caches.clear();
  inflight.clear();
  lastErrors.clear();
}

/** Every release a channel may install, newest first. */
export function channelReleases(
  plugin: RegistryPlugin,
  channel: PluginChannel,
): RegistryVersion[] {
  if (channel === "stable") return plugin.versions;
  return [...plugin.prereleases, ...plugin.versions].sort((a, b) =>
    semver.rcompare(a.version, b.version),
  );
}

/** The newest release on a channel this build can run. */
export function latestOnChannel(
  plugin: RegistryPlugin,
  channel: PluginChannel,
): RegistryVersion | null {
  return (
    channelReleases(plugin, channel).find((entry) =>
      isApiCompatible(entry.api),
    ) ?? null
  );
}

export function findRelease(
  index: RegistryIndex,
  pluginId: string,
  version?: string,
  channel: PluginChannel = "stable",
): { plugin: RegistryPlugin; release: RegistryVersion } | null {
  const plugin = index.plugins.find((entry) => entry.id === pluginId);
  if (!plugin) return null;
  const release = version
    ? channelReleases(plugin, "beta").find((entry) => entry.version === version)
    : latestOnChannel(plugin, channel);
  if (!release) return null;
  return { plugin, release };
}

/**
 * The signed file is the truth and the index only describes it, so the
 * consent the admin gave (built from the index) must match what the packed
 * manifest asks for.
 */
export function assertArtifactMatches(
  pluginId: string,
  release: RegistryVersion,
  manifest: Record<string, unknown>,
): void {
  const where = `${pluginId} ${release.version}`;
  if (manifest.id !== pluginId) {
    throw new Error(`${where}: the archive is for "${String(manifest.id)}"`);
  }
  if (manifest.version !== release.version) {
    throw new Error(
      `${where}: the archive is version ${String(manifest.version)}`,
    );
  }
  const declared = Array.isArray(manifest.capabilities)
    ? manifest.capabilities.filter((c): c is string => typeof c === "string")
    : [];
  if (!sameCapabilities(declared, release.capabilities)) {
    throw new Error(
      `${where}: the archive asks for different capabilities than the registry lists`,
    );
  }
}

/**
 * Downloads a release, verifies it, and leaves it in a staging folder the
 * loader never scans. The caller moves it into place.
 */
export async function downloadRelease(
  pluginId: string,
  release: RegistryVersion,
  keys: readonly TrustedPluginKey[] = TRUSTED_PLUGIN_KEYS,
): Promise<{ file: string; signatureFile: string }> {
  if (!isApiCompatible(release.api)) {
    throw new Error(
      `${pluginId} ${release.version} needs plugin API ${release.api}, this build runs ${SUPPORTED_PLUGIN_API_VERSION}`,
    );
  }

  const limit =
    release.size > 0 ? release.size + 1024 * 1024 : MAX_ARTIFACT_BYTES;
  const response = await fetchFollowing(release.url);
  const buffer = await readLimited(
    response,
    Math.min(limit, MAX_ARTIFACT_BYTES),
  );

  const verified = verifyPluginArtifact(
    buffer,
    release.sha256,
    release.signature,
    keys,
  );
  if (verified.ok === false) {
    throw new Error(`${pluginId} ${release.version}: ${verified.reason}`);
  }
  assertArtifactMatches(pluginId, release, readArtifactManifest(buffer));

  const staging = getDownloadsDir();
  await fs.promises.mkdir(staging, { recursive: true });
  const base = path.join(
    staging,
    `${pluginId}-${release.version}-${crypto.randomBytes(4).toString("hex")}.tmxplug`,
  );
  await fs.promises.writeFile(base, buffer);
  await fs.promises.writeFile(`${base}.sig`, release.signature.trim());
  return { file: base, signatureFile: `${base}.sig` };
}

/** A dot folder inside the plugins dir, which the loader's scan skips. */
export function getDownloadsDir(): string {
  return path.join(getPluginsDir(), ".downloads");
}
