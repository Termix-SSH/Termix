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
 *     summary: Get network topology
 *     description: Retrieves the network topology for the authenticated user.
 *     tags:
 *       - Network Topology
 *     responses:
 *       200:
 *         description: The network topology.
 *       401:
 *         description: User not authenticated.
 *       500:
 *         description: Failed to fetch network topology.
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
      return res
        .status(500)
        .json({
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
 *     summary: Save network topology
 *     description: Saves the network topology for the authenticated user.
 *     tags:
 *       - Network Topology
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               topology:
 *                 type: object
 *     responses:
 *       200:
 *         description: Network topology saved successfully.
 *       400:
 *         description: Topology data is required.
 *       401:
 *         description: User not authenticated.
 *       500:
 *         description: Failed to save network topology.
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
      return res
        .status(500)
        .json({
          error: "Failed to save network topology",
          details: (error as Error).message,
        });
    }
  },
);

export default router;
