import type { Request } from "express";
import { createCurrentAuditLogRepository } from "../database/repositories/current-audit-log-repository.js";

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
    await createCurrentAuditLogRepository().create({
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
