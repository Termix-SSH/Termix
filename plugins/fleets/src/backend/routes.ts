import type { Request, Response, Router } from "express";
import multer from "multer";
import JSZip from "jszip";
import type { Client, SFTPWrapper } from "ssh2";
import type {
  PluginContext,
  PluginHostShareLevel,
} from "@termix/plugin-sdk/backend";
import {
  execCommand,
  detectPlatform,
  buildPackageActionCommand,
  buildPackageRemoveCommand,
  isValidPackageName,
  execElevated,
  ElevationError,
} from "@termix/plugin-sdk/host-commands";
import type { FleetRepository } from "./repository.js";
import { resolveCommandVariables } from "./command-variables.js";

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

const SHARE_LEVELS: PluginHostShareLevel[] = [
  "connect",
  "view",
  "edit",
  "manage",
];

function isShareLevel(value: unknown): value is PluginHostShareLevel {
  return SHARE_LEVELS.includes(value as PluginHostShareLevel);
}

interface ShareTargetInput {
  type: "user" | "role";
  id: string | number;
}

function parseShareTargets(
  body: Record<string, unknown>,
): ShareTargetInput[] | null {
  const rawTargets = body.targets;
  if (!Array.isArray(rawTargets) || rawTargets.length === 0) return null;

  const targets: ShareTargetInput[] = [];
  for (const raw of rawTargets) {
    if (!raw || typeof raw !== "object") return null;
    const { type, id } = raw as { type?: unknown; id?: unknown };
    if (type === "user" && isNonEmptyString(id)) {
      targets.push({ type: "user", id });
    } else if (
      type === "role" &&
      typeof id === "number" &&
      Number.isInteger(id)
    ) {
      targets.push({ type: "role", id });
    } else {
      return null;
    }
  }
  return targets;
}

function actor(ctx: PluginContext): string {
  return ctx.currentActor() as string;
}

function logError(
  ctx: PluginContext,
  message: string,
  error: unknown,
  operation: string,
): void {
  ctx.log.error(
    `${message} (${operation})`,
    error instanceof Error ? error : new Error(String(error)),
  );
}

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
 * Resolves a fleet's effective members, re-checks the caller's per-host
 * access at `level` through ctx.hosts (fleet membership alone is not treated
 * as authorization - a fleet-sharee can only act on member hosts they
 * individually have access to), and runs `fn` against each authorized host
 * concurrently. One host's rejection never aborts the others.
 */
