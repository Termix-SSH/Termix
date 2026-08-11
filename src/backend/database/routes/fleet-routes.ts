import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import multer from "multer";
import JSZip from "jszip";
import type { Client, SFTPWrapper } from "ssh2";
import { authLogger, databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { PermissionManager } from "../../utils/permission-manager.js";
import {
  isSharePermissionLevel,
  expiryFromDuration,
  parseShareTargets,
} from "./rbac.js";
import {
  createCurrentFleetRepository,
  createCurrentFleetInventoryRepository,
  createCurrentRbacAccessRepository,
  createCurrentRoleRepository,
  createCurrentUserRepository,
} from "../repositories/factory.js";
import { resolveHostById } from "../../hosts/host-resolver.js";
import {
  getFleetPoolKey,
  createFleetSshFactory,
} from "../../hosts/ssh-client-factory.js";
import { withConnection } from "../../hosts/ssh-connection-pool.js";
import { execCommand } from "../../hosts/metrics/widgets/common-utils.js";
import { detectPlatform } from "../../hosts/metrics/managers/platform.js";
import {
  execElevated,
  ElevationError,
} from "../../hosts/metrics/managers/exec-elevated.js";
import { buildPackageActionCommand } from "../../hosts/metrics/managers/packages.js";
import { isValidPackageName } from "../../hosts/metrics/managers/validation.js";
import { resolveSnippetCommand } from "./snippets-execution.js";
import type { HostAction } from "../../utils/permission-manager.js";

const router = express.Router();

const authManager = AuthManager.getInstance();
const permissionManager = PermissionManager.getInstance();

const authenticateJWT = authManager.createAuthMiddleware();
const requireDataAccess = authManager.createDataAccessMiddleware();

const FLEET_TRANSFER_MAX_BYTES = 200 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: FLEET_TRANSFER_MAX_BYTES },
});

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

function parseFleetId(raw: unknown): number | null {
  const id = typeof raw === "string" ? parseInt(raw, 10) : NaN;
  return Number.isInteger(id) ? id : null;
}

/**
 * @openapi
 * /fleets:
 *   get:
 *     summary: List the current user's fleets
 *     tags:
 *       - Fleets
 *     responses:
 *       200:
 *         description: List of fleets with member counts.
 */
router.get(
  "/",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    try {
      const fleetRepository = createCurrentFleetRepository();
      const fleetList = await fleetRepository.listByUser(userId);

      const withCounts = await Promise.all(
        fleetList.map(async (fleet) => {
          const members = await fleetRepository.listEffectiveMembers(
            userId,
            fleet.id,
          );
          return {
            ...fleet,
            tagRules: fleet.tagRules ? JSON.parse(fleet.tagRules) : [],
            memberCount: members.length,
          };
        }),
      );

      res.json(withCounts);
    } catch (err) {
      databaseLogger.error("Failed to list fleets", err, {
        operation: "fleet_list_failed",
        userId,
      });
      res.status(500).json({ error: "Failed to list fleets" });
    }
  },
);

/**
 * @openapi
 * /fleets:
 *   post:
 *     summary: Create a fleet
 *     tags:
 *       - Fleets
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               color:
 *                 type: string
 *               icon:
 *                 type: string
 *               tagRules:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Fleet created.
 *       400:
 *         description: Invalid request body.
 */
router.post(
  "/",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { name, description, color, icon, tagRules } = req.body ?? {};

    if (!isNonEmptyString(name)) {
      return res.status(400).json({ error: "Fleet name is required" });
    }

    if (
      tagRules !== undefined &&
      (!Array.isArray(tagRules) || tagRules.some((t) => typeof t !== "string"))
    ) {
      return res
        .status(400)
        .json({ error: "tagRules must be an array of strings" });
    }

    try {
      const fleet = await createCurrentFleetRepository().create(userId, {
        name: name.trim(),
        description: isNonEmptyString(description) ? description.trim() : null,
        color: isNonEmptyString(color) ? color : null,
        icon: isNonEmptyString(icon) ? icon : null,
        tagRules,
      });

      authLogger.success(`Fleet created: ${fleet.name}`, {
        operation: "fleet_create_success",
        userId,
        fleetId: fleet.id,
      });

      res.json({ ...fleet, tagRules: tagRules ?? [] });
    } catch (err) {
      databaseLogger.error("Failed to create fleet", err, {
        operation: "fleet_create_failed",
        userId,
      });
      res.status(500).json({ error: "Failed to create fleet" });
    }
  },
);

