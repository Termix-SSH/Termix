import type { Client } from "ssh2";

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

export function tcpPingThroughJumpHost(
  jumpClient: Pick<Client, "forwardOut" | "end">,
  host: string,
  port: number,
  timeoutMs = 5000,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      jumpClient.end();
      resolve(result);
    };

    const timeout = setTimeout(() => finish(false), timeoutMs);

    jumpClient.forwardOut("127.0.0.1", 0, host, port, (error, stream) => {
      stream?.destroy();
      finish(!error && !!stream);
    });
  });
}
