import type { Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { createDeps } from "./deps.js";
import { createDockerWatcher } from "./docker-watcher.js";
import { AutomationEngine } from "./engine.js";
import { createHeadlessViewers } from "./headless-viewer.js";
import { createAutomationRepository } from "./repository.js";
import { registerRoutes } from "./routes.js";
import { createScheduler, STARTUP_DELAY_MS, TICK_MS } from "./scheduler.js";
import { createAutomationsService } from "./service.js";
import { createTriggers } from "./triggers.js";

export type { AutomationsAccessV1, AutomationSummary } from "./service.js";

export async function activate(ctx: PluginContext) {
  const repository = await createAutomationRepository(ctx.db, async () => {
    const channels = await ctx.notify.channels();
    return channels.map((channel) => channel.id);
  });
  const deps = createDeps(ctx.services);
  const engine = new AutomationEngine(ctx, repository, deps);
  const triggers = createTriggers(repository, engine, ctx.log);
  triggers.subscribe(ctx.events);

  const viewers = createHeadlessViewers(ctx, deps, () =>
    triggers.watchedHosts("metric_threshold"),
  );
  const docker = createDockerWatcher(
    ctx,
    deps,
    () => triggers.watchedHosts("docker_event"),
    triggers.onDockerEvent,
  );
  ctx.disposables.add(() => {
    docker.reset();
    void viewers.releaseAll();
  });

  const scheduler = createScheduler({
    repository,
    engine,
    log: ctx.log,
    reconcile: [() => viewers.reconcile(), (now) => docker.reconcile(now)],
  });
  ctx.schedule.after(STARTUP_DELAY_MS, () => scheduler.tick());
  ctx.schedule.every(TICK_MS, () => scheduler.tick());

  registerRoutes(
    // The webhook route authenticates on its own per-automation token rather
    // than a session, which is the point of an inbound webhook.
    ctx.http.router<Router>({ public: ["/webhook/:token"] }),
    { ctx, repository, engine, deps },
  );

  ctx.services.provide(
    "automations.access",
    createAutomationsService(ctx, repository, engine, deps),
  );
}

export async function deactivate() {}
