import type { Request } from "express";
import { db } from "../database/db/index.js";
import { auditLogs } from "../database/db/schema.js";

const PRUNE_MAX = 10000;
const PRUNE_TARGET = 9000;

export interface AuditLogParams {
  userId: string;
  username: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  resourceName?: string;
  details?: string;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  errorMessage?: string;
}

export async function logAudit(params: AuditLogParams): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      userId: params.userId,
      username: params.username,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId ?? null,
      resourceName: params.resourceName ?? null,
      details: params.details ?? null,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
      success: params.success,
      errorMessage: params.errorMessage ?? null,
    });

    const countResult = db.$client
      .prepare("SELECT COUNT(*) as count FROM audit_logs")
      .get() as { count: number };

    if (countResult.count >= PRUNE_MAX) {
      const deleteCount = countResult.count - PRUNE_TARGET;
      db.$client
        .prepare(
          `DELETE FROM audit_logs WHERE id IN (
            SELECT id FROM audit_logs ORDER BY timestamp ASC LIMIT ?
          )`,
        )
        .run(deleteCount);
    }
  } catch {
    // audit logging must never throw and break the caller
  }
}

export function getRequestMeta(req: Request): {
  ipAddress: string;
  userAgent: string;
} {
  const forwarded = req.headers["x-forwarded-for"];
  const ipAddress =
    (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0]) ||
    req.ip ||
    "";
  const userAgent = (req.headers["user-agent"] as string) || "";
  return { ipAddress, userAgent };
}
