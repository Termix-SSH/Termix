/**
 * Automations - first-party, in-process plugin.
 *
 * This plugin runs on the main thread rather than in a worker for the same
 * reason ai and fleets do (see src/backend/plugins/first-party.ts): its
 * engine and scheduler write across hosts, snippets, fleets, and
 * notification-channel repositories through the shared SSH pool via
 * resolveHostById and withConnection, and its scheduler needs direct
 * repository access plus event-bus subscription that the worker ctx's
 * read-only ctx.hosts and single-postMessage ctx.http.route cannot support.
 *
 * Like fleets, this plugin does not own a live transport (no WebSocket
 * server, no dedicated port), so it registers its Express router with the
 * always-mounted /automations dispatcher in
 * src/backend/database/routes/automation-dispatch.ts instead of getting its
 * own port.
 *
 * routes.ts is what used to be src/backend/database/routes/automations.ts,
 * moved here and rewritten from `export default router` into
 * startAutomationsService()/stopAutomationsService(), called from
 * activate()/deactivate() below. scheduler.ts owns the one setInterval the
 * feature has always used for due schedules, dwell rechecks, docker-event
 * polling and history pruning -- there is no ctx.schedule API for an
 * in-process plugin, so it starts and stops the same way it always has. The
 * automations/automationTriggerState/automationSchedules/automationRuns/
 * automationRunSteps/automationChannels tables and their repository stay in
 * core (src/backend/database/db/schema.ts,
 * src/backend/database/repositories/automation-repository.ts) -- this plugin
 * system has no owned-table migration mechanism of its own, and these tables
 * carry FKs into core's hosts/users tables.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Loads a module by its path relative to this file's own directory.
 *
 * The plugin ships beside dist/backend, so in a built server the compiled
 * .js for routes.js/scheduler.js sits right next to this .mjs, and core
 * modules resolve via ../../../src/backend/... from there. Under
 * vitest/dev nothing imports this plugin directly (the loader loads
 * in-process plugins with a plain dynamic import, no tsx loader involved),
 * so the only layout that needs to resolve here is the built one.
 */
async function loadRelative(relativePath) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const target = path.join(here, `${relativePath}.js`);
  return import(new URL(`file://${target.replace(/\\/g, "/")}`).href);
}

let routesModule = null;
let schedulerModule = null;

export async function activate(ctx) {
  routesModule = await loadRelative("routes");
  routesModule.startAutomationsService();

  schedulerModule = await loadRelative("scheduler");
  schedulerModule.startAutomationScheduler();

  ctx.log.info(
    "Automations router registered at /automations; scheduler started",
  );
}

export async function deactivate() {
  if (schedulerModule) {
    schedulerModule.stopAutomationScheduler();
    schedulerModule = null;
  }
  if (routesModule) {
    routesModule.stopAutomationsService();
    routesModule = null;
  }
}