/**
 * @openapi
 * /fleets/{id}:
 *   patch:
 *     summary: Update a fleet
 *     tags:
 *       - Fleets
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Fleet updated.
 *       404:
 *         description: Fleet not found.
 */
router.patch(
  "/:id",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const fleetId = parseFleetId(req.params.id);
    if (fleetId === null) {
      return res.status(400).json({ error: "Invalid fleet ID" });
    }

    const { name, description, color, icon, tagRules } = req.body ?? {};

    if (name !== undefined && !isNonEmptyString(name)) {
      return res.status(400).json({ error: "Fleet name cannot be empty" });
    }

    if (
      tagRules !== undefined &&
      (!Array.isArray(tagRules) || tagRules.some((t) => typeof t !== "string"))
    ) {
      return res
        .status(400)
        .json({ error: "tagRules must be an array of strings" });
    }

    try {
      const updated = await createCurrentFleetRepository().update(
        userId,
        fleetId,
        {
          name: name !== undefined ? name.trim() : undefined,
          description,
          color,
          icon,
          tagRules,
        },
      );

      if (!updated) {
        return res.status(404).json({ error: "Fleet not found" });
      }

      res.json({
        ...updated,
        tagRules: updated.tagRules ? JSON.parse(updated.tagRules) : [],
      });
    } catch (err) {
      databaseLogger.error("Failed to update fleet", err, {
        operation: "fleet_update_failed",
        userId,
        fleetId,
      });
      res.status(500).json({ error: "Failed to update fleet" });
    }
  },
);

/**
 * @openapi
 * /fleets/{id}:
 *   delete:
 *     summary: Delete a fleet
 *     tags:
 *       - Fleets
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Fleet deleted.
 *       404:
 *         description: Fleet not found.
 */
router.delete(
  "/:id",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const fleetId = parseFleetId(req.params.id);
    if (fleetId === null) {
      return res.status(400).json({ error: "Invalid fleet ID" });
    }

    try {
      const deleted = await createCurrentFleetRepository().delete(
        userId,
        fleetId,
      );
      if (!deleted) {
        return res.status(404).json({ error: "Fleet not found" });
      }
      res.json({ success: true });
    } catch (err) {
      databaseLogger.error("Failed to delete fleet", err, {
        operation: "fleet_delete_failed",
        userId,
        fleetId,
      });
      res.status(500).json({ error: "Failed to delete fleet" });
    }
  },
);

/**
 * @openapi
 * /fleets/{id}/members:
 *   get:
 *     summary: List the resolved effective members of a fleet
 *     description: Returns the union of statically-added hosts and hosts matched by the fleet's tag rules, each annotated with the caller's permission level on that host.
 *     tags:
 *       - Fleets
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Resolved member hosts.
 *       404:
 *         description: Fleet not found.
 */
router.get(
  "/:id/members",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const fleetId = parseFleetId(req.params.id);
    if (fleetId === null) {
      return res.status(400).json({ error: "Invalid fleet ID" });
    }

    try {
      const fleetRepository = createCurrentFleetRepository();
      const fleet = await fleetRepository.findById(userId, fleetId);
      if (!fleet) {
        return res.status(404).json({ error: "Fleet not found" });
      }

      const staticIds = await fleetRepository.listStaticMemberIds(fleetId);
      const staticIdSet = new Set(staticIds);
      const members = await fleetRepository.listEffectiveMembers(
        userId,
        fleetId,
      );

      const annotated = await Promise.all(
        members.map(async (host) => {
          const access = await permissionManager.canAccessHost(
            userId,
            host.id,
            "connect",
          );
          return {
            id: host.id,
            name: host.name,
            ip: host.ip,
            tags: host.tags ? host.tags.split(",").filter(Boolean) : [],
            static: staticIdSet.has(host.id),
            permissionLevel: access.isOwner
              ? "manage"
              : (access.permissionLevel ?? null),
          };
        }),
      );

      res.json(annotated);
    } catch (err) {
      databaseLogger.error("Failed to list fleet members", err, {
        operation: "fleet_members_list_failed",
        userId,
        fleetId,
      });
      res.status(500).json({ error: "Failed to list fleet members" });
    }
  },
);

