import semver from "semver";
import { databaseLogger } from "./logger.js";
import { getProxyAgent } from "./proxy-agent.js";
import type {
  CacheEntry,
  GitHubAPIResponse,
  GitHubRelease,
} from "../../types/index.js";

class GitHubCache {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly CACHE_DURATION = 30 * 60 * 1000;

  set<T>(key: string, data: T): void {
    const now = Date.now();
    this.cache.set(key, {
      data,
      timestamp: now,
      expiresAt: now + this.CACHE_DURATION,
    });
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }
}

const githubCache = new GitHubCache();

/**
 * A release tag or version as full semver, keeping any prerelease part:
 * "v2.8" is 2.8.0 and "v26.11.0-beta.2" stays a prerelease.
 */
export function normalizeVersion(version: string | undefined): string | null {
  const match = String(version || "").match(
    /(\d+)\.(\d+)(?:\.(\d+))?(-[0-9A-Za-z.-]+)?/,
  );
  if (!match) return null;
  const normalized = `${match[1]}.${match[2]}.${match[3] || 0}${match[4] || ""}`;
  return semver.valid(normalized);
}

export function isPrereleaseVersion(version: string | undefined): boolean {
  const normalized = normalizeVersion(version);
  return Boolean(normalized && semver.prerelease(normalized));
}

export function compareSemver(
  a: string | undefined,
  b: string | undefined,
): number | null {
  const parsedA = normalizeVersion(a);
  const parsedB = normalizeVersion(b);
  if (!parsedA || !parsedB) return null;
  return semver.compare(parsedA, parsedB);
}

const GITHUB_API_BASE = "https://api.github.com";
export const REPO_OWNER = "Termix-SSH";
export const REPO_NAME = "Termix";

export async function fetchGitHubAPI<T>(
  endpoint: string,
  cacheKey: string,
): Promise<GitHubAPIResponse<T>> {
  const cachedEntry = githubCache.get<CacheEntry<T>>(cacheKey);
  if (cachedEntry) {
    return {
      data: cachedEntry.data,
      cached: true,
      cache_age: Date.now() - cachedEntry.timestamp,
    };
  }

  try {
    const url = `${GITHUB_API_BASE}${endpoint}`;
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "TermixUpdateChecker/1.0",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      dispatcher: getProxyAgent(url),
    });

    if (!response.ok) {
      throw new Error(
        `GitHub API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as T;
    const cacheData: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      expiresAt: Date.now() + 30 * 60 * 1000,
    };
    githubCache.set(cacheKey, cacheData);

    return {
      data: data,
      cached: false,
    };
  } catch (error) {
    databaseLogger.error(`Failed to fetch from GitHub API`, error, {
      operation: "github_api",
      endpoint,
    });
    throw error;
  }
}

export type UpdateChannel = "stable" | "beta";

export interface LatestRelease {
  version: string;
  tagName: string;
  name: string;
  url: string;
  publishedAt: string;
  prerelease: boolean;
  notes: string;
}

function toLatestRelease(release: GitHubRelease): LatestRelease | null {
  const version = normalizeVersion(release.tag_name || release.name || "");
  if (!version) return null;
  return {
    version,
    tagName: release.tag_name,
    name: release.name,
    url: release.html_url,
    publishedAt: release.published_at,
    prerelease: Boolean(release.prerelease) || !!semver.prerelease(version),
    notes: (release.body || "").slice(0, 20_000),
  };
}

/**
 * The newest Termix release on GitHub, cached for 30 minutes. On the beta
 * channel a newer beta wins over the newest stable release.
 */
export async function fetchLatestRelease(
  channel: UpdateChannel = "stable",
): Promise<LatestRelease | null> {
  if (channel === "stable") {
    const release = await fetchGitHubAPI<GitHubRelease>(
      `/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`,
      "latest_release",
    );
    return toLatestRelease(release.data);
  }
  const releases = await fetchGitHubAPI<GitHubRelease[]>(
    `/repos/${REPO_OWNER}/${REPO_NAME}/releases?per_page=30`,
    "latest_releases",
  );
  let newest: LatestRelease | null = null;
  for (const release of releases.data) {
    if (release.draft) continue;
    const parsed = toLatestRelease(release);
    if (parsed && (!newest || semver.gt(parsed.version, newest.version))) {
      newest = parsed;
    }
  }
  return newest;
}

export type UpdateStatus = "up_to_date" | "beta" | "requires_update";

/** How the running version compares with the newest release on its channel. */
export function updateStatus(
  localVersion: string,
  latestVersion: string | null | undefined,
): UpdateStatus {
  const comparison = latestVersion
    ? compareSemver(localVersion, latestVersion)
    : null;
  if (comparison !== null && comparison < 0) return "requires_update";
  if (isPrereleaseVersion(localVersion) || (comparison ?? 0) > 0) return "beta";
  return "up_to_date";
}
