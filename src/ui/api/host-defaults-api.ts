import { handleApiError, sshHostApi } from "@/main-axios";
import { invalidateHostsAndStatusCaches } from "@/lib/hosts-request-cache";
import type {
  HostDefaultsLevel,
  ResolvedHostDefault,
} from "@/types/host-defaults";

// HOST DEFAULTS
// ============================================================================

export interface HostDefaultsLevelData {
  /** Values set at this level, by "namespace.key". */
  values: Record<string, unknown>;
  /** What each key reads when this level leaves it unset. */
  inherited: Record<string, ResolvedHostDefault>;
}

export interface HostDefaultsTarget {
  level: HostDefaultsLevel;
  folderId?: number;
}

export interface HostDefaultsChange {
  set: Record<string, unknown>;
  unset: string[];
}

function levelPath(target: HostDefaultsTarget): string {
  if (target.level === "admin") return "/defaults/admin";
  if (target.level === "user") return "/defaults/user";
  return `/defaults/folders/${target.folderId}`;
}

function adminHeaders(targetUserId?: string): Record<string, string> {
  return targetUserId ? { "X-Admin-Target-User": targetUserId } : {};
}

export async function getHostDefaultsLevel(
  target: HostDefaultsTarget,
): Promise<HostDefaultsLevelData> {
  try {
    const response = await sshHostApi.get(levelPath(target));
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch host defaults");
  }
}

export async function saveHostDefaultsLevel(
  target: HostDefaultsTarget,
  change: HostDefaultsChange,
): Promise<{ changedHosts?: number; jobId?: string }> {
  try {
    const response = await sshHostApi.put(levelPath(target), change);
    invalidateHostsAndStatusCaches();
    return response.data;
  } catch (error) {
    handleApiError(error, "save host defaults");
  }
}

export async function previewHostDefaultsLevel(
  target: HostDefaultsTarget,
  change: HostDefaultsChange,
): Promise<{ changedHosts: number }> {
  try {
    const response = await sshHostApi.post("/defaults/preview", {
      ...target,
      ...change,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "preview host defaults");
  }
}

export async function getHostDefaultsJob(
  id: string,
): Promise<{ status: "running" | "done" | "failed"; changedHosts: number }> {
  try {
    const response = await sshHostApi.get(`/defaults/jobs/${id}`);
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch host defaults progress");
  }
}

/** A folder's id for its defaults, created when it only exists on hosts. */
export async function getFolderDefaultsId(name: string): Promise<number> {
  try {
    const response = await sshHostApi.post("/defaults/folders", { name });
    return response.data.id;
  } catch (error) {
    handleApiError(error, "open folder defaults");
  }
}

/** What a host, or a new one in a folder or under a parent, resolves to. */
export async function resolveHostDefaults(
  where: {
    hostId?: number;
    folder?: string | null;
    parentHostId?: number | null;
  },
  adminTargetUserId?: string,
): Promise<Record<string, ResolvedHostDefault>> {
  try {
    const params: Record<string, string> = {};
    if (where.hostId !== undefined) params.hostId = String(where.hostId);
    if (where.folder !== undefined) params.folder = where.folder ?? "";
    if (where.parentHostId !== undefined && where.parentHostId !== null) {
      params.parentHostId = String(where.parentHostId);
    }
    const response = await sshHostApi.get("/defaults/resolve", {
      params,
      headers: adminHeaders(adminTargetUserId),
    });
    return response.data.values ?? {};
  } catch (error) {
    handleApiError(error, "resolve host defaults");
  }
}

export async function resetHostToDefaults(
  hostIds: number[],
  reset: { all?: boolean; namespaces?: string[]; keys?: string[] },
): Promise<void> {
  try {
    if (hostIds.length === 1) {
      await sshHostApi.post(`/db/host/${hostIds[0]}/reset-defaults`, reset);
    } else {
      await sshHostApi.patch("/bulk-update", {
        hostIds,
        updates: { resetDefaults: reset },
      });
    }
    invalidateHostsAndStatusCaches();
  } catch (error) {
    handleApiError(error, "reset hosts to defaults");
  }
}

/** Waits for a server-wide defaults job. Resolves to the hosts it changed, or null. */
export async function waitForDefaultsJob(
  id: string,
  intervalMs = 1500,
  maxWaitMs = 10 * 60 * 1000,
): Promise<number | null> {
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    try {
      const job = await getHostDefaultsJob(id);
      if (job.status === "done") return job.changedHosts;
      if (job.status === "failed") return null;
    } catch {
      return null;
    }
  }
  return null;
}