/**
 * @openapi
 * /fleets/{id}/members:
 *   post:
 *     summary: Add a host to a fleet's static membership
 *     tags:
 *       - Fleets
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
 *               hostId:
 *                 type: number
 *     responses:
 *       200:
 *         description: Host added.
 *       404:
 *         description: Fleet or host not found.
 */
router.post(
  "/:id/members",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const fleetId = parseFleetId(req.params.id);
    const hostId = Number(req.body?.hostId);

    if (fleetId === null || !Number.isInteger(hostId)) {
      return res
        .status(400)
        .json({ error: "Valid fleetId and hostId are required" });
    }

    try {
      const fleetRepository = createCurrentFleetRepository();
      const fleet = await fleetRepository.findById(userId, fleetId);
      if (!fleet) {
        return res.status(404).json({ error: "Fleet not found" });
      }

      const access = await permissionManager.canAccessHost(
        userId,
        hostId,
        "connect",
      );
      if (!access.hasAccess) {
        return res.status(404).json({ error: "Host not found" });
      }

      await fleetRepository.addMember(fleetId, hostId);
      res.json({ success: true });
    } catch (err) {
      databaseLogger.error("Failed to add fleet member", err, {
        operation: "fleet_member_add_failed",
        userId,
        fleetId,
        hostId,
      });
      res.status(500).json({ error: "Failed to add fleet member" });
    }
  },
);

/**
 * @openapi
 * /fleets/{id}/members/{hostId}:
 *   delete:
 *     summary: Remove a host from a fleet's static membership
 *     description: Only removes the static membership row - a host still matched by the fleet's tag rules remains an effective member.
 *     tags:
 *       - Fleets
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: hostId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Host removed.
 *       404:
 *         description: Fleet or membership not found.
 */
router.delete(
  "/:id/members/:hostId",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const fleetId = parseFleetId(req.params.id);
    const hostId = parseFleetId(req.params.hostId);

    if (fleetId === null || hostId === null) {
      return res.status(400).json({ error: "Invalid fleet or host ID" });
    }

    try {
      const fleetRepository = createCurrentFleetRepository();
      const fleet = await fleetRepository.findById(userId, fleetId);
      if (!fleet) {
        return res.status(404).json({ error: "Fleet not found" });
      }

      const removed = await fleetRepository.removeMember(fleetId, hostId);
      if (!removed) {
        return res.status(404).json({ error: "Membership not found" });
      }
      res.json({ success: true });
    } catch (err) {
      databaseLogger.error("Failed to remove fleet member", err, {
        operation: "fleet_member_remove_failed",
        userId,
        fleetId,
        hostId,
      });
      res.status(500).json({ error: "Failed to remove fleet member" });
    }
  },
);

/**
 * @openapi
 * /fleets/{id}/share:
 *   post:
 *     summary: Share a fleet's current member hosts with users or roles
 *     description: Snapshot at share time - grants hostAccess for every current member host to each target. Hosts added to the fleet later are not automatically shared; re-run this route to extend sharing to new members.
 *     tags:
 *       - Fleets
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
 *               targets:
 *                 type: array
 *                 items:
 *                   type: object
 *               permissionLevel:
 *                 type: string
 *               durationHours:
 *                 type: number
 *     responses:
 *       200:
 *         description: Fleet shared.
 *       404:
 *         description: Fleet not found.
 */
