import type { Router, Request, Response } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { MaintenanceInputError } from "./maintenance-time.js";
import type { MaintenanceService } from "./maintenance-service.js";

export function registerMaintenanceRoutes(
  router: Router,
  ctx: PluginContext,
  service: MaintenanceService,
) {
  /**
   * @openapi
   * /plugin-api/automations/maintenance:
   *   get:
   *     summary: List maintenance windows on the caller's hosts
   *     tags: [Automations]
   *     responses:
   *       200: { description: Maintenance state per host. }
   *       401: { description: Not signed in. }
   */
  router.get(
    "/maintenance",
    ctx.rbac.require("view") as never,
    async (_req: Request, res: Response) => {
      try {
        const user = ctx.currentActor();
        if (!user)
          return res.status(401).json({ error: "Authentication required" });
        const hosts = new Set(
          (await ctx.hosts.list())
            .filter((host) => host.userId === user)
            .map((host) => host.id),
        );
        res.json(
          (await service.list(user)).filter((row) => hosts.has(row.hostId)),
        );
      } catch (error) {
        ctx.log.error("Failed to list maintenance", error as Error);
        res.status(500).json({ error: "Failed to list maintenance" });
      }
    },
  );
  const handle = (mutate: boolean) => async (req: Request, res: Response) => {
    const hostId = Number(req.params.hostId);
    if (!Number.isSafeInteger(hostId) || hostId < 1)
      return res.status(400).json({ error: "Invalid host id" });
    const user = ctx.currentActor();
    if (!user)
      return res.status(401).json({ error: "Authentication required" });
    try {
      const host = await ctx.hosts.get(hostId);
      if (!host || host.userId !== user)
        return res.status(404).json({ error: "Host not found" });
      if (!mutate) return res.json(await service.read(user, hostId));
      const state = await service.edit(
        user,
        hostId,
        req.body?.action,
        req.body,
      );
      await ctx.audit.record({
        action: `maintenance_${req.body.action}`,
        resourceType: "host",
        resourceId: String(hostId),
        resourceName: host.name || host.ip,
        success: true,
      });
      res.json(state);
    } catch (error) {
      // Validation failures have no side effects; storage failures remain errors.
      if (error instanceof MaintenanceInputError) {
        return res.status(400).json({ error: error.message });
      }
      ctx.log.error("Failed to update maintenance", error as Error);
      res.status(500).json({ error: "Failed to update maintenance" });
    }
  };
  /**
   * @openapi
   * /plugin-api/automations/maintenance/{hostId}:
   *   get:
   *     summary: Get a host's maintenance state and schedule
   *     tags: [Automations]
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema: { type: integer }
   *     responses:
   *       200: { description: The active window, if any, and the planned ones. }
   *       404: { description: Not one of the caller's hosts. }
   */
  router.get(
    "/maintenance/:hostId",
    ctx.rbac.require("view") as never,
    handle(false),
  );
  /**
   * @openapi
   * /plugin-api/automations/maintenance/{hostId}:
   *   post:
   *     summary: Start, schedule, end or remove maintenance on a host
   *     description: While a host is in maintenance its downtime does not raise alerts. Past the estimated end plus the grace period, it can alert again.
   *     tags: [Automations]
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema: { type: integer }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [action]
   *             properties:
   *               action: { type: string, enum: [start, schedule, end, remove] }
   *               reason: { type: string }
   *               start: { type: string, format: date-time, description: When a scheduled window begins. }
   *               durationMinutes: { type: integer, description: Estimated length. }
   *               graceMinutes: { type: integer }
   *               recurrence: { type: string, description: Repeat a scheduled window, e.g. weekly or monthly. }
   *     responses:
   *       200: { description: The new maintenance state. }
   *       400: { description: Invalid action or plan. }
   *       404: { description: Not one of the caller's hosts. }
   */
  router.post(
    "/maintenance/:hostId",
    ctx.rbac.require("edit") as never,
    handle(true),
  );
}
