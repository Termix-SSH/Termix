import { authApi, handleApiError } from "@/main-axios";

// ============================================================================
// UPDATES & RELEASES
// ============================================================================

export interface ReleaseItem {
  id: number;
  title: string;
  description: string;
  link: string;
  pubDate: string;
  version: string;
  isPrerelease: boolean;
  isDraft: boolean;
  assets: Array<{
    name: string;
    size: number;
    download_count: number;
    download_url: string;
  }>;
}

export interface ReleasesRSSResponse {
  feed: { title: string; description: string; link: string; updated: string };
  items: ReleaseItem[];
  total_count: number;
  cached: boolean;
  cache_age?: number;
}

export async function getReleasesRSS(
  perPage: number = 100,
): Promise<ReleasesRSSResponse> {
  try {
    const response = await authApi.get(`/releases/rss?per_page=${perPage}`);
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch releases RSS");
  }
}

export interface VersionInfo {
  status?: "up_to_date" | "requires_update" | "beta" | "unknown";
  channel?: "stable" | "beta";
  /** Same value as remoteVersion; the endpoint sends both. */
  version?: string;
  localVersion?: string;
  remoteVersion?: string;
  latest_release?: {
    tag_name?: string;
    name?: string;
    published_at?: string;
    html_url?: string;
    body?: string;
  };
  cached?: boolean;
  cache_age?: number;
  // Callers reach for fields beyond the ones above -- SystemOverviewWidget
  // reads `updateAvailable`, which this endpoint does not in fact return --
  // so keep the index signature the previous `Record<string, unknown>` gave
  // them. Typing those reads out of existence is a separate change.
  [key: string]: unknown;
}

// Where the release page lives inside a version response. Both surfaces that
// render a version badge read it, and an empty string is what they treat as
// "no link to offer", so keep the shape in one place rather than repeating the
// optional chain at each call site.
export function releaseUrlFrom(info: VersionInfo | null | undefined): string {
  return info?.latest_release?.html_url ?? "";
}

export async function getVersionInfo(checkRemote = true): Promise<VersionInfo> {
  try {
    const response = await authApi.get(
      `/version${checkRemote ? "" : "?checkRemote=false"}`,
    );
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch version info");
  }
}

export type UpdateChannel = "stable" | "beta";

export interface UpdateChannelState {
  channel: UpdateChannel;
  /** The admin's choice; a beta build reports beta whatever it is. */
  stored: UpdateChannel;
  runningBeta: boolean;
}

export async function getUpdateChannel(): Promise<UpdateChannelState> {
  const response = await authApi.get("/version/channel");
  return response.data;
}

export async function setUpdateChannel(
  channel: UpdateChannel,
): Promise<UpdateChannelState> {
  const response = await authApi.put("/version/channel", { channel });
  return response.data;
}

export interface ReleaseInfo {
  version: string;
  tagName: string;
  name: string;
  url: string;
  publishedAt: string;
  prerelease: boolean;
  notes: string;
}

export async function getChannelReleases(): Promise<{
  localVersion: string | null;
  stable: ReleaseInfo | null;
  beta: ReleaseInfo | null;
}> {
  const response = await authApi.get("/version/releases");
  return response.data;
}

// ============================================================================
// DATABASE HEALTH
// ============================================================================

export async function getDatabaseHealth(): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.get("/health");
    return response.data;
  } catch (error) {
    handleApiError(error, "check database health");
  }
}

// ============================================================================