router.post(
  "/:id/share",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const fleetId = parseFleetId(req.params.id);
    if (fleetId === null) {
      return res.status(400).json({ error: "Invalid fleet ID" });
    }

    try {
      const fleetRepository = createCurrentFleetRepository();
      const fleet = await fleetRepository.findById(userId, fleetId);
      if (!fleet) {
        return res.status(404).json({ error: "Fleet not found" });
      }

      const targets = parseShareTargets(req.body ?? {});
      if (!targets) {
        return res.status(400).json({
          error:
            "targets must be a non-empty array of { type: 'user'|'role', id } entries",
        });
      }

      const { durationHours, permissionLevel = "connect" } = req.body;

      if (!isSharePermissionLevel(permissionLevel)) {
        return res.status(400).json({ error: "Invalid permission level" });
      }

      const userRepository = createCurrentUserRepository();
      const roleRepository = createCurrentRoleRepository();
      for (const target of targets) {
        if (target.type === "user") {
          const targetUser = await userRepository.findById(target.id as string);
          if (!targetUser) {
            return res
              .status(404)
              .json({ error: "Target user not found", targetId: target.id });
          }
        } else {
          const targetRole = await roleRepository.findRoleById(
            target.id as number,
          );
          if (!targetRole) {
            return res
              .status(404)
              .json({ error: "Target role not found", targetId: target.id });
          }
        }
      }

      const members = await fleetRepository.listEffectiveMembers(
        userId,
        fleetId,
      );
      const expiresAt = expiryFromDuration(durationHours);
      const rbacAccessRepository = createCurrentRbacAccessRepository();
      const { SharedHostSecretsManager } =
        await import("../../utils/shared-host-secrets-manager.js");
      const secretsManager = SharedHostSecretsManager.getInstance();

      const hostResults: Array<{
        hostId: number;
        shared: boolean;
        reason?: string;
      }> = [];

      for (const host of members) {
        if (targets.some((t) => t.type === "user" && t.id === host.userId)) {
          hostResults.push({ hostId: host.id, shared: false, reason: "owner" });
          continue;
        }

        const access = await permissionManager.canAccessHost(
          userId,
          host.id,
          "manage",
        );
        if (!access.hasAccess) {
          hostResults.push({
            hostId: host.id,
            shared: false,
            reason: "forbidden",
          });
          continue;
        }

        for (const target of targets) {
          const accessGrant = await rbacAccessRepository.upsertHostAccess({
            hostId: host.id,
            grantedBy: userId,
            permissionLevel,
            expiresAt,
            ...(target.type === "user"
              ? {
                  targetType: "user" as const,
                  targetUserId: target.id as string,
                }
              : {
                  targetType: "role" as const,
                  targetRoleId: target.id as number,
                }),
          });

          try {
            if (target.type === "user") {
              await secretsManager.snapshotForUser(
                accessGrant.id,
                host.id,
                target.id as string,
                host.userId,
              );
            } else {
              await secretsManager.snapshotForRole(
                accessGrant.id,
                host.id,
                target.id as number,
                host.userId,
              );
            }
          } catch (snapshotError) {
            databaseLogger.warn("Fleet shared but secret snapshot failed", {
              operation: "fleet_share_snapshot_failed",
              hostId: host.id,
              accessId: accessGrant.id,
              error:
                snapshotError instanceof Error
                  ? snapshotError.message
                  : "Unknown error",
            });
          }
        }

        hostResults.push({ hostId: host.id, shared: true });
      }

      const sharedCount = hostResults.filter((r) => r.shared).length;

      databaseLogger.success("Fleet shared successfully", {
        operation: "fleet_share_success",
        userId,
        fleetId,
        hostsShared: sharedCount,
        targets: targets.length,
        permissionLevel,
      });

      res.json({
        success: true,
        permissionLevel,
        expiresAt,
        hostsShared: sharedCount,
        hostsTotal: members.length,
        hostResults,
      });
    } catch (err) {
      databaseLogger.error("Failed to share fleet", err, {
        operation: "fleet_share_failed",
        userId,
        fleetId,
      });
      res.status(500).json({ error: "Failed to share fleet" });
    }
  },
);

// Minimal promisified SFTP primitives for whole-file push/pull. Deliberately
// not reusing transfer-engine.ts - that file's resumable/segmented/tar
// machinery is built for the interactive file manager's large-transfer UX
// and is overbuilt for a fleet action operating on one buffered file per host.
function getSftp(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) reject(err);
      else resolve(sftp);
    });
  });
}

function sftpWriteFile(
  sftp: SFTPWrapper,
  remotePath: string,
  data: Buffer,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = sftp.createWriteStream(remotePath);
    stream.on("error", reject);
    stream.on("close", resolve);
    stream.end(data);
  });
}

function sftpReadFile(sftp: SFTPWrapper, remotePath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = sftp.createReadStream(remotePath);
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("close", () => resolve(Buffer.concat(chunks)));
  });
}

interface FleetHostResult {
  hostId: number;
  hostName: string;
  success: boolean;
  output?: string;
  error?: string;
}

/**
 * Resolves a fleet's effective members, re-checks the caller's per-host
 * access at `level` (fleet membership alone is not treated as authorization -
 * a fleet-sharee can only act on member hosts they individually have access
 * to), and runs `fn` against each authorized host concurrently. One host's
 * rejection never aborts the others.
 */
