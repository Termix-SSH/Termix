import crypto from "crypto";

/** prev_hash of the first row in a chain. */
export const AUDIT_CHAIN_GENESIS = "0".repeat(64);

/** Settings row holding the newest row's id and hash. Also the write lock. */
export const AUDIT_CHAIN_HEAD_KEY = "audit_chain_head";

/** Settings row holding the last pruned row's id and hash. */
export const AUDIT_CHAIN_ANCHOR_KEY = "audit_chain_anchor";

export interface AuditChainPoint {
  id: number;
  hash: string;
  timestamp?: string;
}

export interface AuditHashFields {
  username: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  resourceName?: string | null;
  details?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  success: boolean | number;
  errorMessage?: string | null;
  timestamp: string;
}

/**
 * user_id is left out on purpose: deleting an account sets it to null and
 * that must not look like tampering. username keeps the row attributable.
 */
export function auditRowHash(prevHash: string, row: AuditHashFields): string {
  const body = JSON.stringify([
    row.username,
    row.action,
    row.resourceType,
    row.resourceId ?? null,
    row.resourceName ?? null,
    row.details ?? null,
    row.ipAddress ?? null,
    row.userAgent ?? null,
    row.success ? 1 : 0,
    row.errorMessage ?? null,
    String(row.timestamp),
  ]);
  return crypto
    .createHash("sha256")
    .update(`${prevHash}\n${body}`)
    .digest("hex");
}

export function parseChainPoint(
  raw: string | null | undefined,
): AuditChainPoint | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<AuditChainPoint>;
    if (
      typeof value.id === "number" &&
      typeof value.hash === "string" &&
      /^[0-9a-f]{64}$/.test(value.hash)
    ) {
      return {
        id: value.id,
        hash: value.hash,
        ...(typeof value.timestamp === "string"
          ? { timestamp: value.timestamp }
          : {}),
      };
    }
  } catch {
    // unreadable counts as missing
  }
  return null;
}
