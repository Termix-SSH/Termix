import type { Client } from "ssh2";
import { execCommand } from "../widgets/common-utils.js";
import { isSafeNodeName } from "../../proxmox-shared.js";
import {
  collectProxmoxNodeStatus,
  type ProxmoxNodeStatusResult,
} from "./node-status-collector.js";
import {
  collectProxmoxNodeNetwork,
  type ProxmoxNodeNetworkResult,
} from "./node-network-collector.js";
import {
  collectProxmoxGuestsSummary,
  type ProxmoxGuestsSummaryResult,
} from "./guests-collector.js";
import {
  collectProxmoxStorage,
  type ProxmoxStorageResult,
} from "./storage-collector.js";
import {
  collectProxmoxClusterHealth,
  type ProxmoxClusterHealthResult,
} from "./cluster-health-collector.js";

export interface ProxmoxStatsSnapshot {
  node: ProxmoxNodeStatusResult;
  network: ProxmoxNodeNetworkResult;
  guests: ProxmoxGuestsSummaryResult;
  storage: ProxmoxStorageResult;
  cluster: ProxmoxClusterHealthResult;
  lastChecked: string;
}

async function resolveNodeName(
  client: Client,
  configuredNodeName: string | null | undefined,
): Promise<string> {
  if (configuredNodeName) {
    // An explicitly configured name is validated and used as-is - an unsafe
    // value is rejected outright rather than silently falling back to
    // auto-detection, which would mask a misconfigured (or malicious) override.
    if (!isSafeNodeName(configuredNodeName)) {
      throw new Error("Unable to determine a valid Proxmox node name");
    }
    return configuredNodeName;
  }

  const { stdout } = await execCommand(client, "hostname", 10000);
  return stdout.trim();
}

export async function collectProxmoxStats(
  client: Client,
  configuredNodeName: string | null | undefined,
): Promise<ProxmoxStatsSnapshot> {
  const pveshCheck = await execCommand(
    client,
    "command -v pvesh >/dev/null 2>&1 && echo ok || echo missing",
    10000,
  );
  if (pveshCheck.stdout.trim() !== "ok") {
    throw new Error("pvesh not found — is this a Proxmox node?");
  }

  const nodeName = await resolveNodeName(client, configuredNodeName);
  if (!isSafeNodeName(nodeName)) {
    throw new Error("Unable to determine a valid Proxmox node name");
  }

  const [node, network, guests, storage, cluster] = await Promise.all([
    collectProxmoxNodeStatus(client, nodeName),
    collectProxmoxNodeNetwork(client, nodeName),
    collectProxmoxGuestsSummary(client, nodeName),
    collectProxmoxStorage(client, nodeName),
    collectProxmoxClusterHealth(client),
  ]);

  return {
    node,
    network,
    guests,
    storage,
    cluster,
    lastChecked: new Date().toISOString(),
  };
}
