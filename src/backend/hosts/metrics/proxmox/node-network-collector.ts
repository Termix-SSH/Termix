import type { Client } from "ssh2";
import { execCommand } from "../widgets/common-utils.js";
import { isSafeNodeName } from "../../proxmox-shared.js";

export interface ProxmoxNodeNetworkInterface {
  name: string;
  ip: string | null;
  state: string | null;
  rxBytes: string | null;
  txBytes: string | null;
}

export interface ProxmoxNodeNetworkResult {
  interfaces: ProxmoxNodeNetworkInterface[];
}

const EMPTY_RESULT: ProxmoxNodeNetworkResult = { interfaces: [] };

async function collectFromProcNetDev(
  client: Client,
): Promise<ProxmoxNodeNetworkResult> {
  const interfaces: ProxmoxNodeNetworkInterface[] = [];

  try {
    const [addrOut, stateOut, procNetOut] = await Promise.all([
      execCommand(
        client,
        "ip -o addr show | awk '{print $2,$4}' | grep -v '^lo'",
      ),
      execCommand(
        client,
        "ip -o link show | awk '{gsub(/:/, \"\", $2); print $2,$9}'",
      ),
      execCommand(client, "cat /proc/net/dev"),
    ]);

    const ifMap = new Map<
      string,
      { ip: string | null; state: string | null }
    >();
    for (const line of addrOut.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)) {
      const parts = line.split(/\s+/);
      if (parts.length >= 2) {
        const name = parts[0];
        const ip = parts[1].split("/")[0];
        if (!ifMap.has(name)) ifMap.set(name, { ip, state: null });
      }
    }
    for (const line of stateOut.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)) {
      const parts = line.split(/\s+/);
      if (parts.length >= 2) {
        const existing = ifMap.get(parts[0]);
        if (existing) existing.state = parts[1];
      }
    }

    const rxTxMap = new Map<string, { rx: string; tx: string }>();
    for (const line of procNetOut.stdout.split("\n").slice(2)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 10) {
        const ifName = parts[0].replace(":", "");
        rxTxMap.set(ifName, { rx: parts[1], tx: parts[9] });
      }
    }

    for (const [name, data] of ifMap.entries()) {
      const rxTx = rxTxMap.get(name);
      interfaces.push({
        name,
        ip: data.ip,
        state: data.state,
        rxBytes: rxTx?.rx ?? null,
        txBytes: rxTx?.tx ?? null,
      });
    }
  } catch {
    return EMPTY_RESULT;
  }

  return { interfaces };
}

export async function collectProxmoxNodeNetwork(
  client: Client,
  nodeName: string,
): Promise<ProxmoxNodeNetworkResult> {
  if (!isSafeNodeName(nodeName)) {
    return EMPTY_RESULT;
  }

  try {
    const { stdout, code } = await execCommand(
      client,
      `pvesh get /nodes/${nodeName}/netstat --output-format json`,
      15000,
    );
    if (code !== 0) {
      return collectFromProcNetDev(client);
    }

    const data = JSON.parse(stdout);
    if (!Array.isArray(data)) {
      return collectFromProcNetDev(client);
    }

    const interfaces: ProxmoxNodeNetworkInterface[] = data
      .filter(
        (entry): entry is Record<string, unknown> =>
          !!entry && typeof entry === "object",
      )
      .map((entry) => ({
        name:
          typeof entry.dev === "string" ? entry.dev : String(entry.dev ?? ""),
        ip: null,
        state: null,
        rxBytes:
          typeof entry.in === "number"
            ? String(entry.in)
            : typeof entry.received === "number"
              ? String(entry.received)
              : null,
        txBytes:
          typeof entry.out === "number"
            ? String(entry.out)
            : typeof entry.transmitted === "number"
              ? String(entry.transmitted)
              : null,
      }))
      .filter((iface) => iface.name && iface.name !== "lo");

    if (interfaces.length === 0) {
      return collectFromProcNetDev(client);
    }

    return { interfaces };
  } catch {
    return collectFromProcNetDev(client);
  }
}
