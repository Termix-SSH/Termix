/**
 * ctx.audit.subscribe, list and exportBatches: reading the audit trail,
 * behind audit:read. Writing lines (record) stays in ctx.ts.
 */

import type {
  PluginAudit,
  PluginAuditEntry,
  PluginAuditFilters,
} from "@termix-ssh/plugin-sdk/backend";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import { assertCapability, capabilityRefused } from "./permissions.js";
import type { DisposableBag } from "./disposables.js";
import { onAuditEntry } from "../utils/audit-hooks.js";
import type { AuditLogRecord } from "../database/repositories/audit-log-repository.js";

type AuditFn = (
  action: string,
  details: string,
  outcome: { success: boolean; errorMessage?: string },
) => Promise<void>;

interface Deps {
  manifest: PluginManifest;
  bag: DisposableBag;
  audit: AuditFn;
}

const MAX_PAGE = 200;
const MAX_BATCH = 1000;

function toEntry(row: AuditLogRecord): PluginAuditEntry {
  return {
    id: row.id,
    timestamp: new Date(
      row.timestamp as unknown as string | number,
    ).toISOString(),
    userId: row.userId ?? null,
    username: row.username,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId ?? null,
    resourceName: row.resourceName ?? null,
    details: row.details ?? null,
    ipAddress: row.ipAddress ?? null,
    userAgent: row.userAgent ?? null,
    success: Boolean(row.success),
    errorMessage: row.errorMessage ?? null,
  };
}

export function createPluginAuditReader(
  deps: Deps,
): Pick<PluginAudit, "subscribe" | "list" | "exportBatches"> {
  const { manifest, bag, audit } = deps;
  const require = (action: string) =>
    assertCapability(manifest.id, "audit:read", manifest.capabilities, action);

  return {
    subscribe: (handler) => {
      if (!manifest.capabilities.includes("audit:read")) {
        throw capabilityRefused(manifest.id, "audit:read", "audit_subscribe");
      }
      let remove: (() => void) | null = null;
      let forgetBag: (() => void) | null = null;
      // Granted state is checked once, then every line is delivered until
      // unsubscribed; a revoked grant stops the next subscribe.
      void require("audit_subscribe")
        .then(async () => {
          await audit("audit_subscribe", "listened to the audit log", {
            success: true,
          });
          remove = onAuditEntry((entry) => {
            handler({
              timestamp: entry.timestamp.toISOString(),
              userId: entry.userId,
              username: entry.username,
              action: entry.action,
              resourceType: entry.resourceType,
              resourceId: entry.resourceId ?? null,
              resourceName: entry.resourceName ?? null,
              details: entry.details ?? null,
              ipAddress: entry.ipAddress ?? null,
              userAgent: entry.userAgent ?? null,
              success: entry.success,
              errorMessage: entry.errorMessage ?? null,
            });
          });
        })
        .catch(() => {});
      forgetBag = bag.add(() => remove?.(), "audit subscription");
      return () => {
        remove?.();
        remove = null;
        forgetBag?.();
      };
    },

    list: async (options) => {
      await require("audit_list");
      const { createCurrentAuditLogRepository } =
        await import("../database/repositories/factory.js");
      const limit = Math.min(MAX_PAGE, Math.max(1, options?.limit ?? 50));
      const page = await createCurrentAuditLogRepository().listPage({
        filters: options?.filters ?? {},
        limit,
        offset: Math.max(0, options?.offset ?? 0),
      });
      await audit("audit_list", "read audit log entries", { success: true });
      return { entries: page.logs.map(toEntry), total: page.total };
    },

    exportBatches: async function* (
      filters?: PluginAuditFilters,
      batchSize?: number,
    ) {
      await require("audit_export");
      const { createCurrentAuditLogRepository } =
        await import("../database/repositories/factory.js");
      const limit = Math.min(MAX_BATCH, Math.max(1, batchSize ?? 500));
      let offset = 0;
      let exported = 0;
      try {
        for (;;) {
          const rows = await createCurrentAuditLogRepository().listForExport({
            filters: filters ?? {},
            limit,
            offset,
          });
          if (rows.length === 0) break;
          exported += rows.length;
          offset += rows.length;
          yield rows.map(toEntry);
          if (rows.length < limit) break;
        }
      } finally {
        await audit("audit_export", `exported ${exported} audit log entries`, {
          success: true,
        });
      }
    },
  };
}
