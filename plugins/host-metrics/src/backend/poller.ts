import type {
  PluginContext,
  PluginHostStatusEntry,
} from "@termix/plugin-sdk/backend";
import { readHostMetricsSettings } from "../shared/stats-widgets.js";
import {
  collectMetrics,
  isHostKeyVerificationError,
  type CollectDeps,
  type CollectedMetrics,
} from "./collect.js";
import { supportsMetrics, type MetricsHost } from "./helpers.js";
import type { MetricsLogger } from "./log.js";
import type { HostMetricsRepository } from "./repository.js";
import type { MetricsViewer } from "./sessions.js";
import {
  canStartInitialMetrics,
  metricsConcurrencyFor,
  type MetricsState,
} from "./state.js";

export const DEFAULT_METRICS_INTERVAL = 30;
export const DEFAULT_RETENTION_DAYS = 7;
/** Viewers that stop sending heartbeats are dropped after this long. */
const VIEWER_TIMEOUT_MS = 120_000;

export const TOPIC_SNAPSHOT = "plugin.host-metrics.snapshot";
export const TOPIC_STATUS = "plugin.host-metrics.status";
export const TOPIC_HEALTH_CHECK = "plugin.host-metrics.health-check";

/** Where collection stands for a host, sent when it changes. */
export type CollectionState =
  "collecting" | "auth_failed" | "host_key_changed" | "unreachable";

export interface SnapshotPayload {
  hostId: number;
  ownerUserId: string;
  metrics: CollectedMetrics;
}

export interface CollectionStatusPayload {
  hostId: number;
  ownerUserId: string;
  state: CollectionState;
  previous: CollectionState | null;
}

interface Polled {
  host: MetricsHost;
  viewerUserId: string;
  stop: () => void;
}

export interface PollerDeps extends CollectDeps {
  ctx: PluginContext;
  log: MetricsLogger;
  repository: HostMetricsRepository;
}

/**
 * Heavy SSH metrics for hosts somebody is looking at. Polling starts with the
 * first viewer and stops with the last one; a viewer is a tab, a dashboard
 * card, or another plugin through the "host-metrics.viewers" service.
 */
export class MetricsPoller {
  private readonly polled = new Map<number, Polled>();
  private readonly metrics = new Map<
    number,
    { data: CollectedMetrics; timestamp: number }
  >();
  private readonly viewers = new Map<number, Set<string>>();
  private readonly viewerDetails = new Map<string, MetricsViewer>();
  private readonly inFlight = new Set<number>();
  private readonly initialRequested = new Set<number>();
  private readonly collectionState = new Map<number, CollectionState>();

  constructor(private readonly deps: PollerDeps) {}

  private get ctx() {
    return this.deps.ctx;
  }

  private get state(): MetricsState {
    return this.deps.state;
  }

  getMetrics(hostId: number) {
    return this.metrics.get(hostId);
  }

  isPolling(hostId: number): boolean {
    return this.polled.has(hostId);
  }

  hasViewers(hostId: number): boolean {
    return (this.viewers.get(hostId)?.size ?? 0) > 0;
  }

