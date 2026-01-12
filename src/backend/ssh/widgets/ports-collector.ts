import type { Client } from "ssh2";
import { execCommand } from "./common-utils.js";
import type { PortsMetrics, ListeningPort } from "../../../types/stats-widgets.js";

function parseSsOutput(output: string): ListeningPort[] {
  const ports: ListeningPort[] = [];
  const lines = output.split("\n").slice(1);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(/\s+/);
    if (parts.length < 5) continue;

    const protocol = parts[0]?.toLowerCase();
    if (protocol !== "tcp" && protocol !== "udp") continue;

    const state = parts[1];
    const localAddr = parts[4];

    if (!localAddr) continue;

    const lastColon = localAddr.lastIndexOf(":");
    if (lastColon === -1) continue;

    const address = localAddr.substring(0, lastColon);
    const portStr = localAddr.substring(lastColon + 1);
    const port = parseInt(portStr, 10);

    if (isNaN(port)) continue;

    const portEntry: ListeningPort = {
      protocol: protocol as "tcp" | "udp",
      localAddress: address.replace(/^\[|\]$/g, ""),
      localPort: port,
      state: protocol === "tcp" ? state : undefined,
    };

    const processInfo = parts[6];
    if (processInfo && processInfo.startsWith("users:")) {
      const pidMatch = processInfo.match(/pid=(\d+)/);
      const nameMatch = processInfo.match(/\("([^"]+)"/);
      if (pidMatch) portEntry.pid = parseInt(pidMatch[1], 10);
      if (nameMatch) portEntry.process = nameMatch[1];
    }

    ports.push(portEntry);
  }

  return ports;
}

function parseNetstatOutput(output: string): ListeningPort[] {
  const ports: ListeningPort[] = [];
  const lines = output.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(/\s+/);
    if (parts.length < 4) continue;

    const proto = parts[0]?.toLowerCase();
    if (!proto) continue;

    let protocol: "tcp" | "udp";
    if (proto.startsWith("tcp")) {
      protocol = "tcp";
    } else if (proto.startsWith("udp")) {
      protocol = "udp";
    } else {
      continue;
    }

    const localAddr = parts[3];
    if (!localAddr) continue;

    const lastColon = localAddr.lastIndexOf(":");
    if (lastColon === -1) continue;

    const address = localAddr.substring(0, lastColon);
    const portStr = localAddr.substring(lastColon + 1);
    const port = parseInt(portStr, 10);

    if (isNaN(port)) continue;

    const portEntry: ListeningPort = {
      protocol,
      localAddress: address,
      localPort: port,
    };

    if (protocol === "tcp" && parts.length >= 6) {
      portEntry.state = parts[5];
    }

    const pidProgram = parts[parts.length - 1];
    if (pidProgram && pidProgram.includes("/")) {
      const [pidStr, process] = pidProgram.split("/");
      const pid = parseInt(pidStr, 10);
      if (!isNaN(pid)) portEntry.pid = pid;
      if (process) portEntry.process = process;
    }

    ports.push(portEntry);
  }

  return ports;
}

export async function collectPortsMetrics(
  client: Client,
): Promise<PortsMetrics> {
  try {
    const ssResult = await execCommand(
      client,
      "ss -tulnp 2>/dev/null",
      15000,
    );

    if (ssResult.stdout && ssResult.stdout.includes("Local")) {
      const ports = parseSsOutput(ssResult.stdout);
      return {
        source: "ss",
        ports: ports.sort((a, b) => a.localPort - b.localPort),
      };
    }

    const netstatResult = await execCommand(
      client,
      "netstat -tulnp 2>/dev/null",
      15000,
    );

    if (netstatResult.stdout && netstatResult.stdout.includes("Local")) {
      const ports = parseNetstatOutput(netstatResult.stdout);
      return {
        source: "netstat",
        ports: ports.sort((a, b) => a.localPort - b.localPort),
      };
    }

    return {
      source: "none",
      ports: [],
    };
  } catch {
    return {
      source: "none",
      ports: [],
    };
  }
}
