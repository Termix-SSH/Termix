import express from "express";
import { db } from "../db/index.js";
import {
  sshData,
  sshConnections,
  fileManagerRecent,
  fileManagerPinned,
  sshCredentials,
  users,
} from "../db/schema.js";
import { eq, and, desc, isNotNull, or, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { sshLogger } from "../../utils/logger.js";
import { SimpleDBOps } from "../../utils/simple-db-ops.js";
import { AuthManager } from "../../utils/auth-manager.js";
import axios from "axios";
import { readFileSync } from "fs";
import { join } from "path";

const router = express.Router();

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

// Route: Get recent SSH connections (requires JWT)
// GET /homepage/recent-connections
router.get("/recent-connections", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const limit = Math.min(parseInt(req.query.limit as string) || 10, 40); // Cap at 40

  if (!userId) {
    return res.status(400).json({ error: "Invalid userId" });
  }

  try {
    const recentConnections = await db
      .select({
        id: sshConnections.id,
        hostId: sshConnections.hostId,
        connectedAt: sshConnections.connectedAt,
        disconnectedAt: sshConnections.disconnectedAt,
        duration: sshConnections.duration,
        connectionType: sshConnections.connectionType,
        hostName: sshData.name,
        hostIp: sshData.ip,
        hostPort: sshData.port,
        hostUsername: sshData.username,
      })
      .from(sshConnections)
      .innerJoin(sshData, eq(sshConnections.hostId, sshData.id))
      .where(eq(sshConnections.userId, userId))
      .orderBy(desc(sshConnections.connectedAt))
      .limit(limit);

    res.json(recentConnections);
  } catch (err) {
    sshLogger.error("Failed to fetch recent connections", err);
    res.status(500).json({ error: "Failed to fetch recent connections" });
  }
});

// Route: Record SSH connection (requires JWT)
// POST /homepage/record-connection
router.post("/record-connection", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const { hostId, connectionType = "terminal" } = req.body;

  if (!userId || !hostId) {
    return res.status(400).json({ error: "userId and hostId are required" });
  }

  try {
    const connection = await db.insert(sshConnections).values({
      userId,
      hostId: parseInt(hostId),
      connectionType,
      connectedAt: new Date().toISOString(),
    }).returning();

    // Cleanup: Keep only the last 40 connections per user
    await db.$client.prepare(`
      DELETE FROM ssh_connections
      WHERE user_id = ?
      AND id NOT IN (
        SELECT id FROM ssh_connections
        WHERE user_id = ?
        ORDER BY connected_at DESC
        LIMIT 40
      )
    `).run(userId, userId);

    res.json(connection[0]);
  } catch (err) {
    sshLogger.error("Failed to record connection", err);
    res.status(500).json({ error: "Failed to record connection" });
  }
});

// Route: Update SSH connection disconnect (requires JWT)
// PUT /homepage/update-connection/:id
router.put("/update-connection/:id", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const connectionId = req.params.id;

  if (!userId || !connectionId) {
    return res.status(400).json({ error: "userId and connectionId are required" });
  }

  try {
    const connection = await db
      .select()
      .from(sshConnections)
      .where(and(eq(sshConnections.id, parseInt(connectionId)), eq(sshConnections.userId, userId)))
      .limit(1);

    if (connection.length === 0) {
      return res.status(404).json({ error: "Connection not found" });
    }

    const connectedAt = new Date(connection[0].connectedAt);
    const disconnectedAt = new Date();
    const duration = Math.floor((disconnectedAt.getTime() - connectedAt.getTime()) / 1000);

    await db
      .update(sshConnections)
      .set({
        disconnectedAt: disconnectedAt.toISOString(),
        duration,
      })
      .where(eq(sshConnections.id, parseInt(connectionId)));

    res.json({ message: "Connection updated successfully" });
  } catch (err) {
    sshLogger.error("Failed to update connection", err);
    res.status(500).json({ error: "Failed to update connection" });
  }
});

