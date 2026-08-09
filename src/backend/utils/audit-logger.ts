import type { Request } from "express";
import { forwardAuditEntry } from "./audit-forwarder.js";
import {
  createCurrentAuditLogRepository,
  createCurrentUserRepository,
} from "../database/repositories/factory.js";
import { getClientIp } from "./request-origin.js";

/**
 * Resolves the display name to store alongside the entry. It is denormalised on
 * purpose: the record has to stay readable after the account is gone.
 */
export async function getAuditUsername(userId: string): Promise<string> {
  try {
    const actor = await createCurrentUserRepository().findById(userId);
    return actor?.username ?? userId;
  } catch {
    return userId;
  }
}

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
  // Local storage is the source of truth and runs first; forwarding is a copy
  // and must never delay or fail the audited operation.
  void forwardAuditEntry(params).catch(() => {});

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
  const userAgent = (req.headers["user-agent"] as string) || "";
  return { ipAddress: getClientIp(req), userAgent };
}
