import type { Request, RequestHandler, Response, Router } from "express";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { databaseLogger } from "../../utils/logger.js";
import { sessionManager } from "../../hosts/terminal/session-manager.js";
import { createCurrentSettingsRepository } from "../repositories/factory.js";
import {
  MIN_IMAGE_MAX_BYTES,
  TERMINAL_IMAGE_STORAGE_KEYS,
  parseImageHostPath,
  parseImageLocalDir,
  parseTerminalImageStorageMode,
  resolveTerminalImageStorageSettings,
  type TerminalImageStorageSettings,
} from "./terminal-image-storage-settings.js";
import {
  probeLocalImageVisibility,
  selectImageStorageMode,
} from "./terminal-image-storage.js";

/**
 * Admin-only terminal image storage settings.
 *
 * The public shape deliberately omits `localDir`: it is a backend-internal
 * path and only the agent-visible `hostPath` may leave the server. No
 * credentials or connection details are ever returned here.
 */
interface PublicImageStorageSettings {
  mode: TerminalImageStorageSettings["mode"];
  hostPath: string;
  ttlMs: number;
  maxCount: number;
  maxBytes: number;
  localMappingConfigured: boolean;
}

function toPublicSettings(
  settings: TerminalImageStorageSettings,
): PublicImageStorageSettings {
  return {
    mode: settings.mode,
    hostPath: settings.hostPath,
    ttlMs: settings.ttlMs,
    maxCount: settings.maxCount,
    maxBytes: settings.maxBytes,
    localMappingConfigured: settings.localMappingConfigured,
  };
}

const PATCHABLE_FIELDS = [
  "mode",
  "localDir",
  "hostPath",
  "ttlMs",
  "maxCount",
  "maxBytes",
] as const;

type PatchableField = (typeof PATCHABLE_FIELDS)[number];

function invalidField(res: Response, field: string): void {
  // Safe by construction: the field name is fixed, the rejected value and
  // any backend path are never echoed back.
  res.status(400).json({
    error: `Invalid value for ${field}`,
    code: "IMAGE_STORAGE_SETTINGS_INVALID",
    field,
  });
}

function parseIntegerField(
  value: unknown,
  min: number,
): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < min) return null;
  return value;
}

/**
 * Validates a PATCH body and returns the settings-table writes it implies, or
 * null after the response has already been failed with a 400.
 */
function buildImageStorageWrites(
  body: unknown,
  res: Response,
): Array<{ key: string; value: string }> | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    res.status(400).json({
      error: "Invalid request body",
      code: "IMAGE_STORAGE_SETTINGS_INVALID",
    });
    return null;
  }

  for (const field of Object.keys(body)) {
    if (!(PATCHABLE_FIELDS as readonly string[]).includes(field)) {
      res.status(400).json({
        error: `Unknown setting field: ${field}`,
        code: "IMAGE_STORAGE_SETTINGS_UNKNOWN_FIELD",
        field,
      });
      return null;
    }
  }

  const input = body as Partial<Record<PatchableField, unknown>>;
  const writes: Array<{ key: string; value: string }> = [];

  if (input.mode !== undefined) {
    const mode = parseTerminalImageStorageMode(input.mode);
    if (mode === null) {
      invalidField(res, "mode");
      return null;
    }
    writes.push({ key: TERMINAL_IMAGE_STORAGE_KEYS.mode, value: mode });
  }

  if (input.localDir !== undefined) {
    const localDir = parseImageLocalDir(input.localDir);
    if (localDir === null) {
      invalidField(res, "localDir");
      return null;
    }
    writes.push({ key: TERMINAL_IMAGE_STORAGE_KEYS.localDir, value: localDir });
  }

  if (input.hostPath !== undefined) {
    const hostPath = parseImageHostPath(input.hostPath);
    if (hostPath === null) {
      invalidField(res, "hostPath");
      return null;
    }
    writes.push({
      key: TERMINAL_IMAGE_STORAGE_KEYS.hostPath,
      value: hostPath,
    });
  }

  if (input.ttlMs !== undefined) {
    const ttlMs = parseIntegerField(input.ttlMs, 0);
    if (ttlMs === null) {
      invalidField(res, "ttlMs");
      return null;
    }
    writes.push({
      key: TERMINAL_IMAGE_STORAGE_KEYS.ttlMs,
      value: String(ttlMs),
    });
  }

  if (input.maxCount !== undefined) {
    const maxCount = parseIntegerField(input.maxCount, 1);
    if (maxCount === null) {
      invalidField(res, "maxCount");
      return null;
    }
    writes.push({
      key: TERMINAL_IMAGE_STORAGE_KEYS.maxCount,
      value: String(maxCount),
    });
  }

  if (input.maxBytes !== undefined) {
    const maxBytes = parseIntegerField(input.maxBytes, MIN_IMAGE_MAX_BYTES);
    if (maxBytes === null) {
      invalidField(res, "maxBytes");
      return null;
    }
    writes.push({
      key: TERMINAL_IMAGE_STORAGE_KEYS.maxBytes,
      value: String(maxBytes),
    });
  }

  return writes;
}

