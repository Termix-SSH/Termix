import {
  execCommand,
  execPowerShell,
  type HostPlatform,
} from "@termix/plugin-sdk/host-commands";
import type { Client } from "ssh2";

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

/**
 * Rate is derived from the previous poll's counters rather than a same-poll
 * double-sample, so a poll no longer has to block for a fixed settle window.
 * Keyed by host, since counters from one host are meaningless against another.
 */
export interface NetworkSamples {
  counters: Map<
    number,
    { counters: Map<string, NetworkCounters>; timestamp: number }
  >;
  windows: Map<number, { rows: WindowsAdapterRow[]; timestamp: number }>;
}

export function createNetworkSamples(): NetworkSamples {
  return { counters: new Map(), windows: new Map() };
}

export function parseDarwinIfconfig(
  output: string,
): Map<string, { ip: string; state: string }> {
  const map = new Map<string, { ip: string; state: string }>();
  let current: string | null = null;
  for (const rawLine of output.split("\n")) {
    const ifaceMatch = rawLine.match(/^(\S+):\s*flags=\d+<([^>]*)>/);
    if (ifaceMatch) {
      current = ifaceMatch[1] === "lo0" ? null : ifaceMatch[1];
      if (current) {
        const state = ifaceMatch[2].includes("UP") ? "UP" : "DOWN";
        map.set(current, { ip: "", state });
      }
      continue;
    }
    if (!current) continue;
    const inetMatch = rawLine.match(/^\s+inet\s+(\d+\.\d+\.\d+\.\d+)/);
    if (inetMatch) {
      const existing = map.get(current);
      if (existing && !existing.ip) existing.ip = inetMatch[1];
    }
  }
  return map;
}

export function parseDarwinNetstat(
  output: string,
): Map<string, NetworkCounters> {
  const counters = new Map<string, NetworkCounters>();
  for (const line of output.split("\n").slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 10) continue;
    const name = parts[0];
    if (name === "lo0" || !parts[2]?.startsWith("<Link")) continue;
    if (!counters.has(name)) {
      counters.set(name, { rx: parts[6], tx: parts[9] });
    }
  }
  return counters;
}

