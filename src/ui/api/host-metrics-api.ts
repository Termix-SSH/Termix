import { handleApiError, statsApi } from "@/main-axios";
import type { HostMetricsLayout } from "@/types/host-metrics";

/**
 * Host Metrics layout persistence (server-synced per user/host) + the manager
 * card endpoints. All routes live under the `/host-metrics/*` prefix on the
 * stats app (port 30005).
 */

export async function getHostMetricsLayout(
  hostId: number,
): Promise<HostMetricsLayout | null> {
  try {
    const res = await statsApi.get(`/host-metrics/preferences/${hostId}`, {
      validateStatus: (status) => status === 200 || status === 404,
    });
    if (res.status === 404) return null;
    return res.data?.layout ?? null;
  } catch (error) {
    handleApiError(error, "fetch host metrics layout");
    throw error;
  }
}

export async function saveHostMetricsLayout(
  hostId: number,
  layout: HostMetricsLayout,
): Promise<void> {
  try {
    await statsApi.post(`/host-metrics/preferences/${hostId}`, layout);
  } catch (error) {
    handleApiError(error, "save host metrics layout");
    throw error;
  }
}

// ─── Managers ───────────────────────────────────────────────────────────────

export interface PlatformInfo {
  hasSystemd: boolean;
  pkg: "apt" | "dnf" | "yum" | "pacman" | null;
  hasCertbot: boolean;
  hasAcmeSh: boolean;
  hasDocker: boolean;
  osPrettyName: string | null;
}

export async function getHostPlatform(hostId: number): Promise<PlatformInfo> {
  const res = await statsApi.get(`/host-metrics/platform/${hostId}`);
  return res.data;
}

/** GET a manager resource (read). */
export async function managerGet<T>(
  hostId: number,
  resource: string,
  params?: Record<string, string | number>,
): Promise<T> {
  const res = await statsApi.get(
    `/host-metrics/managers/${resource}/${hostId}`,
    { params },
  );
  return res.data as T;
}

/**
 * GET a manager sub-resource where the host id sits in the middle of the path,
 * e.g. /managers/logs/{id}/files.
 */
export async function managerGetSub<T>(
  hostId: number,
  resource: string,
  sub: string,
  params?: Record<string, string | number>,
): Promise<T> {
  const res = await statsApi.get(
    `/host-metrics/managers/${resource}/${hostId}/${sub}`,
    { params },
  );
  return res.data as T;
}

/**
 * POST a manager action. `resource` is the manager name; `action` is the
 * optional sub-path (e.g. "action", "signal", "renew"). The host id always
 * sits between them: /managers/{resource}/{id}[/{action}].
 */
export async function managerPost<T>(
  hostId: number,
  resource: string,
  body: unknown,
  action?: string,
): Promise<T> {
  const suffix = action ? `/${action}` : "";
  const res = await statsApi.post(
    `/host-metrics/managers/${resource}/${hostId}${suffix}`,
    body,
  );
  return res.data as T;
}
