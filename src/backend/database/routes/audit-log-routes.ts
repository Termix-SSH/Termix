import type { AuthenticatedRequest } from "../../../types/index.js";
import type { RequestHandler, Router } from "express";
import {
  createCurrentAuditLogRepository,
  createCurrentUserRepository,
} from "../repositories/factory.js";
import { apiLogger } from "../../utils/logger.js";
import { exportFilename, toCsv, toNdjson } from "../../utils/audit-export.js";
import {
  logAudit,
  getAuditUsername,
  getRequestMeta,
} from "../../utils/audit-logger.js";

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

  /**
   * @openapi
   * /audit-logs/export:
   *   get:
   *     summary: Export audit logs
   *     description: Streams the full filtered result set as CSV or NDJSON. Accepts the same filters as GET /audit-logs. Admin only. The export is itself audited.
   *     tags:
   *       - Audit
   *     parameters:
   *       - in: query
   *         name: format
   *         schema: { type: string, enum: [csv, ndjson], default: csv }
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
   *         description: Audit log file.
   *       403:
   *         description: Not authorized.
   *       500:
   *         description: Failed to export audit logs.
   */
  router.get("/audit-logs/export", authenticateJWT, async (req, res) => {
    const authReq = req as AuthenticatedRequest;
    try {
      if (!(await isAdminUser(authReq.userId))) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const format = req.query.format === "ndjson" ? "ndjson" : "csv";
      const { userId, action, resourceType, success, startDate, endDate } =
        req.query as Record<string, string | undefined>;
      const filters = {
        userId,
        action,
        resourceType,
        success:
          success !== undefined && success !== ""
            ? success === "true"
            : undefined,
        startDate,
        endDate,
      };

      res.setHeader(
        "Content-Type",
        format === "csv" ? "text/csv; charset=utf-8" : "application/x-ndjson",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${exportFilename(format, new Date())}"`,
      );

      // Streamed in batches: an export is unbounded by definition, and the
      // whole point is to move data out before retention drops it.
      const BATCH = 500;
      let offset = 0;
      let exported = 0;

      for (;;) {
        const rows = await createCurrentAuditLogRepository().listForExport({
          filters,
          limit: BATCH,
          offset,
        });
        if (rows.length === 0) break;

        if (format === "csv") {
          // Header only on the first batch.
          const chunk = toCsv(rows);
          res.write(
            offset === 0 ? chunk : chunk.slice(chunk.indexOf("\n") + 1),
          );
        } else {
          res.write(toNdjson(rows));
        }

        exported += rows.length;
        offset += rows.length;
        if (rows.length < BATCH) break;
      }

      res.end();

      // Reading the whole trail is itself worth recording.
      const { ipAddress, userAgent } = getRequestMeta(req);
      void logAudit({
        userId: authReq.userId!,
        username: await getAuditUsername(authReq.userId!),
        action: "export_audit_logs",
        resourceType: "audit_log",
        details: JSON.stringify({ format, exported, filters }),
        ipAddress,
        userAgent,
        success: true,
      });
    } catch (err) {
      apiLogger.error("Failed to export audit logs", err);
      if (!res.headersSent) {
        return res.status(500).json({ error: "Failed to export audit logs" });
      }
      res.end();
    }
  });
}
