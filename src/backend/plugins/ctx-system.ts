/**
 * ctx.system: the server certificate. Core serves it; a plugin under
 * system:tls may replace it, reload it, answer ACME http-01 challenges and
 * say that it renews it. Every call is audited.
 */

import type { PluginSystem } from "@termix/plugin-sdk/backend";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import { assertCapability } from "./permissions.js";
import type { DisposableBag } from "./disposables.js";

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

const CAPABILITY = "system:tls";

async function audited<T>(
  deps: Deps,
  action: string,
  details: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    await assertCapability(
      deps.manifest.id,
      CAPABILITY,
      deps.manifest.capabilities,
    );
    const result = await fn();
    await deps.audit(action, details, { success: true });
    return result;
  } catch (error) {
    await deps.audit(action, details, {
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Puts an undo in the plugin's bag and hands back one that also takes it out
 * again, so it runs once whether the plugin or deactivate gets there first.
 */
function tracked(deps: Deps, undo: () => void, label: string): () => void {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    undo();
  };
  const untrack = deps.bag.add(run, label);
  return () => {
    untrack();
    run();
  };
}

export function createPluginSystem(deps: Deps): PluginSystem {
  return {
    tlsStatus: () =>
      audited(deps, "tls_status", "read certificate status", async () => {
        const { getTlsStatus } = await import("../tls/tls-service.js");
        return getTlsStatus();
      }),

    writeTlsCertificate: (certificatePem, privateKeyPem) =>
      audited(
        deps,
        "tls_write",
        "replaced the server certificate",
        async () => {
          const { writeTlsCertificate } = await import("../tls/tls-service.js");
          return writeTlsCertificate(certificatePem, privateKeyPem);
        },
      ),

    reloadTls: () =>
      audited(
        deps,
        "tls_reload",
        "reloaded the server certificate",
        async () => {
          const { reloadTls } = await import("../tls/tls-service.js");
          return reloadTls();
        },
      ),

    publishHttpChallenge: (token, content) =>
      audited(
        deps,
        "tls_challenge",
        "published an ACME challenge",
        async () => {
          const { publishChallenge } =
            await import("../tls/acme-challenges.js");
          return tracked(
            deps,
            publishChallenge(token, content),
            "acme challenge",
          );
        },
      ),

    registerTlsRenewer: () =>
      audited(
        deps,
        "tls_renewer",
        "renews the server certificate",
        async () => {
          const { registerTlsRenewer } = await import("../tls/tls-service.js");
          const undo = registerTlsRenewer({
            pluginId: deps.manifest.id,
            pluginName: deps.manifest.name,
          });
          return tracked(deps, undo, "tls renewer");
        },
      ),
  };
}