// Route: Get server stats (requires JWT)
// GET /homepage/server-stats
router.get("/server-stats", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as any).userId;

  if (!userId) {
    return res.status(400).json({ error: "Invalid userId" });
  }

  try {
    // Get total hosts count
    const totalHosts = await db
      .select({ count: sql<number>`count(*)` })
      .from(sshData)
      .where(eq(sshData.userId, userId));

    // Get pinned hosts count
    const pinnedHosts = await db
      .select({ count: sql<number>`count(*)` })
      .from(sshData)
      .where(and(eq(sshData.userId, userId), eq(sshData.pin, true)));

    // Get total number of tunnels across all hosts
    const hostsWithTunnels = await db
      .select()
      .from(sshData)
      .where(
        and(
          eq(sshData.userId, userId),
          eq(sshData.enableTunnel, true),
          isNotNull(sshData.tunnelConnections)
        )
      );

    const totalTunnels = hostsWithTunnels.reduce((total, host) => {
      const tunnelConnections = host.tunnelConnections
        ? JSON.parse(host.tunnelConnections)
        : [];
      return total + tunnelConnections.length;
    }, 0);

    // Get recent connections count (last 24 hours)
    const recentConnections = await db
      .select({ count: sql<number>`count(*)` })
      .from(sshConnections)
      .where(
        and(
          eq(sshConnections.userId, userId),
          sql`datetime(${sshConnections.connectedAt}) > datetime('now', '-1 day')`
        )
      );

    // Get credentials count
    const credentialsCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(sshCredentials)
      .where(eq(sshCredentials.userId, userId));

    res.json({
      totalHosts: totalHosts[0]?.count || 0,
      pinnedHosts: pinnedHosts[0]?.count || 0,
      tunnelHosts: totalTunnels,
      recentConnections: recentConnections[0]?.count || 0,
      credentialsCount: credentialsCount[0]?.count || 0,
    });
  } catch (err) {
    sshLogger.error("Failed to fetch server stats", err);
    res.status(500).json({ error: "Failed to fetch server stats" });
  }
});

// Route: Get active tunnels (requires JWT)
// GET /homepage/active-tunnels
router.get("/active-tunnels", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as any).userId;

  if (!userId) {
    return res.status(400).json({ error: "Invalid userId" });
  }

  try {
    // Get tunnel statuses from the tunnel service
    let tunnelStatuses: Record<string, any> = {};
    try {
      const tunnelServiceResponse = await axios.get("http://localhost:30002/ssh/tunnel/status", {
        timeout: 1000, // 1 second timeout
      });
      tunnelStatuses = tunnelServiceResponse.data || {};
    } catch (error) {
      // Silently fail - tunnel service might not be running
      // Don't log anything to avoid spam
    }

    const hostsWithTunnels = await SimpleDBOps.select(
      db
        .select()
        .from(sshData)
        .where(
          and(
            eq(sshData.userId, userId),
            eq(sshData.enableTunnel, true),
            isNotNull(sshData.tunnelConnections)
          )
        ),
      "ssh_data",
      userId,
    );

    const allTunnels = hostsWithTunnels
      .map((host) => {
        const tunnelConnections = host.tunnelConnections
          ? JSON.parse(host.tunnelConnections)
          : [];

        return tunnelConnections.map((tunnel: any) => {
          const tunnelName = `${host.id}-${tunnel.localPort}`;
          const realStatus = tunnelStatuses[tunnelName];
          
          return {
            id: tunnelName,
            hostId: host.id,
            hostName: host.name || `${host.username}@${host.ip}`,
            hostIp: host.ip,
            localPort: tunnel.localPort,
            remoteHost: tunnel.remoteHost,
            remotePort: tunnel.remotePort,
            status: realStatus?.status || tunnel.status || "unknown",
            autoStart: tunnel.autoStart || false,
          };
        });
      })
      .flat();

    res.json(allTunnels);
  } catch (err) {
    sshLogger.error("Failed to fetch active tunnels", err);
    res.status(500).json({ error: "Failed to fetch active tunnels" });
  }
});

