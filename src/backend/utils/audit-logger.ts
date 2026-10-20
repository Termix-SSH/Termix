import type { Request } from "express";
import { emitAuditEntry } from "./audit-hooks.js";
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
  // Null when no user acted (a plugin starting up, background work): the
  // column references users.id, so anything else would be refused.
  userId: string | null;
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

// Plugin routine calls (a headless viewer's heartbeat through ctx.asUser and a
// service) repeat identically every few seconds; written each time they push
// real security entries out of the capped log. Only successful plugin_as_user
// and plugin_service_* lines are coalesced; failures and everything else are
// always written.
const ROUTINE_COALESCE_MS = 10 * 60 * 1000;
const ROUTINE_COALESCE_MAX_KEYS = 5000;
const routineLastWritten = new Map<string, number>();

function isCoalescedRoutine(params: AuditLogParams): boolean {
  if (
    !params.success ||
    !params.username.startsWith("plugin:") ||
    !(
      params.action === "plugin_as_user" ||
      params.action.startsWith("plugin_service_")
    )
  ) {
    return false;
  }
  const key = JSON.stringify([
    params.userId,
    params.username,
    params.action,
    params.resourceType,
    params.resourceId,
    params.details,
  ]);
  const now = Date.now();
  const last = routineLastWritten.get(key);
  if (last !== undefined && now - last < ROUTINE_COALESCE_MS) return true;
  if (routineLastWritten.size >= ROUTINE_COALESCE_MAX_KEYS) {
    for (const [k, at] of routineLastWritten) {
      if (now - at >= ROUTINE_COALESCE_MS) routineLastWritten.delete(k);
    }
  }
  routineLastWritten.set(key, now);
  return false;
}

export async function logAudit(params: AuditLogParams): Promise<void> {
  if (isCoalescedRoutine(params)) return;

  // Hooks (plugins copying the log elsewhere) never delay or fail the
  // audited operation.
  emitAuditEntry(params);

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