export function registerUserImageStorageRoutes(
  router: Router,
  requireAdmin: RequestHandler,
): void {
  /**
   * @openapi
   * /users/terminal-image-storage-settings:
   *   get:
   *     summary: Get terminal image storage settings (admin only)
   *     description: Returns the effective terminal image storage settings. The backend-internal localDir is never exposed; only the agent-visible hostPath is returned.
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: Effective image storage settings.
   *       401:
   *         description: Not authenticated.
   *       403:
   *         description: Admin access required.
   *       500:
   *         description: Failed to load settings.
   */
  router.get(
    "/terminal-image-storage-settings",
    requireAdmin,
    async (_req: Request, res: Response) => {
      try {
        const settings = await resolveTerminalImageStorageSettings(
          createCurrentSettingsRepository(),
        );
        res.json(toPublicSettings(settings));
      } catch (err) {
        databaseLogger.error("Failed to load image storage settings", err);
        res
          .status(500)
          .json({ error: "Failed to load image storage settings" });
      }
    },
  );

  /**
   * @openapi
   * /users/terminal-image-storage-settings:
   *   patch:
   *     summary: Update terminal image storage settings (admin only)
   *     description: Persists a partial update. Accepts only mode (auto, local, remote-sftp), localDir, hostPath, ttlMs, maxCount and maxBytes; invalid values are rejected with a 400.
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: Updated effective settings.
   *       400:
   *         description: Invalid or unknown setting field.
   *       401:
   *         description: Not authenticated.
   *       403:
   *         description: Admin access required.
   *       500:
   *         description: Failed to save settings.
   */
  router.patch(
    "/terminal-image-storage-settings",
    requireAdmin,
    async (req: Request, res: Response) => {
      const writes = buildImageStorageWrites(req.body, res);
      if (writes === null) return;

      try {
        const settings = createCurrentSettingsRepository();
        if (typeof settings.setMany === "function") {
          await settings.setMany(writes);
        } else {
          for (const write of writes) {
            await settings.set(write.key, write.value);
          }
        }
        const resolved = await resolveTerminalImageStorageSettings(settings);
        res.json(toPublicSettings(resolved));
      } catch (err) {
        databaseLogger.error("Failed to save image storage settings", err);
        res
          .status(500)
          .json({ error: "Failed to save image storage settings" });
      }
    },
  );

  /**
   * @openapi
   * /users/terminal-image-storage-settings/test:
   *   post:
   *     summary: Test image storage visibility (admin only)
   *     description: Reports which storage mode an upload would take for one of the caller's already-connected terminal sessions. Uses the bounded local-mapping probe only; it never opens new connections.
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: Visibility test result.
   *       400:
   *         description: Missing terminal session instanceId.
   *       401:
   *         description: Not authenticated.
   *       403:
   *         description: Admin access required.
   *       500:
   *         description: Failed to run the test.
   */
  router.post(
    "/terminal-image-storage-settings/test",
    requireAdmin,
    async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).userId;
      const instanceId = req.body?.instanceId;
      if (typeof instanceId !== "string" || instanceId.trim().length === 0) {
        return res.status(400).json({
          error: "Missing terminal session",
          code: "IMAGE_SESSION_MISSING",
        });
      }

      try {
        const settings = await resolveTerminalImageStorageSettings(
          createCurrentSettingsRepository(),
        );
        const session = sessionManager
          .getUserSessions(userId)
          .find(
            (candidate) =>
              (candidate.attachedTabInstanceId ?? candidate.tabInstanceId) ===
                instanceId && candidate.isConnected,
          );
        const remoteSftpAvailable = !!session?.sshConn;

        let localHostVisible: boolean | null = null;
        if (settings.localMappingConfigured && session?.sshConn) {
          localHostVisible = await probeLocalImageVisibility(
            session.sshConn,
            settings,
          ).catch(() => false);
        }

        const selectedMode = selectImageStorageMode(settings, {
          remoteSftpAvailable,
          ...(localHostVisible !== null ? { localHostVisible } : {}),
        });

        res.json({
          mode: settings.mode,
          connected: !!session,
          remoteSftpAvailable,
          localHostVisible,
          selectedMode,
          localMappingConfigured: settings.localMappingConfigured,
        });
      } catch (err) {
        databaseLogger.error("Failed to test image storage visibility", err);
        res
          .status(500)
          .json({ error: "Failed to test image storage visibility" });
      }
    },
  );
}
