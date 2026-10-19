/**
 * ctx.hosts.importMany, importSshConfig, exportMany and registerImportNormalizer.
 *
 * The import and export logic is the same code the host routes run
 * (hosts/import/), so a plugin gets the same validation, defaults, protocol
 * logins and plugin settings. What this file adds is the capability checks,
 * the core permission checks, one batched save and the audit lines.
 */

import type {
  PluginHostExport,
  PluginHostImportNormalizer,
  PluginHostImportOptions,
  PluginHostImportResult,
  PluginHosts,
} from "@termix-ssh/plugin-sdk/backend";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import { assertCapability, capabilityRefused } from "./permissions.js";
import { getActor } from "./actor.js";
import * as registry from "./registry.js";
import type { DisposableBag } from "./disposables.js";
import { DatabaseSaveTrigger } from "../utils/database-save-trigger.js";
import { PermissionManager } from "../utils/permission-manager.js";

type AuditFn = (
  action: string,
  details: string,
  outcome: { success: boolean; errorMessage?: string },
) => Promise<void>;

interface Deps {
  manifest: PluginManifest;
  bag?: DisposableBag;
  audit: AuditFn;
}

type ImportApi = Pick<
  PluginHosts,
  "importMany" | "importSshConfig" | "exportMany" | "registerImportNormalizer"
>;

function actingUser(): string {
  const actor = getActor();
  if (!actor) throw new Error("This call needs an acting user");
  return actor;
}

async function requirePermissions(userId: string, names: string[]) {
  const permissions = PermissionManager.getInstance();
  for (const name of names) {
    if (!(await permissions.hasPermission(userId, name))) {
      throw new Error(`The acting user lacks the ${name} permission`);
    }
  }
}

function toResult(
  results: Awaited<
    ReturnType<typeof import("../hosts/import/host-import.js").runBulkImport>
  >,
): PluginHostImportResult {
  return {
    success: results.success,
    updated: results.updated,
    skipped: results.skipped,
    failed: results.failed,
    errors: results.errors,
    createdHostIds: results.createdHostIds,
    ...(results.rolledBack ? { rolledBack: true } : {}),
  };
}

export function createPluginHostImport({
  manifest,
  bag,
  audit,
}: Deps): ImportApi {
  const pluginId = manifest.id;
  const declared = manifest.capabilities;

  const runImport = async (
    action: string,
    run: (userId: string) => Promise<PluginHostImportResult>,
    needsCredentials: boolean,
  ): Promise<PluginHostImportResult> => {
    try {
      await assertCapability(pluginId, "hosts:write", declared, action);
      if (needsCredentials) {
        await assertCapability(pluginId, "credentials:write", declared, action);
      }
      const userId = actingUser();
      await requirePermissions(userId, ["hosts.create", "hosts.edit"]);

      const result = await DatabaseSaveTrigger.batched(() => run(userId))();
      await audit(
        action,
        `${result.success} created, ${result.updated} updated, ${result.skipped} skipped, ${result.failed} failed`,
        { success: true },
      );
      return result;
    } catch (error) {
      await audit(action, "host import", {
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  return {
    importMany: (hosts, options?: PluginHostImportOptions) =>
      runImport(
        "hosts_import",
        async (userId) => {
          const { runBulkImport } =
            await import("../hosts/import/host-import.js");
          return toResult(
            await runBulkImport(userId, {
              hosts,
              overwrite: options?.overwrite,
              credentials: options?.credentials,
              atomic: options?.atomic,
            }),
          );
        },
        Array.isArray(options?.credentials) && options.credentials.length > 0,
      ),

    importSshConfig: (content, options) =>
      runImport(
        "hosts_import_ssh_config",
        async (userId) => {
          const { runSshConfigImport } =
            await import("../hosts/import/host-import.js");
          return toResult(
            await runSshConfigImport(userId, {
              content,
              overwrite: options?.overwrite,
              atomic: options?.atomic,
            }),
          );
        },
        false,
      ),

    exportMany: async (options): Promise<PluginHostExport> => {
      const share = options?.share === true;
      try {
        await assertCapability(
          pluginId,
          "hosts:export",
          declared,
          "hosts_export",
        );
        const userId = actingUser();
        const { exportAllHosts } =
          await import("../hosts/import/host-export.js");
        const exported = await exportAllHosts(userId, share, options?.hostIds);
        await audit(
          "export_hosts",
          `exported ${exported.hosts.length} hosts${share ? " without secrets" : " with secrets"}`,
          { success: true },
        );
        return exported;
      } catch (error) {
        await audit("export_hosts", share ? "share export" : "full export", {
          success: false,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },

    registerImportNormalizer: (normalizer: PluginHostImportNormalizer) => {
      if (!declared.includes("hosts:write")) {
        throw capabilityRefused(pluginId, "hosts:write");
      }
      // Same key the import path has always read, so the older
      // ctx.registry.provide form keeps working.
      const key = `${pluginId}.hostImportNormalizer`;
      registry.provide(key, normalizer);
      const remove = () => {
        registry.revoke(key, normalizer);
      };
      const drop = bag?.add(remove, "host import normalizer");
      return () => {
        drop?.();
        remove();
      };
    },
  };
}
