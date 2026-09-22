// Was src/backend/database/routes/tailscale-routes.ts, moved here and
// rewritten to register itself via the shared /tailscale dispatcher
// (src/backend/database/routes/tailscale-dispatch.ts) instead of taking a
// direct reference to the app instance, the same way fleets does.

import { Router } from "express";
import { AuthManager } from "../../../../src/backend/utils/auth-manager.js";
import { PermissionManager } from "../../../../src/backend/utils/permission-manager.js";
import { apiLogger } from "../../../../src/backend/utils/logger.js";
import { fetchWithProxy } from "../../../../src/backend/utils/proxy-agent.js";
import { createCurrentSettingsRepository } from "../../../../src/backend/database/repositories/factory.js";
import {
  registerTailscaleRouter,
  unregisterTailscaleRouter,
} from "../../../../src/backend/database/routes/tailscale-dispatch.js";

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

export const router = Router();

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/**
 * Listing the tailnet uses the admin-stored API key, so it needs more than a
 * session. Writing the key is already admin-only and reading it back is
 * masked, but using it to enumerate every device was open to any logged-in
 * user, which handed out an internal network inventory.
 */
const requireDeviceAccess = PermissionManager.getInstance().requirePermission(
  "tailscale.devices.view",
);

function normalizeApiBase(raw: string | null): string {
  const trimmed = (raw ?? "").trim().replace(/\/+$/, "");
  return trimmed || DEFAULT_TAILSCALE_API_BASE;
}

/**
 * @openapi
 * /tailscale/devices:
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
router.get(
  "/devices",
  authenticateJWT,
  requireDeviceAccess,
  async (_req, res) => {
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
  },
);

/** Called from activate(). Mounts this router at /tailscale via the shared
 * dispatcher. */
export function startTailscaleService(): void {
  registerTailscaleRouter(router);
}

/** Called from deactivate(). /tailscale/* falls back to 404 until
 * reactivated. */
export function stopTailscaleService(): void {
  unregisterTailscaleRouter();
}
