import {
  Router,
  type RequestHandler,
  type Router as ExpressRouter,
} from "express";
import { apiLogger } from "../../utils/logger.js";
import { getFetchDispatcher } from "../../utils/proxy-agent.js";
import { createCurrentSettingsRepository } from "../repositories/factory.js";

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

const router = Router();

function normalizeApiBase(raw: string | null): string {
  const trimmed = (raw ?? "").trim().replace(/\/+$/, "");
  return trimmed || DEFAULT_TAILSCALE_API_BASE;
}

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
      const settingsRepo = createCurrentSettingsRepository();
      const apiKey = (await settingsRepo.get("tailscale_api_key")) ?? "";
      if (!apiKey) {
        return res.json({ devices: [], hasApiKey: false });
      }
      const apiBase = normalizeApiBase(
        await settingsRepo.get("tailscale_api_base_url"),
      );

      const url = `${apiBase}/tailnet/-/devices?fields=all`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "User-Agent": "Termix/1.0",
        },
        dispatcher: getFetchDispatcher(url),
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
      res.status(500).json({
        error: "Failed to fetch Tailscale devices",
        devices: [],
        hasApiKey: true,
      });
    }
  });

  app.use("/tailscale", router);
}