async function runAcrossFleet(
  userId: string,
  fleetId: number,
  level: HostAction,
  fn: (host: {
    id: number;
    name: string;
  }) => Promise<Pick<FleetHostResult, "success" | "output" | "error">>,
): Promise<{ results: FleetHostResult[]; fleetFound: boolean }> {
  const fleetRepository = createCurrentFleetRepository();
  const fleet = await fleetRepository.findById(userId, fleetId);
  if (!fleet) {
    return { results: [], fleetFound: false };
  }

  const members = await fleetRepository.listEffectiveMembers(userId, fleetId);

  const settled = await Promise.allSettled(
    members.map(async (host) => {
      const access = await permissionManager.canAccessHost(
        userId,
        host.id,
        level,
      );
      if (!access.hasAccess) {
        return {
          hostId: host.id,
          hostName: host.name,
          success: false,
          error: `Access denied (requires '${level}' level)`,
        } satisfies FleetHostResult;
      }

      try {
        const outcome = await fn({ id: host.id, name: host.name });
        return {
          hostId: host.id,
          hostName: host.name,
          ...outcome,
        } satisfies FleetHostResult;
      } catch (err) {
        return {
          hostId: host.id,
          hostName: host.name,
          success: false,
          error: err instanceof Error ? err.message : "Unknown error",
        } satisfies FleetHostResult;
      }
    }),
  );

  const results = settled.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : ({
          hostId: -1,
          hostName: "unknown",
          success: false,
          error: r.reason instanceof Error ? r.reason.message : "Unknown error",
        } satisfies FleetHostResult),
  );

  return { results, fleetFound: true };
}

/**
 * @openapi
 * /fleets/{id}/execute:
 *   post:
 *     summary: Run a command across every host in a fleet
 *     description: Fans out concurrently to every effective member host the caller has edit-level access to. $HOST/$USER/$PORT/$NAME/$INPUT_n substitution is applied per host, same grammar as snippet execution. One host failing does not stop the others.
 *     tags:
 *       - Fleets
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
 *               command:
 *                 type: string
 *               inputValues:
 *                 type: object
 *     responses:
 *       200:
 *         description: Per-host execution results.
 *       404:
 *         description: Fleet not found.
 */
router.post(
  "/:id/execute",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const fleetId = parseFleetId(req.params.id);
    const { command, inputValues } = req.body ?? {};

    if (fleetId === null) {
      return res.status(400).json({ error: "Invalid fleet ID" });
    }
    if (!isNonEmptyString(command)) {
      return res.status(400).json({ error: "Command is required" });
    }

    try {
      const { results, fleetFound } = await runAcrossFleet(
        userId,
        fleetId,
        "edit",
        async (host) => {
          const fullHost = await resolveHostById(host.id, userId);
          if (!fullHost) {
            return { success: false, error: "Host not found" };
          }

          const resolvedCommand = resolveSnippetCommand(
            command,
            {
              ip: fullHost.ip,
              username: fullHost.username,
              port: fullHost.port,
              name: fullHost.name,
            },
            inputValues && typeof inputValues === "object" ? inputValues : {},
          );

          const { stdout, stderr, code } = await withConnection(
            getFleetPoolKey(fullHost),
            createFleetSshFactory(fullHost),
            (client) => execCommand(client, resolvedCommand, 60000),
          );

          return {
            success: code === 0,
            output: stdout,
            error:
              code !== 0 ? stderr || `Exited with code ${code}` : undefined,
          };
        },
      );

      if (!fleetFound) {
        return res.status(404).json({ error: "Fleet not found" });
      }

      authLogger.success(`Fleet command executed on fleet ${fleetId}`, {
        operation: "fleet_execute_success",
        userId,
        fleetId,
        hostCount: results.length,
      });

      res.json({ results });
    } catch (err) {
      databaseLogger.error("Failed to execute fleet command", err, {
        operation: "fleet_execute_failed",
        userId,
        fleetId,
      });
      res.status(500).json({ error: "Failed to execute fleet command" });
    }
  },
);

