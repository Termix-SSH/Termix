import type { Client } from "ssh2";
import { execCommand } from "./common-utils.js";
import { statsLogger } from "../../utils/logger.js";

export async function collectNetworkMetrics(client: Client): Promise<{
  interfaces: Array<{
    name: string;
    ip: string;
    state: string;
    rxBytes: string | null;
    txBytes: string | null;
  }>;
}> {
  const interfaces: Array<{
    name: string;
    ip: string;
    state: string;
    rxBytes: string | null;
    txBytes: string | null;
  }> = [];

  try {
    const ifconfigOut = await execCommand(
      client,
      "ip -o addr show | awk '{print $2,$4}' | grep -v '^lo'",
    );
    const netStatOut = await execCommand(
      client,
      "ip -o link show | awk '{gsub(/:/, \"\", $2); print $2,$9}'",
    );

    const addrs = ifconfigOut.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const states = netStatOut.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const ifMap = new Map<string, { ip: string; state: string }>();
    for (const line of addrs) {
      const parts = line.split(/\s+/);
      if (parts.length >= 2) {
        const name = parts[0];
        const ip = parts[1].split("/")[0];
        if (!ifMap.has(name)) ifMap.set(name, { ip, state: "UNKNOWN" });
      }
    }
    for (const line of states) {
      const parts = line.split(/\s+/);
      if (parts.length >= 2) {
        const name = parts[0];
        const state = parts[1];
        const existing = ifMap.get(name);
        if (existing) {
          existing.state = state;
        }
      }
    }

    for (const [name, data] of ifMap.entries()) {
      interfaces.push({
        name,
        ip: data.ip,
        state: data.state,
        rxBytes: null,
        txBytes: null,
      });
    }
  } catch (e) {
    statsLogger.debug("Failed to collect network interface stats", {
      operation: "network_stats_failed",
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return { interfaces };
}
