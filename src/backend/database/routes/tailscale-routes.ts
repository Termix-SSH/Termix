import { Router } from "express";
import type { RequestHandler, Router as ExpressRouter } from "express";
import { db } from "../db/index.js";
import { apiLogger } from "../../utils/logger.js";
import { getProxyAgent } from "../../utils/proxy-agent.js";

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

const TAILSCALE_API_BASE = "https://api.tailscale.com/api/v2";

const router = Router();

export function registerTailscaleRoutes(
  app: ExpressRouter,
  authenticateJWT: RequestHandler,
): void {
  /**
   * @openapi
   * /tailscale/devices:
   *   get:
   *     summary: List Tailscale devices
   *     description: Returns the list of devices in the configured tailnet using the stored API key.
   *     tags:
   *       - Tailscale
   *     responses:
   *       200:
   *         description: List of tailnet devices.
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
  router.get("/devices", authenticateJWT, async (_req, res) => {
    try {
      const row = db.$client
        .prepare("SELECT value FROM settings WHERE key = 'tailscale_api_key'")
        .get() as { value: string } | undefined;

      const apiKey = row?.value ?? "";
      if (!apiKey) {
        return res.json({ devices: [], hasApiKey: false });
      }

      const url = `${TAILSCALE_API_BASE}/tailnet/-/devices?fields=all`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "User-Agent": "Termix/1.0",
        },
        dispatcher: getProxyAgent(url),
      });

      if (!response.ok) {
        apiLogger.warn("Tailscale API returned non-OK status", {
          operation: "tailscale_devices",
          status: response.status,
        });
        if (response.status === 401 || response.status === 403) {
          return res
            .status(401)
            .json({ error: "Invalid Tailscale API key", devices: [] });
        }
        return res
          .status(502)
          .json({ error: "Tailscale API error", devices: [] });
      }

      const data = (await response.json()) as { devices: TailscaleAPIDevice[] };

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
      res
        .status(500)
        .json({ error: "Failed to fetch Tailscale devices", devices: [] });
    }
  });

  app.use("/tailscale", router);
}