/**
 * @openapi
 * /fleets/{id}/transfer/push:
 *   post:
 *     summary: Push an uploaded file to the same remote path on every host in a fleet
 *     description: Fans out concurrently to every effective member host the caller has edit-level access to. Single file only (v1) - the file is buffered once server-side and written to each host via SFTP.
 *     tags:
 *       - Fleets
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *               remotePath:
 *                 type: string
 *     responses:
 *       200:
 *         description: Per-host push results.
 *       404:
 *         description: Fleet not found.
 */
router.post(
  "/:id/transfer/push",
  authenticateJWT,
  requireDataAccess,
  upload.single("file"),
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const fleetId = parseFleetId(req.params.id);
    const remotePath = req.body?.remotePath;
    const file = (req as Request & { file?: Express.Multer.File }).file;

    if (fleetId === null) {
      return res.status(400).json({ error: "Invalid fleet ID" });
    }
    if (!isNonEmptyString(remotePath)) {
      return res.status(400).json({ error: "remotePath is required" });
    }
    if (!file) {
      return res.status(400).json({ error: "A file is required" });
    }

    try {
      const { results, fleetFound } = await runAcrossFleet(
        userId,
        fleetId,
        "edit",
        async (host) => {
          const fullHost = await resolveHostById(host.id, userId);
          if (!fullHost) {
            return { success: false, error: "Host not found" };
          }

          await withConnection(
            getFleetPoolKey(fullHost),
            createFleetSshFactory(fullHost),
            async (client) => {
              const sftp = await getSftp(client);
              await sftpWriteFile(sftp, remotePath, file.buffer);
            },
          );

          return { success: true, output: `Written to ${remotePath}` };
        },
      );

      if (!fleetFound) {
        return res.status(404).json({ error: "Fleet not found" });
      }

      authLogger.success(`Fleet file push executed on fleet ${fleetId}`, {
        operation: "fleet_transfer_push_success",
        userId,
        fleetId,
        hostCount: results.length,
      });

      res.json({ results });
    } catch (err) {
      databaseLogger.error("Failed to push file across fleet", err, {
        operation: "fleet_transfer_push_failed",
        userId,
        fleetId,
      });
      res.status(500).json({ error: "Failed to push file across fleet" });
    }
  },
);

/**
 * @openapi
 * /fleets/{id}/transfer/pull:
 *   post:
 *     summary: Pull the same remote path from every host in a fleet
 *     description: Fans out concurrently to every effective member host the caller has edit-level access to, reads remotePath via SFTP from each, and returns a single zip archive with one entry per successful host (<hostName>/<filename>). Single file only (v1).
 *     tags:
 *       - Fleets
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
 *               remotePath:
 *                 type: string
 *     responses:
 *       200:
 *         description: Zip archive containing the per-host pulled files, plus an X-Fleet-Transfer-Results header with the per-host JSON result summary.
 *       404:
 *         description: Fleet not found.
 */
