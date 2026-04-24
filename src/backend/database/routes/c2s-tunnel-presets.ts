import type {
  AuthenticatedRequest,
  TunnelConnection,
} from "../../../types/index.js";
import express from "express";
import { db } from "../db/index.js";
import { c2sTunnelPresets } from "../db/schema.js";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { authLogger, databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";

const router = express.Router();

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const requireDataAccess = authManager.createDataAccessMiddleware();

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

function parsePreset(row: typeof c2sTunnelPresets.$inferSelect) {
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
      const result = await db
        .select()
        .from(c2sTunnelPresets)
        .where(eq(c2sTunnelPresets.userId, userId))
        .orderBy(asc(c2sTunnelPresets.name));
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
      const existing = await db
        .select()
        .from(c2sTunnelPresets)
        .where(
          and(
            eq(c2sTunnelPresets.userId, userId),
            eq(c2sTunnelPresets.name, trimmedName),
          ),
        );
      if (existing.length > 0) {
        return res.status(409).json({ error: "Preset name already exists" });
      }

      const result = await db
        .insert(c2sTunnelPresets)
        .values({
          userId,
          name: trimmedName,
          config: JSON.stringify(config),
          platform: platform?.trim() || null,
          computerName: computerName?.trim() || null,
        })
        .returning();

      databaseLogger.info("C2S tunnel preset created", {
        operation: "c2s_tunnel_preset_create",
        userId,
        presetId: result[0].id,
      });
      res.status(201).json(parsePreset(result[0]));
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
      const existing = await db
        .select()
        .from(c2sTunnelPresets)
        .where(
          and(eq(c2sTunnelPresets.id, id), eq(c2sTunnelPresets.userId, userId)),
        );
      if (existing.length === 0) {
        return res.status(404).json({ error: "Preset not found" });
      }

      const updateFields: Record<string, unknown> = {
        updatedAt: sql`CURRENT_TIMESTAMP`,
      };

      if (name !== undefined) {
        if (!isNonEmptyString(name)) {
          return res.status(400).json({ error: "Preset name is required" });
        }
        const trimmedName = name.trim();
        const duplicate = await db
          .select()
          .from(c2sTunnelPresets)
          .where(
            and(
              eq(c2sTunnelPresets.userId, userId),
              eq(c2sTunnelPresets.name, trimmedName),
            ),
          );
        if (duplicate.some((preset) => preset.id !== id)) {
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

      await db
        .update(c2sTunnelPresets)
        .set(updateFields)
        .where(
          and(eq(c2sTunnelPresets.id, id), eq(c2sTunnelPresets.userId, userId)),
        );

      const updated = await db
        .select()
        .from(c2sTunnelPresets)
        .where(eq(c2sTunnelPresets.id, id));
      res.json(parsePreset(updated[0]));
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
      const existing = await db
        .select()
        .from(c2sTunnelPresets)
        .where(
          and(eq(c2sTunnelPresets.id, id), eq(c2sTunnelPresets.userId, userId)),
        );
      if (existing.length === 0) {
        return res.status(404).json({ error: "Preset not found" });
      }

      await db
        .delete(c2sTunnelPresets)
        .where(
          and(eq(c2sTunnelPresets.id, id), eq(c2sTunnelPresets.userId, userId)),
        );

      res.json({ success: true });
    } catch (error) {
      authLogger.error("Failed to delete C2S tunnel preset", error);
      res.status(500).json({ error: "Failed to delete C2S tunnel preset" });
    }
  },
);

export default router;
