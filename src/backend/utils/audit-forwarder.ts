import { safeOutboundFetch } from "./safe-outbound-fetch.js";
import { databaseLogger } from "./logger.js";
import type { AuditLogParams } from "./audit-logger.js";

export const AUDIT_FORWARD_URL_ENV = "AUDIT_LOG_FORWARD_URL";
export const AUDIT_FORWARD_TOKEN_ENV = "AUDIT_LOG_FORWARD_TOKEN";

/**
 * How many consecutive failures before the forwarder stops complaining on every
 * entry. It keeps trying — this only throttles the log noise, and it reports
 * again once delivery recovers.
 */
const QUIET_AFTER_FAILURES = 5;

let consecutiveFailures = 0;
let quietened = false;

export interface AuditForwardTarget {
  url: string;
  token?: string;
}

export function auditForwardTarget(
  env: NodeJS.ProcessEnv = process.env,
): AuditForwardTarget | null {
  const url = env[AUDIT_FORWARD_URL_ENV]?.trim();
  if (!url) return null;
  const token = env[AUDIT_FORWARD_TOKEN_ENV]?.trim();
  return token ? { url, token } : { url };
}

/** The wire shape: one JSON object per entry, matching the export's NDJSON. */
export function forwardPayload(
  entry: AuditLogParams,
  now: Date,
): Record<string, unknown> {
  return {
    timestamp: now.toISOString(),
    userId: entry.userId,
    username: entry.username,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId ?? null,
    resourceName: entry.resourceName ?? null,
    success: entry.success,
    ipAddress: entry.ipAddress ?? null,
    userAgent: entry.userAgent ?? null,
    errorMessage: entry.errorMessage ?? null,
    details: entry.details ?? null,
  };
}

/** Exposed for tests; forwarding state is process-wide otherwise. */
export function resetAuditForwarderState(): void {
  consecutiveFailures = 0;
  quietened = false;
}

/**
 * Ships one entry to the configured collector.
 *
 * Never throws and never blocks the audited operation: a SIEM being unreachable
 * must not stop Termix from recording locally, which stays the source of truth.
 * Delivery goes through safeOutboundFetch so a misconfigured URL cannot be used
 * to probe the internal network.
 */
export async function forwardAuditEntry(
  entry: AuditLogParams,
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const target = auditForwardTarget(env);
  if (!target) return false;

  try {
    const response = await safeOutboundFetch(target.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-ndjson",
        ...(target.token ? { Authorization: `Bearer ${target.token}` } : {}),
      },
      body: `${JSON.stringify(forwardPayload(entry, now))}\n`,
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      noteFailure(`collector returned ${response.status}`, entry.action);
      return false;
    }

    noteSuccess();
    return true;
  } catch (error) {
    noteFailure(
      error instanceof Error ? error.message : String(error),
      entry.action,
    );
    return false;
  }
}

function noteFailure(reason: string, action: string): void {
  consecutiveFailures++;

  if (quietened) return;

  databaseLogger.warn("Failed to forward audit entry", {
    operation: "audit_forward_failed",
    action,
    reason,
    consecutiveFailures,
  });

  if (consecutiveFailures >= QUIET_AFTER_FAILURES) {
    quietened = true;
    databaseLogger.warn(
      `Audit forwarding has failed ${consecutiveFailures} times; suppressing further messages until it recovers`,
      { operation: "audit_forward_suppressed" },
    );
  }
}

function noteSuccess(): void {
  if (quietened) {
    databaseLogger.info("Audit forwarding recovered", {
      operation: "audit_forward_recovered",
      afterFailures: consecutiveFailures,
    });
  }
  consecutiveFailures = 0;
  quietened = false;
}