// Route: Get recent and pinned files (requires JWT)
// GET /homepage/recent-files
router.get("/recent-files", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const limit = Math.min(parseInt(req.query.limit as string) || 10, 40); // Cap at 40

  if (!userId) {
    return res.status(400).json({ error: "Invalid userId" });
  }

  try {
    // Get recent files across all hosts
    const recentFiles = await db
      .select({
        id: fileManagerRecent.id,
        hostId: fileManagerRecent.hostId,
        name: fileManagerRecent.name,
        path: fileManagerRecent.path,
        lastOpened: fileManagerRecent.lastOpened,
        hostName: sshData.name,
        hostIp: sshData.ip,
      })
      .from(fileManagerRecent)
      .innerJoin(sshData, eq(fileManagerRecent.hostId, sshData.id))
      .where(eq(fileManagerRecent.userId, userId))
      .orderBy(desc(fileManagerRecent.lastOpened))
      .limit(limit);

    // Get pinned files across all hosts
    const pinnedFiles = await db
      .select({
        id: fileManagerPinned.id,
        hostId: fileManagerPinned.hostId,
        name: fileManagerPinned.name,
        path: fileManagerPinned.path,
        pinnedAt: fileManagerPinned.pinnedAt,
        hostName: sshData.name,
        hostIp: sshData.ip,
      })
      .from(fileManagerPinned)
      .innerJoin(sshData, eq(fileManagerPinned.hostId, sshData.id))
      .where(eq(fileManagerPinned.userId, userId))
      .orderBy(desc(fileManagerPinned.pinnedAt))
      .limit(limit);

    res.json({
      recentFiles,
      pinnedFiles,
    });
  } catch (err) {
    sshLogger.error("Failed to fetch recent files", err);
    res.status(500).json({ error: "Failed to fetch recent files" });
  }
});

// Route: Get quick access data (requires JWT)
// GET /homepage/quick-access
router.get("/quick-access", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as any).userId;

  if (!userId) {
    return res.status(400).json({ error: "Invalid userId" });
  }

  try {
    // Get pinned hosts for quick access
    const pinnedHosts = await SimpleDBOps.select(
      db
        .select()
        .from(sshData)
        .where(and(eq(sshData.userId, userId), eq(sshData.pin, true)))
        .orderBy(desc(sshData.updatedAt))
        .limit(5),
      "ssh_data",
      userId,
    );

    // Get recent credentials
    const recentCredentials = await SimpleDBOps.select(
      db
        .select()
        .from(sshCredentials)
        .where(eq(sshCredentials.userId, userId))
        .orderBy(desc(sshCredentials.lastUsed))
        .limit(5),
      "ssh_credentials",
      userId,
    );

    res.json({
      pinnedHosts,
      recentCredentials,
    });
  } catch (err) {
    sshLogger.error("Failed to fetch quick access data", err);
    res.status(500).json({ error: "Failed to fetch quick access data" });
  }
});

// Route: Get system status (requires JWT)
// GET /homepage/system-status
router.get("/system-status", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as any).userId;

  if (!userId) {
    return res.status(400).json({ error: "Invalid userId" });
  }

  try {
    // Get total users count
    const totalUsers = await db
      .select({ count: sql<number>`count(*)` })
      .from(users);

    // Read version from package.json
    let version = "1.8.0"; // fallback
    try {
      const packagePath = join(process.cwd(), "package.json");
      const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
      version = packageJson.version || version;
    } catch (err) {
      sshLogger.warn("Failed to read package.json for version", err);
    }

    // Get database health
    let databaseStatus: "healthy" | "warning" | "error" | "unknown" = "unknown";
    try {
      await db.select().from(users).limit(1);
      databaseStatus = "healthy";
    } catch (err) {
      databaseStatus = "error";
    }

    // Get authentication status
    let authStatus: "healthy" | "warning" | "error" | "unknown" = "unknown";
    try {
      const authManager = AuthManager.getInstance();
      // Test if auth manager is working
      authStatus = "healthy";
    } catch (err) {
      authStatus = "error";
    }

    // Get uptime (since server start)
    const uptimeMs = process.uptime() * 1000;
    const days = Math.floor(uptimeMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((uptimeMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
    const uptime = `${days}d ${hours}h ${minutes}m`;

    res.json({
      database: databaseStatus,
      authentication: authStatus,
      uptime,
      version,
      activeConnections: 0, // TODO: Implement real active connections tracking
      totalUsers: totalUsers[0]?.count || 0,
    });
  } catch (err) {
    sshLogger.error("Failed to fetch system status", err);
    res.status(500).json({ error: "Failed to fetch system status" });
  }
});

export default router;
