import type { Client } from "ssh2";
import { execCommand } from "./common-utils.js";

export interface NetworkCounters {
  rx: string;
  tx: string;
}

export function parseNetworkCounters(
  output: string,
): Map<string, NetworkCounters> {
  const counters = new Map<string, NetworkCounters>();
  for (const line of output.split("\n").slice(2)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 10) {
      counters.set(parts[0].replace(":", ""), {
        rx: parts[1],
        tx: parts[9],
      });
    }
  }
  return counters;
}

export function counterRate(
  before: string | undefined,
  after: string | undefined,
  elapsedSeconds: number,
): number | null {
  const first = Number(before);
  const second = Number(after);
  if (
    !Number.isFinite(first) ||
    !Number.isFinite(second) ||
    second < first ||
    elapsedSeconds <= 0
  ) {
    return null;
  }
  return Math.round((second - first) / elapsedSeconds);
}

export async function collectNetworkMetrics(client: Client): Promise<{
  interfaces: Array<{
    name: string;
    ip: string;
    state: string;
    rxBytes: string | null;
    txBytes: string | null;
    rxRateBps: number | null;
    txRateBps: number | null;
  }>;
}> {
  const interfaces: Array<{
    name: string;
    ip: string;
    state: string;
    rxBytes: string | null;
    txBytes: string | null;
    rxRateBps: number | null;
    txRateBps: number | null;
  }> = [];

  try {
    const ifconfigOut = await execCommand(
      client,
      "ip -o addr show 2>/dev/null | awk '{print $2,$4}' | grep -v '^lo' || true",
    );
    const netStatOut = await execCommand(
      client,
      "ip -o link show 2>/dev/null | awk '{gsub(/:/, \"\", $2); print $2,$9}' || true",
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
        if (name === "lo") continue;
        const state = parts[1];
        const existing = ifMap.get(name);
        if (existing) {
          existing.state = state;
        } else {
          ifMap.set(name, { ip: "", state });
        }
      }
    }

    try {
      const firstReadAt = Date.now();
      const procNet = await execCommand(client, "cat /proc/net/dev");
      await new Promise((resolve) => setTimeout(resolve, 500));
      const procNetAfter = await execCommand(client, "cat /proc/net/dev");
      const elapsedSeconds = (Date.now() - firstReadAt) / 1000;
      const rxTxMap = parseNetworkCounters(procNet.stdout);
      const afterMap = parseNetworkCounters(procNetAfter.stdout);
      if (ifMap.size === 0) {
        for (const name of rxTxMap.keys()) {
          if (name !== "lo") ifMap.set(name, { ip: "", state: "UNKNOWN" });
        }
      }
      for (const [name, data] of ifMap.entries()) {
        const rxTx = rxTxMap.get(name);
        const after = afterMap.get(name);
        interfaces.push({
          name,
          ip: data.ip,
          state: data.state,
          rxBytes: rxTx?.rx ?? null,
          txBytes: rxTx?.tx ?? null,
          rxRateBps: counterRate(rxTx?.rx, after?.rx, elapsedSeconds),
          txRateBps: counterRate(rxTx?.tx, after?.tx, elapsedSeconds),
        });
      }
    } catch {
      for (const [name, data] of ifMap.entries()) {
        interfaces.push({
          name,
          ip: data.ip,
          state: data.state,
          rxBytes: null,
          txBytes: null,
          rxRateBps: null,
          txRateBps: null,
        });
      }
    }
  } catch {
    // expected
  }

  return { interfaces };
}
