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
    }));
}

export interface SharedHostConnectionAuth {
  username?: string | null;
  authType?: string | null;
  password?: string | null;
  key?: string | null;
  keyPassword?: string | null;
  keyType?: string | null;
}

export async function getRemoteSharedHostConnectionAuth(
  localHostId: number,
): Promise<SharedHostConnectionAuth> {
  if (localHostId >= 0) {
    throw new Error("Expected a remote shared host id");
  }
  const api = await getConnectedRemoteApi();
  if (!api) throw new Error("Remote server is not connected");
  const response = await api.get(
    `/host/db/host/${Math.abs(localHostId)}/local-connection-auth`,
  );
  return response.data;
}

export async function hydrateLocalSharedHostAuth<
  T extends {
    id?: number;
    isShared?: unknown;
    syncId?: string | null;
    credentialId?: number;
    username: string;
    authType?: string;
    password?: string;
    key?: string;
    keyPassword?: string;
    keyType?: string;
  },
>(host: T): Promise<T> {
  if (!host.isShared || typeof host.id !== "number" || host.id >= 0) {
    return host;
  }

  const auth = await getRemoteSharedHostConnectionAuth(host.id);
  return {
    ...host,
    // This row deliberately does not exist in the embedded database. Avoid
    // asking the local backend to resolve its remote sync identity again.
    syncId: null,
    credentialId: undefined,
    username: auth.username || host.username,
    authType: auth.authType || host.authType,
    password: auth.password || undefined,
    key: auth.key || undefined,
    keyPassword: auth.keyPassword || undefined,
    keyType: auth.keyType || undefined,
  };
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
