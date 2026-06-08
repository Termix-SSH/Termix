import type { LogEntry, ConnectionStage } from "../../types/connection-log.js";

export type StatsCapableHost = {
  connectionType?: string;
  authType?: string;
};

export type TcpPingStatsConfig = {
  statusCheckEnabled: boolean;
  disableTcpPing?: boolean;
};

export function supportsMetrics(host: StatsCapableHost): boolean {
  const connectionType = host.connectionType || "ssh";
  if (connectionType !== "ssh") return false;
  if (host.authType === "none" || host.authType === "opkssh") return false;
  return true;
}

export function isTcpPingEnabled(statsConfig: TcpPingStatsConfig): boolean {
  return statsConfig.statusCheckEnabled && !statsConfig.disableTcpPing;
}

export function createConnectionLog(
  type: "info" | "success" | "warning" | "error",
  stage: ConnectionStage,
  message: string,
  details?: Record<string, unknown>,
): Omit<LogEntry, "id" | "timestamp"> {
  return {
    type,
    stage,
    message,
    details,
  };
}
