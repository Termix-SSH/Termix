import { authApi, getBackendUrl } from "@/main-axios";

export interface RequestInfoResponse {
  version: string | null;
  serverTime: string;
  safeMode: boolean;
  request: {
    method: string;
    protocol: string;
    headerNames: string[];
    cookieNames: string[];
    authCookie: boolean;
    authHeader: boolean;
    forwarded: {
      hops: number;
      proto: string | null;
      hostDiffers: boolean;
      port: string | null;
    };
    clientIp: string;
    proxySigns: string[];
    userAgent: string | null;
  };
}

export interface ServerLogLine {
  seq: number;
  at: string;
  level: "debug" | "info" | "success" | "warn" | "error";
  service: string;
  pluginId?: string;
  operation?: string;
  text: string;
}

export interface ServerLogs {
  boot: ServerLogLine[];
  recent: ServerLogLine[];
  latest: number;
  droppedBefore: number | null;
}

export interface ServerPart {
  server: Record<string, unknown>;
  plugins: {
    plugins: Array<Record<string, unknown> & { id: string }>;
    skipped: Array<{ id: string; version: string | null; error: string }>;
  };
  sections: Array<{
    pluginId: string;
    title: string;
    data?: unknown;
    error?: string;
  }>;
  logs: ServerLogs | null;
  request: RequestInfoResponse["request"];
}

/** Works signed out: plain fetch with whatever cookie there is. */
export async function getRequestInfo(): Promise<RequestInfoResponse> {
  const response = await fetch(getBackendUrl("/diagnostics/request"), {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as RequestInfoResponse;
}

export async function getServerPart(options: {
  logs: boolean;
  sections: boolean;
  pluginId?: string;
  levels?: string[];
}): Promise<ServerPart> {
  const params = new URLSearchParams();
  if (!options.logs) params.set("logs", "0");
  if (!options.sections) params.set("sections", "0");
  if (options.pluginId) params.set("pluginId", options.pluginId);
  if (options.levels?.length) params.set("levels", options.levels.join(","));
  const response = await authApi.get(`/diagnostics/server?${params}`);
  return response.data as ServerPart;
}

export async function getServerLogs(query: {
  after?: number;
  levels?: string[];
  pluginId?: string;
  limit?: number;
}): Promise<ServerLogs> {
  const params = new URLSearchParams();
  if (query.after !== undefined) params.set("after", String(query.after));
  if (query.levels?.length) params.set("levels", query.levels.join(","));
  if (query.pluginId) params.set("pluginId", query.pluginId);
  if (query.limit) params.set("limit", String(query.limit));
  const response = await authApi.get(`/diagnostics/logs?${params}`);
  return response.data as ServerLogs;
}
