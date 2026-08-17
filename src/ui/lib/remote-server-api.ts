import type { AxiosInstance } from "axios";
import { getRemoteStatsApi } from "@/main-axios";
import { isElectron } from "@/lib/electron";
import type { SSHHost } from "@/types/index";

export function markRemoteSharedHosts(hosts: SSHHost[]): SSHHost[] {
  return hosts
    .filter((host) => host.isShared)
    .map((host) => ({
      ...host,
      // Local SQLite ids are positive. Negative ids keep remote-only shared
      // rows distinct while syncId remains the delegated backend identity.
      id: -Math.abs(host.id),
      connectionOrigin: "remote" as const,
    }));
}

export async function getConnectedRemoteApi(): Promise<AxiosInstance | null> {
  if (!isElectron()) return null;
  try {
    const config = (await window.electronAPI?.invoke?.(
      "get-remote-sync-config",
    )) as { serverUrl?: string } | null;
    return config?.serverUrl ? getRemoteStatsApi() : null;
  } catch {
    return null;
  }
}

export async function resolveRemoteHostId(
  syncId: string | null | undefined,
): Promise<number | null> {
  if (!syncId) return null;
  const api = await getConnectedRemoteApi();
  if (!api) return null;
  const response = await api.get("/sync/hosts");
  const host = (response.data?.rows ?? []).find(
    (row: { syncId?: string }) => row.syncId === syncId,
  );
  return typeof host?.id === "number" ? host.id : null;
}