async function runAcrossFleet(
  ctx: PluginContext,
  repo: FleetRepository,
  userId: string,
  fleetId: number,
  level: PluginHostShareLevel,
  fn: (host: {
    id: number;
    name: string;
  }) => Promise<Pick<FleetHostResult, "success" | "output" | "error">>,
): Promise<{ results: FleetHostResult[]; fleetFound: boolean }> {
  const fleet = await repo.findById(userId, fleetId);
  if (!fleet) {
    return { results: [], fleetFound: false };
  }

  const members = await repo.listEffectiveMembers(userId, fleetId);

  const settled = await Promise.allSettled(
    members.map(async (host) => {
      const access = await ctx.hosts.checkAccess(host.id, level);
      if (!access.hasAccess) {
        return {
          hostId: host.id,
          hostName: host.name ?? String(host.id),
          success: false,
          error: `Access denied (requires '${level}' level)`,
        } satisfies FleetHostResult;
      }

      try {
        const outcome = await fn({
          id: host.id,
          name: host.name ?? String(host.id),
        });
        return {
          hostId: host.id,
          hostName: host.name ?? String(host.id),
          ...outcome,
        } satisfies FleetHostResult;
      } catch (err) {
        return {
          hostId: host.id,
          hostName: host.name ?? String(host.id),
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
 * Mounts the fleets routes on the plugin's router, which core serves at
 * /plugin-api/fleets/ with auth and the actor already applied.
 */
export function registerFleetRoutes(
  router: Router,
  repo: FleetRepository,
  ctx: PluginContext,
): void {
  /**
   * @openapi
   * /plugin-api/fleets:
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
    ctx.rbac.require("view") as never,
    async (req: Request, res: Response) => {
      const userId = actor(ctx);
      try {
        const fleetList = await repo.listByUser(userId);
        const withCounts = await Promise.all(
          fleetList.map(async (fleet) => {
            const members = await repo.listEffectiveMembers(userId, fleet.id);
            return {
              ...fleet,
              tagRules: fleet.tagRules ? JSON.parse(fleet.tagRules) : [],
              memberCount: members.length,
            };
          }),
        );
        res.json(withCounts);
      } catch (err) {
        logError(ctx, "Failed to list fleets", err, "fleet_list_failed");
        res.status(500).json({ error: "Failed to list fleets" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/fleets:
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
    ctx.rbac.require("manage") as never,
    async (req: Request, res: Response) => {
      const userId = actor(ctx);
      const { name, description, color, icon, tagRules } = req.body ?? {};

      if (!isNonEmptyString(name)) {
        return res.status(400).json({ error: "Fleet name is required" });
      }
      if (
        tagRules !== undefined &&
        (!Array.isArray(tagRules) ||
          tagRules.some((t) => typeof t !== "string"))
      ) {
        return res
          .status(400)
          .json({ error: "tagRules must be an array of strings" });
      }

      try {
        const fleet = await repo.create(userId, {
          name: name.trim(),
          description: isNonEmptyString(description)
            ? description.trim()
            : null,
          color: isNonEmptyString(color) ? color : null,
          icon: isNonEmptyString(icon) ? icon : null,
          tagRules,
        });
        res.json({ ...fleet, tagRules: tagRules ?? [] });
      } catch (err) {
        logError(ctx, "Failed to create fleet", err, "fleet_create_failed");
        res.status(500).json({ error: "Failed to create fleet" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/fleets/{id}:
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
    ctx.rbac.require("manage") as never,
    async (req: Request, res: Response) => {
      const userId = actor(ctx);
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
        (!Array.isArray(tagRules) ||
          tagRules.some((t) => typeof t !== "string"))
      ) {
        return res
          .status(400)
          .json({ error: "tagRules must be an array of strings" });
      }

      try {
        const updated = await repo.update(userId, fleetId, {
          name: name !== undefined ? name.trim() : undefined,
          description,
          color,
          icon,
          tagRules,
        });
        if (!updated) {
          return res.status(404).json({ error: "Fleet not found" });
        }
        res.json({
          ...updated,
          tagRules: updated.tagRules ? JSON.parse(updated.tagRules) : [],
        });
      } catch (err) {
        logError(ctx, "Failed to update fleet", err, "fleet_update_failed");
        res.status(500).json({ error: "Failed to update fleet" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/fleets/{id}:
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
    ctx.rbac.require("manage") as never,
    async (req: Request, res: Response) => {
      const userId = actor(ctx);
      const fleetId = parseFleetId(req.params.id);
      if (fleetId === null) {
        return res.status(400).json({ error: "Invalid fleet ID" });
      }
      try {
        const deleted = await repo.delete(userId, fleetId);
        if (!deleted) {
          return res.status(404).json({ error: "Fleet not found" });
        }
        res.json({ success: true });
      } catch (err) {
        logError(ctx, "Failed to delete fleet", err, "fleet_delete_failed");
        res.status(500).json({ error: "Failed to delete fleet" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/fleets/{id}/members:
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
    ctx.rbac.require("view") as never,
    async (req: Request, res: Response) => {
      const userId = actor(ctx);
      const fleetId = parseFleetId(req.params.id);
      if (fleetId === null) {
        return res.status(400).json({ error: "Invalid fleet ID" });
      }

      try {
        const fleet = await repo.findById(userId, fleetId);
        if (!fleet) {
          return res.status(404).json({ error: "Fleet not found" });
        }

        const staticIds = await repo.listStaticMemberIds(fleetId);
        const staticIdSet = new Set(staticIds);
        const members = await repo.listEffectiveMembers(userId, fleetId);

        const annotated = await Promise.all(
          members.map(async (host) => {
            const access = await ctx.hosts.checkAccess(host.id, "connect");
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
        logError(
          ctx,
          "Failed to list fleet members",
          err,
          "fleet_members_list_failed",
        );
        res.status(500).json({ error: "Failed to list fleet members" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/fleets/{id}/members:
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
    ctx.rbac.require("manage") as never,
    async (req: Request, res: Response) => {
      const userId = actor(ctx);
      const fleetId = parseFleetId(req.params.id);
      const hostId = Number(req.body?.hostId);

      if (fleetId === null || !Number.isInteger(hostId)) {
        return res
          .status(400)
          .json({ error: "Valid fleetId and hostId are required" });
      }

      try {
        const fleet = await repo.findById(userId, fleetId);
        if (!fleet) {
          return res.status(404).json({ error: "Fleet not found" });
        }

        const access = await ctx.hosts.checkAccess(hostId, "connect");
        if (!access.hasAccess) {
          return res.status(404).json({ error: "Host not found" });
        }

        await repo.addMember(fleetId, hostId);
        res.json({ success: true });
      } catch (err) {
        logError(
          ctx,
          "Failed to add fleet member",
          err,
          "fleet_member_add_failed",
        );
        res.status(500).json({ error: "Failed to add fleet member" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/fleets/{id}/members/{hostId}:
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
    ctx.rbac.require("manage") as never,
    async (req: Request, res: Response) => {
      const userId = actor(ctx);
      const fleetId = parseFleetId(req.params.id);
      const hostId = parseFleetId(req.params.hostId);

      if (fleetId === null || hostId === null) {
        return res.status(400).json({ error: "Invalid fleet or host ID" });
      }

      try {
        const fleet = await repo.findById(userId, fleetId);
        if (!fleet) {
          return res.status(404).json({ error: "Fleet not found" });
        }

        const removed = await repo.removeMember(fleetId, hostId);
        if (!removed) {
          return res.status(404).json({ error: "Membership not found" });
        }
        res.json({ success: true });
      } catch (err) {
        logError(
          ctx,
          "Failed to remove fleet member",
          err,
          "fleet_member_remove_failed",
        );
        res.status(500).json({ error: "Failed to remove fleet member" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/fleets/{id}/share:
   *   post:
   *     summary: Share a fleet's current member hosts with users or roles
   *     description: Snapshot at share time - grants host access for every current member host to each target. Hosts added to the fleet later are not automatically shared; re-run this route to extend sharing to new members.
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
    ctx.rbac.require("manage") as never,
    async (req: Request, res: Response) => {
      const userId = actor(ctx);
      const fleetId = parseFleetId(req.params.id);
      if (fleetId === null) {
        return res.status(400).json({ error: "Invalid fleet ID" });
      }

      try {
        const fleet = await repo.findById(userId, fleetId);
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
        if (!isShareLevel(permissionLevel)) {
          return res.status(400).json({ error: "Invalid permission level" });
        }

        const members = await repo.listEffectiveMembers(userId, fleetId);
        const hostResults: Array<{
          hostId: number;
          shared: boolean;
          reason?: string;
        }> = [];

        for (const host of members) {
          if (targets.some((t) => t.type === "user" && t.id === host.userId)) {
            hostResults.push({
              hostId: host.id,
              shared: false,
              reason: "owner",
            });
            continue;
          }
          const result = await ctx.hosts.share(
            host.id,
            targets,
            permissionLevel,
            typeof durationHours === "number" ? durationHours : undefined,
          );
          hostResults.push(result);
        }

        const sharedCount = hostResults.filter((r) => r.shared).length;
        const expiresAt =
          typeof durationHours === "number" && durationHours > 0
            ? new Date(
                Date.now() + durationHours * 60 * 60 * 1000,
              ).toISOString()
            : null;

        res.json({
          success: true,
          permissionLevel,
          expiresAt,
          hostsShared: sharedCount,
          hostsTotal: members.length,
          hostResults,
        });
      } catch (err) {
        logError(ctx, "Failed to share fleet", err, "fleet_share_failed");
        res.status(500).json({ error: "Failed to share fleet" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/fleets/share-targets/users:
   *   get:
   *     summary: Users the caller may pick as a fleet share target
   *     tags:
   *       - Fleets
   *     responses:
   *       200:
   *         description: Users list.
   */
  router.get(
    "/share-targets/users",
    ctx.rbac.require("manage") as never,
    async (_req: Request, res: Response) => {
      try {
        res.json({ users: await ctx.hosts.listUsers() });
      } catch (err) {
        logError(
          ctx,
          "Failed to list share target users",
          err,
          "fleet_share_targets_users_failed",
        );
        res.status(500).json({ error: "Failed to list users" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/fleets/share-targets/roles:
   *   get:
   *     summary: Non-system roles the caller may pick as a fleet share target
   *     tags:
   *       - Fleets
   *     responses:
   *       200:
   *         description: Roles list.
   */
  router.get(
    "/share-targets/roles",
    ctx.rbac.require("manage") as never,
    async (_req: Request, res: Response) => {
      try {
        res.json({ roles: await ctx.hosts.listRoles() });
      } catch (err) {
        logError(
          ctx,
          "Failed to list share target roles",
          err,
          "fleet_share_targets_roles_failed",
        );
        res.status(500).json({ error: "Failed to list roles" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/fleets/{id}/execute:
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
    ctx.rbac.require("execute") as never,
    async (req: Request, res: Response) => {
      const userId = actor(ctx);
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
          ctx,
          repo,
          userId,
          fleetId,
          "edit",
          async (host) => {
            const fullHost = await ctx.hosts.get(host.id);
            if (!fullHost) {
              return { success: false, error: "Host not found" };
            }

            const resolvedCommand = resolveCommandVariables(
              command,
              {
                ip: fullHost.ip,
                username: fullHost.username,
                port: fullHost.port,
                name: fullHost.name ?? undefined,
              },
              inputValues && typeof inputValues === "object" ? inputValues : {},
            );

            const { stdout, stderr, code } = await ctx.ssh.withConnection(
              host.id,
              { pool: "fleet", purpose: "fleet" },
              (client) => execCommand(client as Client, resolvedCommand, 60000),
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

        res.json({ results });
      } catch (err) {
        logError(
          ctx,
          "Failed to execute fleet command",
          err,
          "fleet_execute_failed",
        );
        res.status(500).json({ error: "Failed to execute fleet command" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/fleets/{id}/transfer/push:
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
    ctx.rbac.require("execute") as never,
    upload.single("file"),
    async (req: Request, res: Response) => {
      const userId = actor(ctx);
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
          ctx,
          repo,
          userId,
          fleetId,
          "edit",
          async (host) => {
            await ctx.ssh.withConnection(
              host.id,
              { pool: "fleet", purpose: "fleet" },
              async (client) => {
                const sftp = await getSftp(client as Client);
                await sftpWriteFile(sftp, remotePath, file.buffer);
              },
            );

            return { success: true, output: `Written to ${remotePath}` };
          },
        );

        if (!fleetFound) {
          return res.status(404).json({ error: "Fleet not found" });
        }

        res.json({ results });
      } catch (err) {
        logError(
          ctx,
          "Failed to push file across fleet",
          err,
          "fleet_transfer_push_failed",
        );
        res.status(500).json({ error: "Failed to push file across fleet" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/fleets/{id}/transfer/pull:
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
    ctx.rbac.require("execute") as never,
    async (req: Request, res: Response) => {
      const userId = actor(ctx);
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
          ctx,
          repo,
          userId,
          fleetId,
          "edit",
          async (host) => {
            const data = await ctx.ssh.withConnection<Buffer>(
              host.id,
              { pool: "fleet", purpose: "fleet" },
              async (client) => {
                const sftp = await getSftp(client as Client);
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
        logError(
          ctx,
          "Failed to pull file across fleet",
          err,
          "fleet_transfer_pull_failed",
        );
        res.status(500).json({ error: "Failed to pull file across fleet" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/fleets/{id}/inventory:
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
    ctx.rbac.require("view") as never,
    async (req: Request, res: Response) => {
      const userId = actor(ctx);
      const fleetId = parseFleetId(req.params.id);
      if (fleetId === null) {
        return res.status(400).json({ error: "Invalid fleet ID" });
      }

      try {
        const fleet = await repo.findById(userId, fleetId);
        if (!fleet) {
          return res.status(404).json({ error: "Fleet not found" });
        }

        const members = await repo.listEffectiveMembers(userId, fleetId);
        const inventory = await repo.listInventoryForHosts(
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
        logError(
          ctx,
          "Failed to read fleet inventory",
          err,
          "fleet_inventory_read_failed",
        );
        res.status(500).json({ error: "Failed to read fleet inventory" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/fleets/{id}/inventory:
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
    ctx.rbac.require("execute") as never,
    async (req: Request, res: Response) => {
      const userId = actor(ctx);
      const fleetId = parseFleetId(req.params.id);
      if (fleetId === null) {
        return res.status(400).json({ error: "Invalid fleet ID" });
      }

      try {
        const { results, fleetFound } = await runAcrossFleet(
          ctx,
          repo,
          userId,
          fleetId,
          "view",
          async (host) => {
            const fullHost = await ctx.hosts.get(host.id);
            if (!fullHost) {
              return { success: false, error: "Host not found" };
            }

            const record = await ctx.ssh.withConnection(
              host.id,
              { pool: "fleet", purpose: "fleet" },
              async (client) => {
                const sshClient = client as Client;
                const platform = await detectPlatform(sshClient);
                const { stdout } = await execCommand(
                  sshClient,
                  INVENTORY_PROBE_COMMAND,
                  15000,
                );
                const facts = parseInventoryProbe(stdout);

                return repo.upsertInventory(userId, host.id, {
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
        logError(
          ctx,
          "Failed to refresh fleet inventory",
          err,
          "fleet_inventory_refresh_failed",
        );
        res.status(500).json({ error: "Failed to refresh fleet inventory" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/fleets/{id}/packages:
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
    ctx.rbac.require("manage") as never,
    async (req: Request, res: Response) => {
      const userId = actor(ctx);
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
          ctx,
          repo,
          userId,
          fleetId,
          "manage",
          async (host) => {
            // Package actions need the host's sudo password, an operational
            // secret ctx.hosts.get() leaves out. ctx.ssh.connect resolves the
            // full host the connect pipeline uses, which carries it.
            const connection = await ctx.ssh.connect(host.id, {
              purpose: "fleet",
            });
            try {
              const sshClient = connection.client as Client;
              const platform = await detectPlatform(sshClient);
              const cmd =
                action === "remove"
                  ? buildPackageRemoveCommand(platform.pkg, packageName)
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
                  sshClient,
                  cmd,
                  connection.host.sudoPassword as string | undefined,
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
            } finally {
              connection.dispose();
            }
          },
        );

        if (!fleetFound) {
          return res.status(404).json({ error: "Fleet not found" });
        }

        res.json({ results });
      } catch (err) {
        logError(
          ctx,
          "Failed to run fleet package action",
          err,
          "fleet_packages_failed",
        );
        res.status(500).json({ error: "Failed to run fleet package action" });
      }
    },
  );
}
