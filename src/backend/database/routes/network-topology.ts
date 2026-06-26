import express from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { databaseLogger } from "../../utils/logger.js";
import { createCurrentNetworkTopologyRepository } from "../repositories/current-network-topology-repository.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/**
 * @openapi
 * /network-topology:
 *   get:
 *     summary: Get network topology for authenticated user
 *     description: Retrieves the saved network topology graph (nodes and edges) for the current user. Returns null if no topology exists.
 *     tags:
 *       - Network Topology
 *     security:
 *       - bearerAuth: []
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
 *                   items:
 *                     type: object
 *                     properties:
 *                       data:
 *                         type: object
 *                         description: Node data including id, label, type, etc.
 *                       position:
 *                         type: object
 *                         description: Node position coordinates
 *                         properties:
 *                           x:
 *                             type: number
 *                           y:
 *                             type: number
 *                 edges:
 *                   type: array
 *                   description: Array of graph edges (connections)
 *                   items:
 *                     type: object
 *                     properties:
 *                       data:
 *                         type: object
 *                         description: Edge data including source and target node ids
 *       401:
 *         description: User not authenticated
 *       500:
 *         description: Server error
 */
router.get(
  "/",
  authenticateJWT,
  async (req: express.Request, res: express.Response) => {
    try {
      const userId = (req as AuthenticatedRequest).userId;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const record =
        await createCurrentNetworkTopologyRepository().findByUserId(userId);

      if (record) {
        const topologyStr = record.topology;
        const topology = topologyStr ? JSON.parse(topologyStr) : null;
        return res.json(topology);
      } else {
        return res.json(null);
      }
    } catch (error) {
      databaseLogger.error("Failed to fetch network topology", error, {
        operation: "network_topology_fetch",
        userId: (req as AuthenticatedRequest).userId,
      });
      return res.status(500).json({
        error: "Failed to fetch network topology",
        details: (error as Error).message,
      });
    }
  },
);

/**
 * @openapi
 * /network-topology:
 *   post:
 *     summary: Save network topology for authenticated user
 *     description: Saves or updates the network topology graph. Uses upsert logic - creates new record if none exists, updates existing record otherwise.
 *     tags:
 *       - Network Topology
 *     security:
 *       - bearerAuth: []
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
 *                 properties:
 *                   nodes:
 *                     type: array
 *                     description: Array of graph nodes (hosts and groups)
 *                   edges:
 *                     type: array
 *                     description: Array of graph edges (connections)
 *     responses:
 *       200:
 *         description: Topology saved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       400:
 *         description: Invalid topology data
 *       401:
 *         description: User not authenticated
 *       500:
 *         description: Server error
 */
router.post(
  "/",
  authenticateJWT,
  async (req: express.Request, res: express.Response) => {
    try {
      const userId = (req as AuthenticatedRequest).userId;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const { topology } = req.body;
      if (!topology) {
        return res.status(400).json({ error: "Topology data is required" });
      }

      const topologyStr =
        typeof topology === "string" ? topology : JSON.stringify(topology);

      await createCurrentNetworkTopologyRepository().upsertForUser(
        userId,
        topologyStr,
      );

      return res.json({ success: true });
    } catch (error) {
      databaseLogger.error("Failed to save network topology", error, {
        operation: "network_topology_save",
        userId: (req as AuthenticatedRequest).userId,
      });
      return res.status(500).json({
        error: "Failed to save network topology",
        details: (error as Error).message,
      });
    }
  },
);

export default router;
