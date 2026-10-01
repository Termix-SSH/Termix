import { authApi } from "@/main-axios";

export type SyncState = "idle" | "syncing" | "offline" | "error" | "signed_out";

export interface SyncProxyHeader {
  name: string;
  value: string;
  /** A saved header whose value is not sent back. */
  set?: boolean;
}

export interface SyncBasicAuth {
  username: string;
  password: string;
  set?: boolean;
}

export interface SyncEntityInfo {
  type: string;
  owner: string;
  ownerName: string | null;
  readOnly: boolean;
  onServer: boolean;
  onDevice: boolean;
  enabled: boolean;
}

export interface SyncStatus {
  linked: boolean;
  serverUrl?: string;
  serverName?: string | null;
  serverVersion?: string | null;
  account?: {
    username?: string;
    isAdmin?: boolean;
    roles?: string[];
    permissions?: string[];
  };
  status?: SyncState;
  lastError?: string | null;
  linkedAt?: string;
  lastSyncAt?: string | null;
  pending?: number;
  conflicts?: number;
  errors?: number;
  firstSyncDone?: boolean;
  allowInvalidCertificate?: boolean;
  customHeaders?: SyncProxyHeader[];
  basicAuth?: SyncBasicAuth | null;
  entities: SyncEntityInfo[];
}

export type ProbeProblem =
  | "invalid_url"
  | "unreachable"
  | "tls_untrusted"
  | "basic_auth_required"
  | "proxy_login"
  | "not_termix"
  | "version_mismatch"
  | "different_account";

export interface ProbeResult {
  ok: boolean;
  serverUrl?: string;
  name?: string;
  version?: string | null;
  problem?: ProbeProblem;
  message?: string;
}

export interface ServerTarget {
  serverUrl: string;
  customHeaders?: SyncProxyHeader[];
  basicAuth?: SyncBasicAuth | null;
  allowInvalidCertificate?: boolean;
}

export interface SyncConflictItem {
  id: number;
  entityType: string;
  syncId: string;
  name: string;
  createdAt: string;
}

export interface SyncErrorItem {
  entityType: string;
  syncId: string;
  reason: string | null;
}

export async function getSyncStatus(): Promise<SyncStatus> {
  return (await authApi.get("/sync/link/status")).data;
}

export async function probeServer(target: ServerTarget): Promise<ProbeResult> {
  return (await authApi.post("/sync/link/probe", target)).data;
}

export async function getLinkPreview(): Promise<Record<string, number>> {
  return (await authApi.get("/sync/link/preview")).data?.counts ?? {};
}

export async function completeLink(
  input: ServerTarget & {
    token: string;
    mode: "merge" | "replace";
    serverName?: string;
  },
): Promise<SyncStatus> {
  return (await authApi.post("/sync/link/complete", input)).data;
}

export async function reloginLink(token: string): Promise<SyncStatus> {
  return (await authApi.post("/sync/link/relogin", { token })).data;
}

export async function unlinkServer(keepData: boolean): Promise<SyncStatus> {
  return (await authApi.post("/sync/link/unlink", { keepData })).data;
}

export async function syncNow(): Promise<SyncStatus> {
  return (await authApi.post("/sync/link/sync", {}, { timeout: 300_000 })).data;
}

export async function updateSyncSettings(settings: {
  disabledTypes?: string[];
  customHeaders?: SyncProxyHeader[];
  basicAuth?: SyncBasicAuth | null;
  allowInvalidCertificate?: boolean;
}): Promise<SyncStatus> {
  return (await authApi.put("/sync/link/settings", settings)).data;
}

export async function getSyncConflicts(): Promise<SyncConflictItem[]> {
  return (await authApi.get("/sync/link/conflicts")).data?.conflicts ?? [];
}

export async function settleSyncConflict(
  id: number,
  keep: "mine" | "server",
): Promise<void> {
  await authApi.post(`/sync/link/conflicts/${id}`, { keep });
}

export async function getSyncErrors(): Promise<SyncErrorItem[]> {
  return (await authApi.get("/sync/link/errors")).data?.errors ?? [];
}

export async function retrySyncErrors(): Promise<SyncStatus> {
  return (
    await authApi.post("/sync/link/errors/retry", {}, { timeout: 300_000 })
  ).data;
}
