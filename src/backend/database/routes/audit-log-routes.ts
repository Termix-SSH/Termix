import type { AuthenticatedRequest } from "../../../types/index.js";
import type { RequestHandler, Router } from "express";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { auditLogs, users } from "../db/schema.js";
import { apiLogger } from "../../utils/logger.js";

export function registerAuditLogRoutes(
  router: Router,
  authenticateJWT: RequestHandler,
): void {
  /**
   * @openapi
   * /audit-logs:
   *   get:
   *     summary: List audit logs
   *     description: Returns paginated, filterable audit log entries. Admin only.
   *     tags:
   *       - Audit
   *     parameters:
   *       - in: query
   *         name: page
   *         schema: { type: integer, default: 1 }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, default: 50, maximum: 200 }
   *       - in: query
   *         name: userId
   *         schema: { type: string }
   *       - in: query
   *         name: action
   *         schema: { type: string }
   *       - in: query
   *         name: resourceType
   *         schema: { type: string }
   *       - in: query
   *         name: success
   *         schema: { type: string, enum: [true, false] }
   *       - in: query
   *         name: startDate
   *         schema: { type: string, format: date-time }
   *       - in: query
   *         name: endDate
   *         schema: { type: string, format: date-time }
   *     responses:
   *       200:
   *         description: Paginated list of audit logs.
   *       403:
   *         description: Not authorized.
   *       500:
   *         description: Failed to fetch audit logs.
   */
  router.get("/audit-logs", authenticateJWT, async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const adminUser = await db
        .select({ isAdmin: users.isAdmin })
        .from(users)
        .where(eq(users.id, authReq.userId))
        .limit(1);

      if (!adminUser[0]?.isAdmin) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
      const limit = Math.min(
        200,
        Math.max(1, parseInt(String(req.query.limit || "50"), 10)),
      );
      const offset = (page - 1) * limit;

      const { userId, action, resourceType, success, startDate, endDate } =
        req.query as Record<string, string | undefined>;

      const conditions = [];

      if (userId) conditions.push(eq(auditLogs.userId, userId));
      if (action) conditions.push(eq(auditLogs.action, action));
      if (resourceType)
        conditions.push(eq(auditLogs.resourceType, resourceType));
      if (success !== undefined && success !== "") {
        conditions.push(eq(auditLogs.success, success === "true"));
      }
      if (startDate) conditions.push(gte(auditLogs.timestamp, startDate));
      if (endDate) conditions.push(lte(auditLogs.timestamp, endDate));

      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      const [logs, totalResult] = await Promise.all([
        db
          .select()
          .from(auditLogs)
          .where(whereClause)
          .orderBy(sql`${auditLogs.timestamp} DESC`)
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(auditLogs)
          .where(whereClause),
      ]);

      const total = totalResult[0]?.count ?? 0;
      const totalPages = Math.ceil(total / limit);

      return res.json({ logs, total, page, totalPages });
    } catch (err) {
      apiLogger.error("Failed to fetch audit logs", err);
      return res.status(500).json({ error: "Failed to fetch audit logs" });
    }
  });

  /**
   * @openapi
   * /audit-logs/actions:
   *   get:
   *     summary: List distinct audit log action types
   *     description: Returns all distinct action values in the audit log for filter dropdowns. Admin only.
   *     tags:
   *       - Audit
   *     responses:
   *       200:
   *         description: List of distinct action strings.
   *       403:
   *         description: Not authorized.
   *       500:
   *         description: Failed to fetch audit log actions.
   */
  router.get("/audit-logs/actions", authenticateJWT, async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const adminUser = await db
        .select({ isAdmin: users.isAdmin })
        .from(users)
        .where(eq(users.id, authReq.userId))
        .limit(1);

      if (!adminUser[0]?.isAdmin) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const rows = db.$client
        .prepare("SELECT DISTINCT action FROM audit_logs ORDER BY action ASC")
        .all() as { action: string }[];

      return res.json({ actions: rows.map((r) => r.action) });
    } catch (err) {
      apiLogger.error("Failed to fetch audit log actions", err);
      return res
        .status(500)
        .json({ error: "Failed to fetch audit log actions" });
    }
  });
}