router.post(
  "/:id/transfer/pull",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const fleetId = parseFleetId(req.params.id);
    const { remotePath } = req.body ?? {};

    if (fleetId === null) {
      return res.status(400).json({ error: "Invalid fleet ID" });
    }
    if (!isNonEmptyString(remotePath)) {
      return res.status(400).json({ error: "remotePath is required" });
    }

    try {
      const zip = new JSZip();
      const fileName = remotePath.split("/").filter(Boolean).pop() || "file";

      const { results, fleetFound } = await runAcrossFleet(
        userId,
        fleetId,
        "edit",
        async (host) => {
          const fullHost = await resolveHostById(host.id, userId);
          if (!fullHost) {
            return { success: false, error: "Host not found" };
          }

          const data = await withConnection(
            getFleetPoolKey(fullHost),
            createFleetSshFactory(fullHost),
            async (client) => {
              const sftp = await getSftp(client);
              return sftpReadFile(sftp, remotePath);
            },
          );

          zip.file(`${host.name}/${fileName}`, data);
          return { success: true, output: `Pulled ${data.length} bytes` };
        },
      );

      if (!fleetFound) {
        return res.status(404).json({ error: "Fleet not found" });
      }

      authLogger.success(`Fleet file pull executed on fleet ${fleetId}`, {
        operation: "fleet_transfer_pull_success",
        userId,
        fleetId,
        hostCount: results.length,
      });

      const archive = await zip.generateAsync({ type: "nodebuffer" });
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="fleet-${fleetId}-${fileName}.zip"`,
      );
      res.setHeader(
        "X-Fleet-Transfer-Results",
        Buffer.from(JSON.stringify(results)).toString("base64"),
      );
      res.send(archive);
    } catch (err) {
      databaseLogger.error("Failed to pull file across fleet", err, {
        operation: "fleet_transfer_pull_failed",
        userId,
        fleetId,
      });
      res.status(500).json({ error: "Failed to pull file across fleet" });
    }
  },
);

// Kernel/arch/hostname/uptime are cheap, always-available facts not covered by
// detectPlatform's tooling probe. One combined command keeps this to a single
// round trip per host, same "key=value per line" shape as PLATFORM_PROBE_COMMAND.
const INVENTORY_PROBE_COMMAND = [
  "echo kernel=$(uname -r)",
  "echo arch=$(uname -m)",
  "echo hostname=$(hostname)",
  "echo uptime_seconds=$(cut -d. -f1 /proc/uptime 2>/dev/null || echo '')",
].join("; ");

export function parseInventoryProbe(output: string): {
  kernel: string | null;
  architecture: string | null;
  hostname: string | null;
  uptimeSeconds: number | null;
} {
  const map = new Map<string, string>();
  for (const line of output.split("\n")) {
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    map.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
  }

  const uptimeRaw = map.get("uptime_seconds");
  const uptimeSeconds =
    uptimeRaw && /^\d+$/.test(uptimeRaw) ? parseInt(uptimeRaw, 10) : null;

  return {
    kernel: map.get("kernel") || null,
    architecture: map.get("arch") || null,
    hostname: map.get("hostname") || null,
    uptimeSeconds,
  };
}

/**
 * @openapi
 * /fleets/{id}/inventory:
 *   get:
 *     summary: Read the last-known inventory snapshot for a fleet's members
 *     description: No live connection - reads back whatever the most recent POST refresh stored. Latest-only per host, no history.
 *     tags:
 *       - Fleets
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Stored inventory rows for current members.
 *       404:
 *         description: Fleet not found.
 */
router.get(
  "/:id/inventory",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const fleetId = parseFleetId(req.params.id);
    if (fleetId === null) {
      return res.status(400).json({ error: "Invalid fleet ID" });
    }

    try {
      const fleetRepository = createCurrentFleetRepository();
      const fleet = await fleetRepository.findById(userId, fleetId);
      if (!fleet) {
        return res.status(404).json({ error: "Fleet not found" });
      }

      const members = await fleetRepository.listEffectiveMembers(
        userId,
        fleetId,
      );
      const inventory =
        await createCurrentFleetInventoryRepository().listForHosts(
          userId,
          members.map((m) => m.id),
        );

      const byHostId = new Map(inventory.map((row) => [row.hostId, row]));
      res.json(
        members.map((host) => ({
          hostId: host.id,
          hostName: host.name,
          inventory: byHostId.get(host.id) ?? null,
        })),
      );
    } catch (err) {
      databaseLogger.error("Failed to read fleet inventory", err, {
        operation: "fleet_inventory_read_failed",
        userId,
        fleetId,
      });
      res.status(500).json({ error: "Failed to read fleet inventory" });
    }
  },
);

/**
 * @openapi
 * /fleets/{id}/inventory:
 *   post:
 *     summary: Refresh the inventory snapshot for every host in a fleet
 *     description: Connects to every effective member host the caller has view-level access to, collects OS/kernel/arch/hostname/uptime, and overwrites the stored latest-only snapshot per host.
 *     tags:
 *       - Fleets
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Per-host refresh results.
 *       404:
 *         description: Fleet not found.
 */
router.post(
  "/:id/inventory",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const fleetId = parseFleetId(req.params.id);
    if (fleetId === null) {
      return res.status(400).json({ error: "Invalid fleet ID" });
    }

    try {
      const inventoryRepository = createCurrentFleetInventoryRepository();

      const { results, fleetFound } = await runAcrossFleet(
        userId,
        fleetId,
        "view",
        async (host) => {
          const fullHost = await resolveHostById(host.id, userId);
          if (!fullHost) {
            return { success: false, error: "Host not found" };
          }

          const record = await withConnection(
            getFleetPoolKey(fullHost),
            createFleetSshFactory(fullHost),
            async (client) => {
              const platform = await detectPlatform(client);
              const { stdout } = await execCommand(
                client,
                INVENTORY_PROBE_COMMAND,
                15000,
              );
              const facts = parseInventoryProbe(stdout);

              return inventoryRepository.upsert(userId, host.id, {
                osPrettyName: platform.osPrettyName,
                kernel: facts.kernel,
                architecture: facts.architecture,
                hostname: facts.hostname,
                uptimeSeconds: facts.uptimeSeconds,
                ip: fullHost.ip,
                packageManager: platform.pkg,
              });
            },
          );

          return {
            success: true,
            output: JSON.stringify(record),
          };
        },
      );

      if (!fleetFound) {
        return res.status(404).json({ error: "Fleet not found" });
      }

      res.json({ results });
    } catch (err) {
      databaseLogger.error("Failed to refresh fleet inventory", err, {
        operation: "fleet_inventory_refresh_failed",
        userId,
        fleetId,
      });
      res.status(500).json({ error: "Failed to refresh fleet inventory" });
    }
  },
);

/**
 * @openapi
 * /fleets/{id}/packages:
 *   post:
 *     summary: Run a package action across every host in a fleet
 *     description: Auto-detects each host's package manager (apt/dnf/yum/pacman) and runs install/remove/upgrade-all, elevating with the host's stored sudo password. Requires manage-level access per host.
 *     tags:
 *       - Fleets
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
 *               action:
 *                 type: string
 *                 enum: [install, remove, upgrade-all]
 *               package:
 *                 type: string
 *     responses:
 *       200:
 *         description: Per-host package action results.
 *       404:
 *         description: Fleet not found.
 */
router.post(
  "/:id/packages",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const fleetId = parseFleetId(req.params.id);
    const { action, package: packageName } = req.body ?? {};

    if (fleetId === null) {
      return res.status(400).json({ error: "Invalid fleet ID" });
    }
    if (
      action !== "install" &&
      action !== "remove" &&
      action !== "upgrade-all"
    ) {
      return res.status(400).json({ error: "Invalid action" });
    }
    if (action !== "upgrade-all" && !isValidPackageName(packageName)) {
      return res.status(400).json({ error: "Invalid package name" });
    }

    try {
      const { results, fleetFound } = await runAcrossFleet(
        userId,
        fleetId,
        "manage",
        async (host) => {
          const fullHost = await resolveHostById(host.id, userId);
          if (!fullHost) {
            return { success: false, error: "Host not found" };
          }

          return withConnection(
            getFleetPoolKey(fullHost),
            createFleetSshFactory(fullHost),
            async (client) => {
              const platform = await detectPlatform(client);
              // "remove" has no PackageAction counterpart in buildPackageActionCommand
              // (install/upgrade-all only) - build it here per distro instead.
              const cmd =
                action === "remove"
                  ? buildRemoveCommand(platform.pkg, packageName)
                  : buildPackageActionCommand(
                      platform.pkg,
                      action,
                      packageName,
                    );

              if (!cmd) {
                return {
                  success: false,
                  error: platform.pkg
                    ? `Unsupported package action '${action}' for ${platform.pkg}`
                    : "No supported package manager detected on this host",
                };
              }

              try {
                const result = await execElevated(
                  client,
                  cmd,
                  fullHost.sudoPassword,
                  { forceSudo: true, timeoutMs: 600000 },
                );
                return {
                  success: result.code === 0,
                  output: (result.stdout || result.stderr).slice(-8000),
                };
              } catch (elevationError) {
                if (elevationError instanceof ElevationError) {
                  return { success: false, error: elevationError.message };
                }
                throw elevationError;
              }
            },
          );
        },
      );

      if (!fleetFound) {
        return res.status(404).json({ error: "Fleet not found" });
      }

      res.json({ results });
    } catch (err) {
      databaseLogger.error("Failed to run fleet package action", err, {
        operation: "fleet_packages_failed",
        userId,
        fleetId,
      });
      res.status(500).json({ error: "Failed to run fleet package action" });
    }
  },
);

export function buildRemoveCommand(
  pkg: "apt" | "dnf" | "yum" | "pacman" | null,
  name: string,
): string | null {
  switch (pkg) {
    case "apt":
      return `DEBIAN_FRONTEND=noninteractive apt-get -y remove ${name}`;
    case "dnf":
      return `dnf -y remove ${name}`;
    case "yum":
      return `yum -y remove ${name}`;
    case "pacman":
      return `pacman -R --noconfirm ${name}`;
    default:
      return null;
  }
}

export default router;
