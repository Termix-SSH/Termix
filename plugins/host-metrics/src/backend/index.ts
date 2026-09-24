import type { Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { createLogger } from "./log.js";
import { createHostMetricsRepository } from "./repository.js";
import { createMetricsState } from "./state.js";
import { MetricsSessions } from "./sessions.js";
import { CollectorRegistry } from "./collectors.js";
import { MetricsPoller, TOPIC_HEALTH_CHECK } from "./poller.js";
import { registerRoutes } from "./routes.js";
import { hostImportNormalizer } from "./host-import.js";
import { newSessionId, supportsMetrics } from "./helpers.js";

export type { MetricsCollectorV1 } from "./collectors.js";
export type { CollectionStatusPayload, SnapshotPayload } from "./poller.js";

/** The "host-metrics.viewers" service, version 1. Runs as the caller's user. */
export interface MetricsViewersV1 {
  register: (
    hostId: number,
  ) => Promise<{ viewerSessionId: string } | { skipped: true; reason: string }>;
  heartbeat: (viewerSessionId: string) => boolean;
  unregister: (hostId: number, viewerSessionId: string) => void;
}

export async function activate(ctx: PluginContext) {
  const log = createLogger(ctx.log);
  const repository = await createHostMetricsRepository(ctx.db);
  const state = createMetricsState();
  const sessions = new MetricsSessions(ctx.schedule, log);
  const collectors = new CollectorRegistry(ctx.services, log);
  const poller = new MetricsPoller({
    ctx,
    log,
    repository,
    ssh: ctx.ssh,
    state,
    sessions,
    collectors,
  });
  ctx.disposables.add(() => {
    poller.dispose();
    sessions.dispose();
  });

  registerRoutes(ctx.http.router<Router>(), {
    ctx,
    log,
    poller,
    sessions,
    repository,
    onHealthCheck: (event) => ctx.events.emit(TOPIC_HEALTH_CHECK, event),
  });

  ctx.schedule.every(60_000, () => poller.cleanupInactiveViewers());
  ctx.schedule.every(10 * 60_000, () => {
    state.authFailures.cleanup();
    state.backoff.cleanup();
  });

  ctx.events.on("host.updated", (payload) => {
    const { hostId } = payload as { hostId?: number };
    if (hostId) void poller.hostUpdated(hostId);
  });
  ctx.events.on("host.deleted", (payload) => {
    const { hostId } = payload as { hostId?: number };
    if (hostId) poller.hostDeleted(hostId);
  });
  ctx.events.on("host.status", (payload) => {
    const { hostId, status } = payload as { hostId?: number; status?: string };
    if (hostId && status) poller.hostStatusChanged(hostId, status);
  });
  ctx.events.on("host.key.updated", (payload) => {
    const { hostId } = payload as { hostId?: number };
    if (hostId) poller.hostKeyAccepted(hostId);
  });
  ctx.settings.onChange("metricsInterval", () => void poller.retimeAll());

  ctx.services.provide<MetricsViewersV1>("host-metrics.viewers", {
    register: async (hostId) => {
      const userId = ctx.currentActor();
      if (!userId) return { skipped: true, reason: "no_user" };
      const host = await poller.resolve(hostId, userId);
      if (!host) return { skipped: true, reason: "host_not_found" };
      if (!supportsMetrics(host, ctx.ssh)) {
        return { skipped: true, reason: "metrics_unsupported" };
      }
      if (!(await poller.settingsFor(hostId)).metricsEnabled) {
        return { skipped: true, reason: "metrics_disabled" };
      }
      const viewerSessionId = newSessionId("service");
      poller.registerViewer(hostId, viewerSessionId, userId);
      return { viewerSessionId };
    },
    heartbeat: (viewerSessionId) =>
      poller.updateHeartbeat(viewerSessionId, ctx.currentActor()),
    unregister: (hostId, viewerSessionId) =>
      poller.unregisterViewer(hostId, viewerSessionId, ctx.currentActor()),
  });

  ctx.registry.provide(
    "host-metrics.hostImportNormalizer",
    hostImportNormalizer,
  );

  ctx.log.info("Host Metrics mounted at /plugin-api/host-metrics");
}

export async function deactivate() {}
