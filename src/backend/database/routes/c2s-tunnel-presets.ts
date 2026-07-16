import type {
  AuthenticatedRequest,
  TunnelConnection,
} from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { authLogger, databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import type { C2sTunnelPresetRecord } from "../repositories/c2s-tunnel-preset-repository.js";
import { createCurrentC2sTunnelPresetRepository } from "../repositories/current-c2s-tunnel-preset-repository.js";

const router = express.Router();

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const requireDataAccess = authManager.createDataAccessMiddleware();

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

function parsePreset(row: C2sTunnelPresetRecord) {
  return {
    ...row,
    config: JSON.parse(row.config) as TunnelConnection[],
  };
}

function validateConfig(config: unknown): config is TunnelConnection[] {
  if (!Array.isArray(config)) return false;
  return config.every((item) => {
    if (!item || typeof item !== "object") return false;
    const tunnel = item as Partial<TunnelConnection>;
    const mode = tunnel.mode || tunnel.tunnelType;
    return (
      tunnel.scope === "c2s" &&
      (mode === "local" || mode === "remote" || mode === "dynamic") &&
      typeof tunnel.sourcePort === "number" &&
      tunnel.sourcePort >= 1 &&
      tunnel.sourcePort <= 65535 &&
      (mode === "dynamic" ||
        (typeof tunnel.endpointPort === "number" &&
          tunnel.endpointPort >= 1 &&
          tunnel.endpointPort <= 65535))
    );
  });
}

router.get(
  "/",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    if (!isNonEmptyString(userId)) {
      return res.status(400).json({ error: "Invalid userId" });
    }

    try {
      const result =
        await createCurrentC2sTunnelPresetRepository().listByUserId(userId);
      res.json(result.map(parsePreset));
    } catch (error) {
      authLogger.error("Failed to fetch C2S tunnel presets", error);
      res.status(500).json({ error: "Failed to fetch C2S tunnel presets" });
    }
  },
);

router.post(
  "/",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { name, config, platform, computerName } = req.body;

    if (!isNonEmptyString(userId) || !isNonEmptyString(name)) {
      return res.status(400).json({ error: "Preset name is required" });
    }
    if (!validateConfig(config)) {
      return res
        .status(400)
        .json({ error: "Invalid C2S tunnel configuration" });
    }

    const trimmedName = name.trim();
    try {
      const presetRepository = createCurrentC2sTunnelPresetRepository();
      if (await presetRepository.hasNameForUser(userId, trimmedName)) {
        return res.status(409).json({ error: "Preset name already exists" });
      }

      const created = await presetRepository.createForUser(userId, {
        name: trimmedName,
        config: JSON.stringify(config),
        platform: platform?.trim() || null,
        computerName: computerName?.trim() || null,
      });

      databaseLogger.info("C2S tunnel preset created", {
        operation: "c2s_tunnel_preset_create",
        userId,
        presetId: created.id,
      });
      res.status(201).json(parsePreset(created));
    } catch (error) {
      authLogger.error("Failed to create C2S tunnel preset", error);
      res.status(500).json({ error: "Failed to create C2S tunnel preset" });
    }
  },
);

router.put(
  "/:id",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const id = Number(req.params.id);
    const { name, config, platform, computerName } = req.body;

    if (!isNonEmptyString(userId) || !Number.isInteger(id)) {
      return res.status(400).json({ error: "Invalid request" });
    }

    try {
      const presetRepository = createCurrentC2sTunnelPresetRepository();
      const existing = await presetRepository.findByIdForUser(userId, id);
      if (!existing) {
        return res.status(404).json({ error: "Preset not found" });
      }

      const updateFields: Parameters<typeof presetRepository.updateForUser>[2] =
        {};

      if (name !== undefined) {
        if (!isNonEmptyString(name)) {
          return res.status(400).json({ error: "Preset name is required" });
        }
        const trimmedName = name.trim();
        if (await presetRepository.hasNameForUser(userId, trimmedName, id)) {
          return res.status(409).json({ error: "Preset name already exists" });
        }
        updateFields.name = trimmedName;
      }

      if (config !== undefined) {
        if (!validateConfig(config)) {
          return res
            .status(400)
            .json({ error: "Invalid C2S tunnel configuration" });
        }
        updateFields.config = JSON.stringify(config);
      }
      if (platform !== undefined)
        updateFields.platform = platform?.trim() || null;
      if (computerName !== undefined)
        updateFields.computerName = computerName?.trim() || null;

      const updated = await presetRepository.updateForUser(
        userId,
        id,
        updateFields,
      );
      res.json(parsePreset(updated ?? existing));
    } catch (error) {
      authLogger.error("Failed to update C2S tunnel preset", error);
      res.status(500).json({ error: "Failed to update C2S tunnel preset" });
    }
  },
);

router.delete(
  "/:id",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const id = Number(req.params.id);

    if (!isNonEmptyString(userId) || !Number.isInteger(id)) {
      return res.status(400).json({ error: "Invalid request" });
    }

    try {
      const presetRepository = createCurrentC2sTunnelPresetRepository();
      const existing = await presetRepository.findByIdForUser(userId, id);
      if (!existing) {
        return res.status(404).json({ error: "Preset not found" });
      }

      await presetRepository.deleteForUser(userId, id);

      res.json({ success: true });
    } catch (error) {
      authLogger.error("Failed to delete C2S tunnel preset", error);
      res.status(500).json({ error: "Failed to delete C2S tunnel preset" });
    }
  },
);

export default router;
