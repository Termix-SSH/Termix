import type { Router, Request, Response } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { MaintenanceInputError } from "./maintenance-time.js";
import type { MaintenanceService } from "./maintenance-service.js";

export function registerMaintenanceRoutes(
  router: Router,
  ctx: PluginContext,
  service: MaintenanceService,
) {
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
  router.get(
    "/maintenance/:hostId",
    ctx.rbac.require("view") as never,
    handle(false),
  );
  router.post(
    "/maintenance/:hostId",
    ctx.rbac.require("edit") as never,
    handle(true),
  );
}
