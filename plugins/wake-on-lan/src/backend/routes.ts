import type { Request, Response, Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import type { WakeOnLanV1 } from "./service.js";

export function registerWakeOnLanRoutes(
  router: Router,
  ctx: PluginContext,
  service: WakeOnLanV1,
): void {
  router.use(ctx.rbac.require("send") as never);

  /**
   * @openapi
   * /plugin-api/wake-on-lan/host/{id}/wake:
   *   post:
   *     summary: Send a Wake-on-LAN magic packet to a host
   *     tags:
   *       - Wake-on-LAN
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Packet sent
   *       400:
   *         description: No valid MAC address configured
   *       404:
   *         description: Host not found
   */
  router.post("/host/:id/wake", async (req: Request, res: Response) => {
    const hostId = Number.parseInt(String(req.params.id), 10);
    if (!Number.isInteger(hostId)) {
      return res.status(400).json({ error: "Invalid host id" });
    }
    try {
      await service.wake(hostId);
      res.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message === "Host not found" ? 404 : 400;
      res.status(status).json({ error: message });
    }
  });
}