  registerViewer(hostId: number, sessionId: string, userId: string): void {
    let set = this.viewers.get(hostId);
    if (!set) {
      set = new Set();
      this.viewers.set(hostId, set);
    }
    set.add(sessionId);
    this.viewerDetails.set(sessionId, {
      sessionId,
      userId,
      hostId,
      lastHeartbeat: Date.now(),
    });

    if (set.size === 1) {
      // Never let a failed start reach the request that registered it.
      void this.start(hostId, userId).catch((error) => {
        this.deps.log.warn("Could not start metrics polling", {
          operation: "start_metrics_unhandled",
          hostId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }

  /** False when the viewer is gone, so the caller registers again. */
  updateHeartbeat(sessionId: string, userId?: string): boolean {
    const viewer = this.viewerDetails.get(sessionId);
    if (!viewer || (userId && viewer.userId !== userId)) return false;
    viewer.lastHeartbeat = Date.now();
    return true;
  }

  unregisterViewer(hostId: number, sessionId: string, userId?: string): void {
    const viewer = this.viewerDetails.get(sessionId);
    if (viewer && userId && viewer.userId !== userId) return;
    const set = this.viewers.get(hostId);
    if (set) {
      set.delete(sessionId);
      if (set.size === 0) {
        this.viewers.delete(hostId);
        this.stop(hostId, false);
      }
    }
    this.viewerDetails.delete(sessionId);
  }

  /** Stops a host's polling without dropping its viewers. */
  pause(hostId: number): void {
    this.stop(hostId, false);
  }

  cleanupInactiveViewers(now = Date.now()): void {
    for (const [sessionId, viewer] of [...this.viewerDetails.entries()]) {
      if (now - viewer.lastHeartbeat > VIEWER_TIMEOUT_MS) {
        this.unregisterViewer(viewer.hostId, sessionId);
      }
    }
  }

  /** A host's details changed: drop what was cached and start over. */
  async hostUpdated(hostId: number): Promise<void> {
    this.state.hostCache.invalidate(hostId);
    this.state.metricsCache.clear(hostId);
    this.ctx.ssh.dropPooled("stats", hostId);
    const polled = this.polled.get(hostId);
    if (polled) await this.start(hostId, polled.viewerUserId);
  }

  hostDeleted(hostId: number): void {
    this.stop(hostId, true);
    for (const sessionId of this.viewers.get(hostId) ?? []) {
      this.viewerDetails.delete(sessionId);
    }
    this.viewers.delete(hostId);
    this.collectionState.delete(hostId);
    this.state.authFailures.reset(hostId);
    this.state.backoff.reset(hostId);
  }

  /** Core's status check says the host answers again. */
  hostStatusChanged(hostId: number, status: string): void {
    if (status === "offline") return;
    const polled = this.polled.get(hostId);
    if (polled) this.scheduleInitialPoll(polled.host);
  }

  hostKeyAccepted(hostId: number): void {
    this.state.authFailures.resetHostKeyFailure(hostId);
  }

  /** Re-times every running host, after the admin interval changed. */
  async retimeAll(): Promise<void> {
    for (const [hostId, polled] of [...this.polled.entries()]) {
      await this.start(hostId, polled.viewerUserId);
    }
  }

  dispose(): void {
    for (const hostId of [...this.polled.keys()]) this.stop(hostId, true);
    this.viewers.clear();
    this.viewerDetails.clear();
    this.state.rateSamples.clear();
  }

  /** The host as `userId` may reach it, cached for a few minutes. */
  async resolve(hostId: number, userId: string): Promise<MetricsHost | null> {
    const cached = this.state.hostCache.get(
      hostId,
      userId,
    ) as MetricsHost | null;
    if (cached) return cached;
    const host = (await this.ctx.asUser(userId, () =>
      this.ctx.ssh.resolveHost(hostId),
    )) as MetricsHost | null;
    if (!host) return null;
    this.state.hostCache.set(hostId, userId, host);
    return host;
  }

  async settingsFor(hostId: number) {
    const settings = readHostMetricsSettings(
      await this.ctx.settings.getAll("host", hostId),
    );
    const adminInterval = Number(
      await this.ctx.settings.get<number>("metricsInterval"),
    );
    return {
      ...settings,
      intervalSeconds:
        settings.metricsInterval ??
        (Number.isInteger(adminInterval) && adminInterval >= 5
          ? adminInterval
          : DEFAULT_METRICS_INTERVAL),
    };
  }

  private async start(hostId: number, userId: string): Promise<void> {
    const host = await this.resolve(hostId, userId);
    this.stop(hostId, false);
    if (!host || !supportsMetrics(host, this.ctx.ssh)) return;

    const settings = await this.settingsFor(hostId);
    if (!settings.metricsEnabled) {
      this.metrics.delete(hostId);
      return;
    }

    const intervalMs = settings.intervalSeconds * 1000;
    const stop = this.ctx.schedule.every(
      intervalMs,
      () => {
        const latest = this.polled.get(hostId);
        if (latest) this.schedulePoll(latest.host);
      },
      // Spread timers so a fleet does not fire on the same second.
      { jitterMs: Math.min(intervalMs * 0.2, 15_000) },
    );
    this.polled.set(hostId, { host, viewerUserId: userId, stop });
    this.syncConcurrency();
    this.scheduleInitialPoll(host);
  }

  private stop(hostId: number, clearData: boolean): void {
    const polled = this.polled.get(hostId);
    if (polled) {
      polled.stop();
      this.polled.delete(hostId);
      this.syncConcurrency();
    }
    this.inFlight.delete(hostId);
    if (clearData) {
      this.metrics.delete(hostId);
      this.state.hostCache.invalidate(hostId);
      this.state.rateSamples.clear(hostId);
    }
  }

  /** Keeps poll concurrency matched to how many hosts are being polled. */
  private syncConcurrency(): void {
    const target = metricsConcurrencyFor(this.polled.size);
    const limiter = this.state.metricsLimiter;
    if (target === limiter.limit) return;
    const previous = limiter.limit;
    limiter.setLimit(target);
    this.deps.log.info(
      `Metrics poll concurrency ${previous} -> ${target} for ${this.polled.size} host(s)`,
      { operation: "metrics_concurrency_resize" },
    );
  }

  /**
   * The first heavy sample waits for core's cheap status check to say the
   * host answers, so a whole fleet registering at once does not open a
   * burst of SSH connections to hosts that are down.
   */
  private scheduleInitialPoll(host: MetricsHost): void {
    if (this.metrics.has(host.id) || this.initialRequested.has(host.id)) {
      return;
    }
    this.initialRequested.add(host.id);
    void this.state.initialLimiter
      .run(async () => {
        let status: PluginHostStatusEntry | null =
          await this.ctx.hosts.status.get(host.id);
        if (!status) status = await this.ctx.hosts.status.check(host.id);
        if (!canStartInitialMetrics(status?.status, this.hasViewers(host.id))) {
          return;
        }
        if (this.inFlight.has(host.id)) return;
        this.inFlight.add(host.id);
        try {
          await this.state.metricsLimiter.run(() => this.poll(host));
        } finally {
          this.inFlight.delete(host.id);
        }
      })
      .catch((error) => {
        this.deps.log.error("Initial metrics polling failed", error, {
          operation: "initial_metrics_poll_unhandled",
          hostId: host.id,
        });
      })
      .finally(() => this.initialRequested.delete(host.id));
  }

  private schedulePoll(host: MetricsHost): void {
    if (this.inFlight.has(host.id)) return;
    this.inFlight.add(host.id);
    void this.state.metricsLimiter
      .run(() => this.poll(host))
      .catch((error) => {
        this.deps.log.error("Metrics polling failed", error, {
          operation: "metrics_poll_unhandled",
          hostId: host.id,
        });
      })
      .finally(() => this.inFlight.delete(host.id));
  }

  /** One sample for one host. Public for tests. */
  async poll(host: MetricsHost): Promise<void> {
    const { state, log } = this.deps;
    if (!this.polled.has(host.id)) return;
    if (state.authFailures.shouldSkip(host.id)) return;
    if (state.backoff.shouldSkip(host.id)) return;

    const settings = await this.settingsFor(host.id);
    if (!settings.metricsEnabled) return;

    let authenticated = false;
    try {
      const metrics = await collectMetrics(this.deps, host, settings, () => {
        authenticated = true;
      });
      this.metrics.set(host.id, { data: metrics, timestamp: Date.now() });
      this.ctx.hosts.status.reportLogin(host.id, { ok: true });
      this.setCollectionState(host, "collecting");
      await this.recordSample(host.id, metrics);
      this.ctx.events.emit(TOPIC_SNAPSHOT, {
        hostId: host.id,
        ownerUserId: host.userId,
        metrics,
      } satisfies SnapshotPayload);
      state.backoff.reset(host.id);
      state.authFailures.reset(host.id);
    } catch (error) {
      const hostKeyChanged = isHostKeyVerificationError(error);
      const message = error instanceof Error ? error.message : "";
      const isAuthError = /authentication|permission denied/i.test(message);

      if (!authenticated) {
        this.ctx.hosts.status.reportLogin(host.id, {
          ok: false,
          hostKeyChanged,
        });
      }
      this.setCollectionState(
        host,
        hostKeyChanged
          ? "host_key_changed"
          : isAuthError
            ? "auth_failed"
            : "unreachable",
      );

      if (isAuthError) {
        // collectMetrics already recorded it; log the first occurrence only.
        if (!state.authFailures.shouldSkip(host.id)) {
          log.error("Stats collector connection failed", error, {
            operation: "stats_connect_failed",
            hostId: host.id,
          });
        }
        return;
      }

      if (hostKeyChanged) {
        state.authFailures.recordFailure(host.id, "HOST_KEY", true);
        log.error("Stats collector host key verification failed", error, {
          operation: "stats_host_key_verification_failed",
          hostId: host.id,
        });
        return;
      }

      state.backoff.recordFailure(host.id);
      // Only log when a new retry window opens, not on every skipped poll.
      const backoff = state.backoff.getBackoffInfo(host.id);
      if (backoff !== null && !backoff.includes("polling suspended")) {
        log.error("Stats collector connection failed", error, {
          operation: "stats_connect_failed",
          hostId: host.id,
        });
      }
    }
  }

  private setCollectionState(host: MetricsHost, next: CollectionState): void {
    const previous = this.collectionState.get(host.id) ?? null;
    if (previous === next) return;
    this.collectionState.set(host.id, next);
    this.ctx.events.emit(TOPIC_STATUS, {
      hostId: host.id,
      ownerUserId: host.userId,
      state: next,
      previous,
    } satisfies CollectionStatusPayload);
  }

  private async recordSample(
    hostId: number,
    metrics: CollectedMetrics,
  ): Promise<void> {
    try {
      const iface = metrics.network?.interfaces?.[0];
      const bytes = (value: string | null | undefined) => {
        const parsed = value ? parseInt(value, 10) : NaN;
        return Number.isNaN(parsed) ? null : parsed;
      };
      const retention = Number(
        await this.ctx.settings.get<number>("historyRetentionDays"),
      );
      await this.deps.repository.recordSample(
        {
          hostId,
          cpuPercent: metrics.cpu?.percent ?? null,
          memPercent: metrics.memory?.percent ?? null,
          diskPercent: metrics.disk?.percent ?? null,
          netRxBytes: bytes(iface?.rxBytes),
          netTxBytes: bytes(iface?.txBytes),
        },
        Number.isInteger(retention) && retention >= 1
          ? Math.min(retention, 90)
          : DEFAULT_RETENTION_DAYS,
      );
    } catch (error) {
      this.deps.log.warn("Failed to write metrics history", {
        operation: "insert_metrics_history",
        hostId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
