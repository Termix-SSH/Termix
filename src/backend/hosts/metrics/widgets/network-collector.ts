import type { Client } from "ssh2";
import {
  execCommand,
  execPowerShell,
  type HostPlatform,
} from "./common-utils.js";

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

async function collectDarwinNetworkMetrics(client: Client): Promise<{
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
      const firstReadAt = Date.now();
      const netstat1 = await execCommand(client, "netstat -ib 2>/dev/null");
      await new Promise((resolve) => setTimeout(resolve, 500));
      const netstat2 = await execCommand(client, "netstat -ib 2>/dev/null");
      const elapsedSeconds = (Date.now() - firstReadAt) / 1000;
      const before = parseDarwinNetstat(netstat1.stdout);
      const after = parseDarwinNetstat(netstat2.stdout);
      if (ifMap.size === 0) {
        for (const name of before.keys()) {
          ifMap.set(name, { ip: "", state: "UNKNOWN" });
        }
      }
      for (const [name, data] of ifMap.entries()) {
        const b = before.get(name);
        const a = after.get(name);
        interfaces.push({
          name,
          ip: data.ip,
          state: data.state,
          rxBytes: b?.rx ?? null,
          txBytes: b?.tx ?? null,
          rxRateBps: counterRate(b?.rx, a?.rx, elapsedSeconds),
          txRateBps: counterRate(b?.tx, a?.tx, elapsedSeconds),
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

async function collectWindowsNetworkMetrics(client: Client): Promise<{
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
    const firstReadAt = Date.now();
    const before = await execPowerShell(client, WINDOWS_ADAPTER_SCRIPT);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const after = await execPowerShell(client, WINDOWS_ADAPTER_SCRIPT);
    const elapsedSeconds = (Date.now() - firstReadAt) / 1000;

    const beforeRows = parseWindowsAdapterJson(before.stdout);
    const afterMap = new Map(
      parseWindowsAdapterJson(after.stdout).map((row) => [row.name, row]),
    );

    for (const row of beforeRows) {
      const afterRow = afterMap.get(row.name);
      interfaces.push({
        name: row.name,
        ip: row.ip,
        state: row.state,
        rxBytes: row.rx || null,
        txBytes: row.tx || null,
        rxRateBps: counterRate(row.rx, afterRow?.rx, elapsedSeconds),
        txRateBps: counterRate(row.tx, afterRow?.tx, elapsedSeconds),
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
    return collectDarwinNetworkMetrics(client);
  }
  if (platform === "windows") {
    return collectWindowsNetworkMetrics(client);
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
