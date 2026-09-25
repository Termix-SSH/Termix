import type { Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { issueCertificate } from "./acme.js";
import {
  CHECK_INTERVAL_MS,
  createAcmeRunner,
  watchSettings,
  type IssueFn,
} from "./runner.js";
import { registerRoutes } from "./routes.js";

/** `issue` is swapped out by tests; the plugin always uses acme-client. */
export async function activateWith(ctx: PluginContext, issue: IssueFn) {
  const runner = createAcmeRunner(ctx, issue);

  await runner.syncRenewer();
  watchSettings(ctx, () => {
    runner
      .syncRenewer()
      .catch((error) =>
        ctx.log.warn(
          `Could not update the renewal registration: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
  });

  // The first check lands within a minute of boot, after core's boot-time
  // settings migrations, so it also picks up settings moved from 2.8.
  ctx.schedule.every(
    CHECK_INTERVAL_MS,
    async () => {
      await runner.syncRenewer();
      await runner.check();
    },
    { jitterMs: 60_000 },
  );

  registerRoutes(ctx, ctx.http.router<Router>(), runner);
  return runner;
}

export async function activate(ctx: PluginContext) {
  await activateWith(ctx, (pluginCtx, settings) =>
    issueCertificate(pluginCtx, settings),
  );
}

export async function deactivate() {
  // Everything above was registered through ctx and is disposed by core.
}
