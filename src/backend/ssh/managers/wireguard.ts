import type { Express } from "express";
import { execElevated } from "./exec-elevated.js";
import { managerHandler } from "./route-helpers.js";
import { ManagerInputError } from "./route-helpers.js";
import type { ManagerRoutesDeps } from "./types.js";
import {
  isValidWireGuardInterface,
  isValidWireGuardAction,
} from "./validation.js";

export interface WireGuardPeer {
  publicKey: string;
  endpoint: string | null;
  allowedIPs: string[];
  latestHandshake: number | null;
  rxBytes: number;
  txBytes: number;
}

export interface WireGuardInterface {
  name: string;
  publicKey: string | null;
  listenPort: number | null;
  up: boolean;
  peers: WireGuardPeer[];
}

export interface WireGuardData {
  installed: boolean;
  interfaces: WireGuardInterface[];
}

const PROBE_CMD = [
  "command -v wg >/dev/null 2>&1 && echo wg_installed=1 || echo wg_installed=0",
  "ip link show type wireguard 2>/dev/null",
  "echo __DUMP__",
  "wg show all dump 2>/dev/null",
].join("; ");

export function parseWireGuardData(output: string): WireGuardData {
  if (output.includes("wg_installed=0")) {
    return { installed: false, interfaces: [] };
  }

  const dumpIdx = output.indexOf("__DUMP__");
  const ipLinkPart = dumpIdx >= 0 ? output.slice(0, dumpIdx) : "";
  const dumpPart =
    dumpIdx >= 0 ? output.slice(dumpIdx + "__DUMP__".length) : "";

  // Collect up interface names from `ip link show type wireguard`
  const upSet = new Set<string>();
  for (const line of ipLinkPart.split("\n")) {
    const m = line.match(/^\d+:\s+([A-Za-z0-9_-]+):/);
    if (m) upSet.add(m[1]);
  }

  const ifaceMap = new Map<string, WireGuardInterface>();

  for (const raw of dumpPart.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const cols = line.split("\t");

    if (cols.length === 5) {
      // Interface row: iface private_key public_key listen_port fwmark
      const [name, , publicKey, listenPortStr] = cols;
      if (!name) continue;
      ifaceMap.set(name, {
        name,
        publicKey: publicKey && publicKey !== "(none)" ? publicKey : null,
        listenPort:
          listenPortStr && listenPortStr !== "(none)"
            ? Number(listenPortStr)
            : null,
        up: upSet.has(name),
        peers: [],
      });
    } else if (cols.length === 9) {
      // Peer row: iface public_key preshared_key endpoint allowed_ips latest_handshake rx_bytes tx_bytes persistent_keepalive
      const [
        name,
        publicKey,
        ,
        endpoint,
        allowedIPsStr,
        handshakeStr,
        rxStr,
        txStr,
      ] = cols;
      if (!name) continue;

      if (!ifaceMap.has(name)) {
        ifaceMap.set(name, {
          name,
          publicKey: null,
          listenPort: null,
          up: upSet.has(name),
          peers: [],
        });
      }

      const handshake = Number(handshakeStr);
      ifaceMap.get(name)!.peers.push({
        publicKey: publicKey ?? "",
        endpoint: endpoint && endpoint !== "(none)" ? endpoint : null,
        allowedIPs:
          allowedIPsStr && allowedIPsStr !== "(none)"
            ? allowedIPsStr.split(",").map((s) => s.trim())
            : [],
        latestHandshake: handshake > 0 ? handshake : null,
        rxBytes: Number(rxStr) || 0,
        txBytes: Number(txStr) || 0,
      });
    }
  }

  return { installed: true, interfaces: Array.from(ifaceMap.values()) };
}

export function registerWireGuardRoutes(
  app: Express,
  { validateHostId, runOnHost }: ManagerRoutesDeps,
): void {
  /**
   * @openapi
   * /host-metrics/managers/wireguard/{id}:
   *   get:
   *     summary: Get WireGuard interfaces and peers
   *     tags:
   *       - Host Metrics
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: WireGuard installation status, interfaces, and peer details.
   */
  app.get(
    "/host-metrics/managers/wireguard/:id",
    validateHostId,
    managerHandler(
      runOnHost,
      "read",
      "wireguard_read",
      async (client, host) => {
        const result = await execElevated(
          client,
          PROBE_CMD,
          host.sudoPassword,
          {
            forceSudo: false,
            timeoutMs: 15000,
          },
        );
        return parseWireGuardData(result.stdout);
      },
    ),
  );

  /**
   * @openapi
   * /host-metrics/managers/wireguard/{id}/action:
   *   post:
   *     summary: Bring a WireGuard interface up or down
   *     tags:
   *       - Host Metrics
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               interface:
   *                 type: string
   *               action:
   *                 type: string
   *                 enum: [up, down]
   *     responses:
   *       200:
   *         description: Action result.
   */
  app.post(
    "/host-metrics/managers/wireguard/:id/action",
    validateHostId,
    managerHandler(
      runOnHost,
      "execute",
      "wireguard_action",
      async (client, host, req) => {
        const { interface: iface, action } = req.body as {
          interface: unknown;
          action: unknown;
        };
        if (!isValidWireGuardInterface(iface)) {
          throw new ManagerInputError("Invalid WireGuard interface name");
        }
        if (!isValidWireGuardAction(action)) {
          throw new ManagerInputError("Invalid action, must be 'up' or 'down'");
        }
        const result = await execElevated(
          client,
          `wg-quick ${action} ${iface}`,
          host.sudoPassword,
          { forceSudo: true, timeoutMs: 30000 },
        );
        return {
          success: result.code === 0,
          output: (result.stdout + result.stderr).trim(),
        };
      },
    ),
  );
}
