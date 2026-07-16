import type { AuthenticatedRequest } from "../../../types/index.js";
import type { RequestHandler, Router } from "express";
import {
  createCurrentAuditLogRepository,
  createCurrentUserRepository,
} from "../repositories/factory.js";
import { apiLogger } from "../../utils/logger.js";

async function isAdminUser(userId: string | undefined): Promise<boolean> {
  if (!userId) return false;
  const user = await createCurrentUserRepository().findById(userId);
  return !!user?.isAdmin;
}

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
      if (!(await isAdminUser(authReq.userId))) {
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

      const { logs, total } = await createCurrentAuditLogRepository().listPage({
        filters: {
          userId,
          action,
          resourceType,
          success:
            success !== undefined && success !== ""
              ? success === "true"
              : undefined,
          startDate,
          endDate,
        },
        limit,
        offset,
      });
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
      if (!(await isAdminUser(authReq.userId))) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const actions =
        await createCurrentAuditLogRepository().listDistinctActions();

      return res.json({ actions });
    } catch (err) {
      apiLogger.error("Failed to fetch audit log actions", err);
      return res
        .status(500)
        .json({ error: "Failed to fetch audit log actions" });
    }
  });
}
