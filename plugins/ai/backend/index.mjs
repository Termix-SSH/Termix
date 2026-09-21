/**
 * AI Assistant - first-party, in-process plugin.
 *
 * This plugin runs on the main thread rather than in a worker for the same
 * reason ssh-terminal, docker and host-metrics do (see
 * src/backend/plugins/first-party.ts): it writes directly across hosts,
 * snippets, fleets, alert rules and automations through their repositories,
 * runs approved commands over the shared SSH pool via resolveHostById and
 * withConnection, and streams its chat replies as server-sent events. None
 * of that fits the worker ctx -- ctx.hosts is a 13-field read-only view with
 * no write methods and no snippets/fleets/alerts/automations surface at all,
 * and ctx.http.route replies with a single postMessage value rather than a
 * stream.
 *
 * Unlike ssh-terminal/docker/host-metrics, this plugin does not own a live
 * transport (no WebSocket server, no long-lived connection that must outlive
 * the main server's route table), so it does not get its own port. Instead
 * it registers its Express router with the always-mounted /ai dispatcher in
 * src/backend/database/routes/ai-dispatch.ts, the same "register a router,
 * a small dispatcher forwards to it" shape /plugin-api uses for worker
 * plugins, just scoped to this one path so /ai/* keeps its existing routes
 * instead of moving under /plugin-api/ai/.
 *
 * routes.ts is what used to be src/backend/ai/index.ts, moved here with its
 * sibling modules (context.ts, egress.ts, engine.ts, gating.ts, redaction.ts,
 * providers/, tools/) and rewritten from `export default router` into
 * startAiService()/stopAiService(), called from activate()/deactivate()
 * below.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Loads a module by its path relative to this file's own directory.
 *
 * The plugin ships beside dist/backend, so in a built server the compiled
 * .js for the moved AI files (routes.js, ...) sits right next to this .mjs,
 * and core modules resolve via ../../../backend/backend/... from there
 * (dist/plugins/ai/backend -> dist/backend/backend). Under vitest/dev nothing
 * imports this plugin directly (the loader loads in-process plugins with a
 * plain dynamic import, no tsx loader involved), so the only layout that
 * needs to resolve here is the built one.
 */
async function loadRelative(relativePath) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const target = path.join(here, `${relativePath}.js`);
  return import(new URL(`file://${target.replace(/\\/g, "/")}`).href);
}

let routesModule = null;

export async function activate(ctx) {
  routesModule = await loadRelative("routes");
  routesModule.startAiService();

  ctx.log.info("AI assistant router registered at /ai");
}

export async function deactivate() {
  if (routesModule) {
    routesModule.stopAiService();
    routesModule = null;
  }
}