async function collectDarwinNetworkMetrics(
  client: Client,
  hostId: number | undefined,
  samples: NetworkSamples,
): Promise<{
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
    const ifconfigOut = await execCommand(client, "ifconfig -a 2>/dev/null");
    const ifMap = parseDarwinIfconfig(ifconfigOut.stdout);

    try {
      const readAt = Date.now();
      const netstatOut = await execCommand(client, "netstat -ib 2>/dev/null");
      const current = parseDarwinNetstat(netstatOut.stdout);
      const previous =
        hostId !== undefined ? samples.counters.get(hostId) : undefined;
      const elapsedSeconds = previous
        ? (readAt - previous.timestamp) / 1000
        : 0;
      if (ifMap.size === 0) {
        for (const name of current.keys()) {
          ifMap.set(name, { ip: "", state: "UNKNOWN" });
        }
      }
      for (const [name, data] of ifMap.entries()) {
        const c = current.get(name);
        const p = previous?.counters.get(name);
        interfaces.push({
          name,
          ip: data.ip,
          state: data.state,
          rxBytes: c?.rx ?? null,
          txBytes: c?.tx ?? null,
          rxRateBps: p ? counterRate(p.rx, c?.rx, elapsedSeconds) : null,
          txRateBps: p ? counterRate(p.tx, c?.tx, elapsedSeconds) : null,
        });
      }
      if (hostId !== undefined) {
        samples.counters.set(hostId, { counters: current, timestamp: readAt });
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

interface WindowsAdapterRow {
  name: string;
  ip: string;
  state: string;
  rx: string;
  tx: string;
}

const WINDOWS_ADAPTER_SCRIPT =
  "Get-NetAdapter | Where-Object {$_.Status -eq 'Up'} | ForEach-Object {" +
  " $stats = Get-NetAdapterStatistics -Name $_.Name -ErrorAction SilentlyContinue;" +
  " $addr = (Get-NetIPAddress -InterfaceIndex $_.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress;" +
  " [PSCustomObject]@{name=$_.Name; ip=$addr; state='UP'; rx=$stats.ReceivedBytes; tx=$stats.SentBytes}" +
  " } | ConvertTo-Json -Compress";

export function parseWindowsAdapterJson(output: string): WindowsAdapterRow[] {
  const trimmed = output.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows
      .filter((row): row is Record<string, unknown> => Boolean(row?.name))
      .map((row) => ({
        name: String(row.name),
        ip: row.ip ? String(row.ip) : "",
        state: String(row.state ?? "UNKNOWN"),
        rx: String(row.rx ?? ""),
        tx: String(row.tx ?? ""),
      }));
  } catch {
    return [];
  }
}

async function collectWindowsNetworkMetrics(
  client: Client,
  hostId: number | undefined,
  samples: NetworkSamples,
): Promise<{
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
    const readAt = Date.now();
    const result = await execPowerShell(client, WINDOWS_ADAPTER_SCRIPT);
    const currentRows = parseWindowsAdapterJson(result.stdout);
    const previous =
      hostId !== undefined ? samples.windows.get(hostId) : undefined;
    const elapsedSeconds = previous ? (readAt - previous.timestamp) / 1000 : 0;
    const previousMap = new Map(
      (previous?.rows ?? []).map((row) => [row.name, row]),
    );

    for (const row of currentRows) {
      const previousRow = previousMap.get(row.name);
      interfaces.push({
        name: row.name,
        ip: row.ip,
        state: row.state,
        rxBytes: row.rx || null,
        txBytes: row.tx || null,
        rxRateBps: previousRow
          ? counterRate(previousRow.rx, row.rx, elapsedSeconds)
          : null,
        txRateBps: previousRow
          ? counterRate(previousRow.tx, row.tx, elapsedSeconds)
          : null,
      });
    }

    if (hostId !== undefined) {
      samples.windows.set(hostId, {
        rows: currentRows,
        timestamp: readAt,
      });
    }
  } catch {
    // expected
  }

  return { interfaces };
}

export async function collectNetworkMetrics(
  client: Client,
  platform?: HostPlatform,
  hostId?: number,
  samples: NetworkSamples = createNetworkSamples(),
): Promise<{
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
  if (platform === "darwin") {
    return collectDarwinNetworkMetrics(client, hostId, samples);
  }
  if (platform === "windows") {
    return collectWindowsNetworkMetrics(client, hostId, samples);
  }

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
      const readAt = Date.now();
      const procNet = await execCommand(client, "cat /proc/net/dev");
      const rxTxMap = parseNetworkCounters(procNet.stdout);
      const previous =
        hostId !== undefined ? samples.counters.get(hostId) : undefined;
      const elapsedSeconds = previous
        ? (readAt - previous.timestamp) / 1000
        : 0;
      if (ifMap.size === 0) {
        for (const name of rxTxMap.keys()) {
          if (name !== "lo") ifMap.set(name, { ip: "", state: "UNKNOWN" });
        }
      }
      for (const [name, data] of ifMap.entries()) {
        const rxTx = rxTxMap.get(name);
        const previousCounters = previous?.counters.get(name);
        interfaces.push({
          name,
          ip: data.ip,
          state: data.state,
          rxBytes: rxTx?.rx ?? null,
          txBytes: rxTx?.tx ?? null,
          rxRateBps: previousCounters
            ? counterRate(previousCounters.rx, rxTx?.rx, elapsedSeconds)
            : null,
          txRateBps: previousCounters
            ? counterRate(previousCounters.tx, rxTx?.tx, elapsedSeconds)
            : null,
        });
      }
      if (hostId !== undefined) {
        samples.counters.set(hostId, {
          counters: rxTxMap,
          timestamp: readAt,
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
