import {
  changeHostOverrides,
  type OverrideChange,
} from "../../hosts/defaults/overrides.js";
import { recompute } from "../../hosts/defaults/recompute.js";
import { splitDefaultKey } from "../../../types/host-defaults.js";

import type { AuthenticatedRequest } from "../../../types/index.js";
import type { Request, RequestHandler, Response, Router } from "express";
import { sshLogger } from "../../utils/logger.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import { createCurrentHostRepository } from "../repositories/factory.js";
import { validateParentHostId } from "./host-parent-validation.js";
import { assertHostsUnlocked, sendHostLocked } from "../../hosts/locks.js";

import { setHostPluginEnabled } from "./host-plugin-settings.js";

export function registerHostBulkRoutes(
  router: Router,
  authenticateJWT: RequestHandler,
  requireEditPermission: RequestHandler,
  requireDataAccess: RequestHandler,
): void {
  /**
   * @openapi
   * /host/bulk-import:
   *   post:
   *     summary: Bulk import SSH hosts
   *     description: Bulk imports multiple SSH hosts.
   *     tags:
   *       - SSH
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               hosts:
   *                 type: array
   *                 items:
   *                   type: object
   *     responses:
   *       200:
   *         description: Import completed.
   *       400:
   *         description: Invalid request body.
   */

  /**
   * @swagger
   * /host/bulk-update:
   *   patch:
   *     summary: Bulk update partial fields on multiple SSH hosts
   *     tags: [SSH]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               hostIds:
   *                 type: array
   *                 items:
   *                   type: number
   *               updates:
   *                 type: object
   *                 description: Partial fields to apply. Setting folder clears parentHostId and vice versa, since a host is either in a folder or nested under a parent host.
   *                 properties:
   *                   folder:
   *                     type: string
   *                   parentHostId:
   *                     type: integer
   *                     nullable: true
   *                   statusCheckEnabled:
   *                     type: boolean
   *                   pin:
   *                     type: boolean
   *                   pluginEnable:
   *                     type: object
   *                     description: Plugin id to on or off, for each plugin that declares a host enable switch.
   *                     additionalProperties:
   *                       type: boolean
   *                   resetDefaults:
   *                     type: object
   *                     description: Hands keys back to the host defaults. `all`, or `namespaces` ("core" or a plugin id), or `keys` as "namespace.key".
   *                     properties:
   *                       all:
   *                         type: boolean
   *                       namespaces:
   *                         type: array
   *                         items:
   *                           type: string
   *                       keys:
   *                         type: array
   *                         items:
   *                           type: string
   *     responses:
   *       200:
   *         description: Bulk update completed.
   *       400:
   *         description: Invalid request body.
   */
  router.patch(
    "/bulk-update",
    authenticateJWT,
    requireEditPermission,
    requireDataAccess,
    DatabaseSaveTrigger.batched(async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).userId;
      const { hostIds, updates } = req.body;

      if (!Array.isArray(hostIds) || hostIds.length === 0) {
        return res
          .status(400)
          .json({ error: "hostIds array is required and must not be empty" });
      }

      if (hostIds.length > 1000) {
        return res
          .status(400)
          .json({ error: "Maximum 1000 hosts allowed per bulk update" });
      }

      if (
        !updates ||
        typeof updates !== "object" ||
        Object.keys(updates).length === 0
      ) {
        return res.status(400).json({
          error:
            "updates object is required and must contain at least one field",
        });
      }

      try {
        const hostRepository = createCurrentHostRepository();
        const ownedHosts = await hostRepository.listBulkUpdateState(
          userId,
          hostIds,
        );

        const ownedIds = ownedHosts.map((h) => h.id);
        // Pins stay the user's own on a managed host.
        if (Object.keys(updates).some((key) => key !== "pin")) {
          try {
            assertHostsUnlocked(ownedIds);
          } catch (error) {
            if (sendHostLocked(res, error)) return;
            throw error;
          }
        }
        const unauthorizedIds = hostIds.filter(
          (id: number) => !ownedIds.includes(id),
        );

        if (ownedIds.length === 0) {
          return res.status(404).json({ error: "No matching hosts found" });
        }

        const errors: string[] = [];
        if (unauthorizedIds.length > 0) {
          errors.push(
            `${unauthorizedIds.length} host(s) not found or not owned`,
          );
        }

        const simpleUpdates: Record<string, unknown> = {};
        if (typeof updates.pin === "boolean") simpleUpdates.pin = updates.pin;
        if (typeof updates.folder === "string") {
          simpleUpdates.folder = updates.folder || null;
          // Folder placement and parent-host placement are mutually
          // exclusive -- assigning a folder (including moving to root, an
          // empty folder) clears any parent host, matching the single-host
          // update route's behavior.
          simpleUpdates.parentHostId = null;
        }
        if (updates.parentHostId !== undefined) {
          if (updates.parentHostId === null) {
            simpleUpdates.parentHostId = null;
          } else {
            const numericParentHostId = Number(updates.parentHostId);
            if (!Number.isInteger(numericParentHostId)) {
              return res.status(400).json({ error: "Invalid parent host" });
            }
            // A bulk move can only ever target one parent host at a time
            // (the caller drags a selection onto one drop target), so every
            // id in the batch is checked against the same candidate parent.
            for (const id of ownedIds) {
              const parentError = await validateParentHostId(
                userId,
                id,
                numericParentHostId,
              );
              if (parentError) {
                return res.status(400).json({ error: parentError });
              }
            }
            simpleUpdates.parentHostId = numericParentHostId;
            simpleUpdates.folder = null;
          }
        }
        if (typeof updates.statusCheckEnabled === "boolean")
          simpleUpdates.statusCheckEnabled = updates.statusCheckEnabled;

        if (Object.keys(simpleUpdates).length > 0) {
          await hostRepository.updateManyForUser(
            userId,
            ownedIds,
            simpleUpdates,
          );
        }
        if (typeof updates.statusCheckEnabled === "boolean") {
          await changeHostOverrides(ownedIds, {
            own: [["core", "statusCheckEnabled"]],
          });
        }
        if ("folder" in simpleUpdates || "parentHostId" in simpleUpdates) {
          void recompute({ userIds: [userId] }).catch(() => {});
        }

        // Each plugin's own host switch, by plugin id: the field its manifest
        // names in contributes.settings.host.enableKey.
        if (updates.pluginEnable && typeof updates.pluginEnable === "object") {
          for (const [pluginId, enabled] of Object.entries(
            updates.pluginEnable as Record<string, unknown>,
          )) {
            if (typeof enabled !== "boolean") continue;
            if (!(await setHostPluginEnabled(pluginId, ownedIds, enabled))) {
              errors.push(`Plugin ${pluginId} has no host switch`);
            }
          }
        }

        const reset = readDefaultsReset(updates.resetDefaults);
        if (reset) await changeHostOverrides(ownedIds, reset);

        return res.json({
          updated: ownedIds.length,
          failed: unauthorizedIds.length,
          errors,
        });
      } catch (error) {
        sshLogger.error("Failed to bulk update hosts:", error);
        return res.status(500).json({ error: "Failed to bulk update hosts" });
      }
    }),
  );

  /**
   * @openapi
   * /host/reorder:
   *   put:
   *     summary: Reorder hosts
   *     description: Sets a manual sortOrder for multiple hosts within the same folder, used by drag-to-reorder in the sidebar's manual sort mode.
   *     tags:
   *       - SSH
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               positions:
   *                 type: array
   *                 items:
   *                   type: object
   *                   properties:
   *                     id:
   *                       type: integer
   *                     sortOrder:
   *                       type: integer
   *     responses:
   *       200:
   *         description: Hosts reordered successfully.
   *       400:
   *         description: Invalid positions array.
   *       500:
   *         description: Failed to reorder hosts.
   */
  router.put(
    "/reorder",
    authenticateJWT,
    requireEditPermission,
    requireDataAccess,
    async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).userId;
      const { positions } = req.body as {
        positions?: { id?: unknown; sortOrder?: unknown }[];
      };

      if (!Array.isArray(positions)) {
        return res.status(400).json({ error: "positions array is required" });
      }

      const normalized: { id: number; sortOrder: number }[] = [];
      for (const entry of positions) {
        if (
          typeof entry?.id !== "number" ||
          !Number.isInteger(entry.id) ||
          typeof entry.sortOrder !== "number" ||
          !Number.isFinite(entry.sortOrder)
        ) {
          return res.status(400).json({
            error:
              "Each position requires an integer id and a numeric sortOrder",
          });
        }
        normalized.push({ id: entry.id, sortOrder: entry.sortOrder });
      }

      if (normalized.length === 0) {
        return res.status(400).json({ error: "positions array is required" });
      }

      try {
        const updated = await createCurrentHostRepository().reorderForUser(
          userId,
          normalized,
        );
        return res.json({ updated });
      } catch (error) {
        sshLogger.error("Failed to reorder hosts:", error);
        return res.status(500).json({ error: "Failed to reorder hosts" });
      }
    },
  );
}

/** A resetDefaults body as an override change, or null when there is none. */
export function readDefaultsReset(raw: unknown): OverrideChange | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const strings = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  const change: OverrideChange = {
    inheritAll: source.all === true,
    inheritNamespaces: strings(source.namespaces),
    inherit: strings(source.keys).map(splitDefaultKey),
  };
  return change.inheritAll ||
    change.inheritNamespaces!.length > 0 ||
    change.inherit!.length > 0
    ? change
    : null;
}
