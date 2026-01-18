import express from "express";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { networkTopology } from "../db/schema.js";
import { AuthManager } from "../../utils/auth-manager.js";
import type { AuthenticatedRequest } from "../../../types/index.js";

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

      const db = getDb();
      const result = await db
        .select()
        .from(networkTopology)
        .where(eq(networkTopology.userId, userId));

      if (result.length > 0) {
        const topologyStr = result[0].topology;
        const topology = topologyStr ? JSON.parse(topologyStr) : null;
        return res.json(topology);
      } else {
        return res.json(null);
      }
    } catch (error) {
      console.error("Error fetching network topology:", error);
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

      const db = getDb();

      // Ensure topology is a string
      const topologyStr =
        typeof topology === "string" ? topology : JSON.stringify(topology);

      const existing = await db
        .select()
        .from(networkTopology)
        .where(eq(networkTopology.userId, userId));

      if (existing.length > 0) {
        // Update existing record
        await db
          .update(networkTopology)
          .set({ topology: topologyStr })
          .where(eq(networkTopology.userId, userId));
      } else {
        // Insert new record
        await db
          .insert(networkTopology)
          .values({ userId, topology: topologyStr });
      }

      return res.json({ success: true });
    } catch (error) {
      console.error("Error saving network topology:", error);
      return res.status(500).json({
        error: "Failed to save network topology",
        details: (error as Error).message,
      });
    }
  },
);

export default router;
