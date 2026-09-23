import type { Request, Response, Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import type { GraphRepository } from "./repository.js";

function actor(ctx: PluginContext): string {
  // Core's plugin router authenticates every request and runs it as that user.
  return ctx.currentActor() as string;
}

/**
 * Mounts the graph routes on the plugin's router, which core serves at
 * /plugin-api/network-topology with auth in front.
 */
export function registerGraphRoutes(
  router: Router,
  repo: GraphRepository,
  ctx: PluginContext,
): void {
  router.use(ctx.rbac.require("use") as never);

  /**
   * @openapi
   * /plugin-api/network-topology:
   *   get:
   *     summary: Get network topology for authenticated user
   *     description: Retrieves the saved network topology graph (nodes and edges) for the current user. Returns null if no topology exists.
   *     tags:
   *       - Network Topology
   *     responses:
   *       200:
   *         description: Network topology retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               nullable: true
   *               properties:
   *                 nodes:
   *                   type: array
   *                   description: Array of graph nodes (hosts and groups)
   *                 edges:
   *                   type: array
   *                   description: Array of graph edges (connections)
   */
  router.get("/", async (req: Request, res: Response) => {
    const userId = actor(ctx);
    try {
      const record = await repo.findByUserId(userId);
      const topology = record?.topology ? JSON.parse(record.topology) : null;
      res.json(topology);
    } catch (err) {
      ctx.log.error(
        "Failed to fetch network topology",
        err instanceof Error ? err : new Error(String(err)),
      );
      res.status(500).json({ error: "Failed to fetch network topology" });
    }
  });

  /**
   * @openapi
   * /plugin-api/network-topology:
   *   post:
   *     summary: Save network topology for authenticated user
   *     description: Saves or updates the network topology graph. Uses upsert logic - creates new record if none exists, updates existing record otherwise.
   *     tags:
   *       - Network Topology
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - topology
   *             properties:
   *               topology:
   *                 type: object
   *                 description: Network topology data containing nodes and edges
   *     responses:
   *       200:
   *         description: Topology saved successfully
   *       400:
   *         description: Invalid topology data
   */
  router.post("/", async (req: Request, res: Response) => {
    const userId = actor(ctx);
    const { topology } = req.body ?? {};
    if (!topology) {
      return res.status(400).json({ error: "Topology data is required" });
    }

    try {
      const topologyStr =
        typeof topology === "string" ? topology : JSON.stringify(topology);
      await repo.upsertForUser(userId, topologyStr);
      res.json({ success: true });
    } catch (err) {
      ctx.log.error(
        "Failed to save network topology",
        err instanceof Error ? err : new Error(String(err)),
      );
      res.status(500).json({ error: "Failed to save network topology" });
    }
  });
}
