import type { AxiosInstance } from "axios";
import { getRemoteCoreApi } from "@/main-axios";
import { getLinkedSession } from "@/lib/linked-server";

/**
 * Hosts shared with a linked account arrive through sync as read-only local
 * copies that already carry the auth the owner shared, so a connection needs
 * nothing extra. Kept for plugins that still call it.
 */
export async function hydrateLocalSharedHostAuth<T>(host: T): Promise<T> {
  return host;
}

/** The linked server's core API, or null when this desktop is not linked. */
export async function getConnectedRemoteApi(): Promise<AxiosInstance | null> {
  return (await getLinkedSession()) ? getRemoteCoreApi() : null;
}

/** The linked server's own id for a host, found by its sync id. */
export async function resolveRemoteHostId(
  syncId: string | null | undefined,
): Promise<number | null> {
  if (!syncId) return null;
  const api = await getConnectedRemoteApi();
  if (!api) return null;
  try {
    const response = await api.get(
      `/sync/v2/hosts/${encodeURIComponent(syncId)}`,
    );
    return typeof response.data?.id === "number" ? response.data.id : null;
  } catch {
    return null;
  }
}
