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

function parseSemver(
  version: string | undefined,
): [number, number, number] | null {
  const match = String(version || "").match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;

  return [Number(match[1]), Number(match[2]), Number(match[3] || 0)];
}

export function compareSemver(
  a: string | undefined,
  b: string | undefined,
): number | null {
  const parsedA = parseSemver(a);
  const parsedB = parseSemver(b);
  if (!parsedA || !parsedB) return null;

  for (let i = 0; i < 3; i += 1) {
    if (parsedA[i] > parsedB[i]) return 1;
    if (parsedA[i] < parsedB[i]) return -1;
  }

  return 0;
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

export interface LatestRelease {
  version: string;
  tagName: string;
  name: string;
  url: string;
  publishedAt: string;
}

/** The newest Termix release on GitHub, cached for 30 minutes. */
export async function fetchLatestRelease(): Promise<LatestRelease | null> {
  const release = await fetchGitHubAPI<GitHubRelease>(
    `/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`,
    "latest_release",
  );
  const rawTag = release.data.tag_name || release.data.name || "";
  const version = rawTag.match(/(\d+\.\d+(\.\d+)?)/)?.[1];
  if (!version) return null;
  return {
    version,
    tagName: release.data.tag_name,
    name: release.data.name,
    url: release.data.html_url,
    publishedAt: release.data.published_at,
  };
}
