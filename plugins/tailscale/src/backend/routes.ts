import { Router } from "express";
import { apiLogger } from "../../../../src/backend/utils/logger.js";
import { fetchWithProxy } from "../../../../src/backend/utils/proxy-agent.js";
import type { PluginContext } from "@termix/plugin-sdk/backend";

interface TailscaleDevice {
  id: string;
  name: string;
  hostname: string;
  addresses: string[];
  os: string;
  lastSeen: string;
}

interface TailscaleAPIDevice {
  id: string;
  name: string;
  hostname: string;
  addresses: string[];
  os: string;
  lastSeen: string;
  nodeId?: string;
}

const DEFAULT_TAILSCALE_API_BASE = "https://api.tailscale.com/api/v2";

function normalizeApiBase(raw: string | null): string {
  const trimmed = (raw ?? "").trim().replace(/\/+$/, "");
  return trimmed || DEFAULT_TAILSCALE_API_BASE;
}

/**
 * Set by activate(). Dropped on deactivate so a request arriving mid-teardown
 * cannot read settings through a context the runtime has already torn down.
 */
let context: PluginContext | null = null;

/** Called from activate(). Mounts the plugin's routes on ctx.http.router(). */
export function startTailscaleService(
  mountOn: Router,
  ctx: PluginContext,
): void {
  context = ctx;

  /**
   * @openapi
   * /plugin-api/tailscale/devices:
   *   get:
   *     summary: List Tailscale devices
   *     description: >
   *       Returns the devices in the configured tailnet using the stored admin
   *       API key. Requires the tailscale.devices.view permission, because the
   *       response is a full inventory of the tailnet.
   *     tags:
   *       - Tailscale
   *     responses:
   *       200:
   *         description: List of tailnet devices.
   *       403:
   *         description: The caller lacks tailscale.devices.view.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 devices:
   *                   type: array
   *                   items:
   *                     type: object
   *       500:
   *         description: Failed to fetch Tailscale devices.
   */
  mountOn.get(
    "/devices",
    ctx.rbac.require("devices.view") as never,
    async (_req, res) => {
      try {
        if (!context) {
          return res
            .status(503)
            .json({ error: "Plugin is not running", devices: [] });
        }
        const apiKey = (await context.settings.get<string>("apiKey")) ?? "";
        if (!apiKey) {
          return res.json({ devices: [], hasApiKey: false });
        }
        const apiBase = normalizeApiBase(
          (await context.settings.get<string>("apiBaseUrl")) ?? null,
        );

        const url = `${apiBase}/tailnet/-/devices?fields=all`;
        const response = await fetchWithProxy(url, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "User-Agent": "Termix/1.0",
          },
        });

        if (!response.ok) {
          apiLogger.warn("Tailscale API returned non-OK status", {
            operation: "tailscale_devices",
            status: response.status,
          });
          if (response.status === 401 || response.status === 403) {
            return res.status(401).json({
              error: "Invalid Tailscale API key",
              devices: [],
              hasApiKey: true,
            });
          }
          return res.status(502).json({
            error: "Tailscale API error",
            devices: [],
            hasApiKey: true,
          });
        }

        const data = (await response.json()) as {
          devices: TailscaleAPIDevice[];
        };

        const devices: TailscaleDevice[] = (data.devices ?? []).map((d) => ({
          id: d.id,
          name: d.name,
          hostname: d.hostname,
          addresses: d.addresses ?? [],
          os: d.os,
          lastSeen: d.lastSeen,
        }));

        res.json({ devices, hasApiKey: true });
      } catch (err) {
        apiLogger.error("Failed to fetch Tailscale devices", err, {
          operation: "tailscale_devices",
        });
        res.status(500).json({
          error: "Failed to fetch Tailscale devices",
          devices: [],
          hasApiKey: true,
        });
      }
    },
  );
}

/** Called from deactivate(). /plugin-api/tailscale/* falls back to 404 until
 * reactivated. */
export function stopTailscaleService(): void {
  context = null;
}
