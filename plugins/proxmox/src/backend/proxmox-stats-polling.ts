import {
  collectProxmoxStats,
  type ProxmoxStatsSnapshot,
} from "./proxmox/collect-proxmox-stats.js";
import type { ProxmoxNodeHistoryRepository } from "./proxmox-node-history-repository.js";
import { pluginCtx } from "./plugin-ctx.js";
import type { Client } from "ssh2";

/**
 * Proxmox stats polling gets its own concurrency limiter so a burst of polls
 * on many hosts cannot starve one host's collection.
 */
class ConcurrentLimiter {
  private running = 0;
  private queue: Array<() => void> = [];
  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.max) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

const proxmoxStatsPollLimiter = new ConcurrentLimiter(5);

export interface ProxmoxStatsPollableHost {
  id: number;
  userId: string;
  proxmoxStatsConfig?: string | ProxmoxStatsPollConfig | null;
}

export interface ProxmoxStatsPollConfig {
  nodeName?: string | null;
  pollInterval?: number;
  enabledCards?: string[];
}

const DEFAULT_POLL_INTERVAL_SECONDS = 60;

export function parseProxmoxStatsConfig(
  raw: string | ProxmoxStatsPollConfig | null | undefined,
): ProxmoxStatsPollConfig {
  if (!raw) {
    return { nodeName: null, pollInterval: DEFAULT_POLL_INTERVAL_SECONDS };
  }
  if (typeof raw === "object") {
    return {
      nodeName: raw.nodeName ?? null,
      pollInterval: raw.pollInterval ?? DEFAULT_POLL_INTERVAL_SECONDS,
      enabledCards: raw.enabledCards,
    };
  }
  try {
    const parsed = JSON.parse(raw) as ProxmoxStatsPollConfig;
    return {
      nodeName: parsed.nodeName ?? null,
      pollInterval: parsed.pollInterval ?? DEFAULT_POLL_INTERVAL_SECONDS,
      enabledCards: parsed.enabledCards,
    };
  } catch {
    return { nodeName: null, pollInterval: DEFAULT_POLL_INTERVAL_SECONDS };
  }
}

interface HostPollingEntry<THost extends ProxmoxStatsPollableHost> {
  host: THost;
  timer?: NodeJS.Timeout;
  viewerUserId?: string;
}

interface ViewerDetail {
  sessionId: string;
  userId: string;
  hostId: number;
  lastHeartbeat: number;
}

interface CachedSnapshot {
  data: ProxmoxStatsSnapshot;
  timestamp: number;
}

interface ErrorSnapshot {
  error: string;
  timestamp: number;
}

export class ProxmoxPollingManager<
  THost extends ProxmoxStatsPollableHost = ProxmoxStatsPollableHost,
> {
  private pollingConfigs = new Map<number, HostPollingEntry<THost>>();
  private snapshotStore = new Map<number, CachedSnapshot>();
  private errorStore = new Map<number, ErrorSnapshot>();
  private activeViewers = new Map<number, Set<string>>();
  private viewerDetails = new Map<string, ViewerDetail>();
  private inFlight = new Set<number>();
  private viewerCleanupInterval: NodeJS.Timeout;

  constructor(
    private readonly deps: {
      fetchHostById: (
        hostId: number,
        userId: string,
      ) => Promise<THost | undefined>;
      withSshConnection: <T>(
        host: THost,
        fn: (client: Client) => Promise<T>,
      ) => Promise<T>;
      historyRepository: ProxmoxNodeHistoryRepository;
      historyEnabled?: () => boolean;
    },
  ) {
    this.viewerCleanupInterval = setInterval(() => {
      this.cleanupInactiveViewers();
    }, 60000);
  }

  private intervalWithJitter(intervalMs: number, hostId: number): number {
    const spread = Math.min(intervalMs * 0.2, 15_000);
    const jitter = (hostId * 1103515245) % Math.max(1, Math.floor(spread));
    return intervalMs + jitter;
  }

  // Host Metrics' retention setting belongs to that plugin, so node history
  // keeps a fixed week.
  private readonly retentionDays = 7;

  private async pollHostStats(
    host: THost,
    viewerUserId?: string,
  ): Promise<void> {
    if (this.inFlight.has(host.id)) return;
    this.inFlight.add(host.id);

    try {
      await proxmoxStatsPollLimiter.run(async () => {
        const userId = viewerUserId || host.userId;
        const refreshed =
          (await this.deps.fetchHostById(host.id, userId)) ?? host;
        const config = parseProxmoxStatsConfig(refreshed.proxmoxStatsConfig);

        try {
          const snapshot = await this.deps.withSshConnection(
            refreshed,
            (client) => collectProxmoxStats(client, config.nodeName),
          );

          this.snapshotStore.set(host.id, {
            data: snapshot,
            timestamp: Date.now(),
          });
          this.errorStore.delete(host.id);

          if (this.deps.historyEnabled?.() ?? true) {
            await this.insertHistory(host.id, snapshot);
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.errorStore.set(host.id, {
            error: message,
            timestamp: Date.now(),
          });
          pluginCtx().log.warn(
            `Proxmox stats poll failed for host ${host.id}: ${message}`,
          );
        }
      });
    } finally {
      this.inFlight.delete(host.id);
    }
  }

  private async insertHistory(
    hostId: number,
    snapshot: ProxmoxStatsSnapshot,
  ): Promise<void> {
    try {
      const iface = snapshot.network?.interfaces?.[0];
      const rxRaw = iface?.rxBytes ? parseInt(iface.rxBytes, 10) : null;
      const txRaw = iface?.txBytes ? parseInt(iface.txBytes, 10) : null;

      await this.deps.historyRepository.create({
        hostId,
        cpuPercent: snapshot.node?.cpu?.percent ?? null,
        memPercent: snapshot.node?.memory?.percent ?? null,
        diskPercent: snapshot.node?.disk?.percent ?? null,
        netRxBytes: rxRaw !== null && !isNaN(rxRaw) ? rxRaw : null,
        netTxBytes: txRaw !== null && !isNaN(txRaw) ? txRaw : null,
      });

      await this.deps.historyRepository.pruneOlderThan(
        hostId,
        this.retentionDays,
      );
    } catch (err) {
      pluginCtx().log.warn(
        `Failed to write proxmox node history for host ${hostId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private startPollingForHost(host: THost, viewerUserId?: string): void {
    const existing = this.pollingConfigs.get(host.id);
    if (existing?.timer) {
      clearInterval(existing.timer);
    }

    const config = parseProxmoxStatsConfig(host.proxmoxStatsConfig);
    const intervalMs = this.intervalWithJitter(
      (config.pollInterval ?? DEFAULT_POLL_INTERVAL_SECONDS) * 1000,
      host.id,
    );

    void this.pollHostStats(host, viewerUserId);

    const timer = setInterval(() => {
      const latest = this.pollingConfigs.get(host.id);
      if (latest) {
        void this.pollHostStats(latest.host, latest.viewerUserId);
      }
    }, intervalMs);

    this.pollingConfigs.set(host.id, { host, timer, viewerUserId });
  }

  private stopPollingForHost(hostId: number): void {
    const config = this.pollingConfigs.get(hostId);
    if (config?.timer) {
      clearInterval(config.timer);
    }
    this.pollingConfigs.delete(hostId);
  }

  getStats(
    hostId: number,
  ): { data: ProxmoxStatsSnapshot; timestamp: number } | undefined {
    return this.snapshotStore.get(hostId);
  }

  getError(hostId: number): ErrorSnapshot | undefined {
    return this.errorStore.get(hostId);
  }

  async ensurePolling(host: THost, viewerUserId?: string): Promise<void> {
    if (!this.pollingConfigs.has(host.id)) {
      this.startPollingForHost(host, viewerUserId);
    }
    if (!this.snapshotStore.has(host.id) && !this.inFlight.has(host.id)) {
      await this.pollHostStats(host, viewerUserId);
    }
  }

  registerViewer = (
    hostId: number,
    sessionId: string,
    userId: string,
  ): void => {
    if (!this.activeViewers.has(hostId)) {
      this.activeViewers.set(hostId, new Set());
    }
    this.activeViewers.get(hostId)!.add(sessionId);

    this.viewerDetails.set(sessionId, {
      sessionId,
      userId,
      hostId,
      lastHeartbeat: Date.now(),
    });

    if (this.activeViewers.get(hostId)!.size === 1) {
      Promise.resolve()
        .then(async () => {
          const host = await this.deps.fetchHostById(hostId, userId);
          if (host) {
            this.startPollingForHost(host, userId);
          }
        })
        .catch((err) => {
          pluginCtx().log.warn(
            `Proxmox stats startPollingForHost rejected (non-fatal) for host ${hostId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }
  };

  unregisterViewer = (hostId: number, sessionId: string): void => {
    const viewers = this.activeViewers.get(hostId);
    if (viewers) {
      viewers.delete(sessionId);
      if (viewers.size === 0) {
        this.activeViewers.delete(hostId);
        this.stopPollingForHost(hostId);
      }
    }
    this.viewerDetails.delete(sessionId);
  };

  updateHeartbeat(sessionId: string): boolean {
    const viewer = this.viewerDetails.get(sessionId);
    if (viewer) {
      viewer.lastHeartbeat = Date.now();
      return true;
    }
    return false;
  }

  private cleanupInactiveViewers(): void {
    const now = Date.now();
    const maxInactivity = 120000;

    for (const [sessionId, viewer] of this.viewerDetails.entries()) {
      if (now - viewer.lastHeartbeat > maxInactivity) {
        this.unregisterViewer(viewer.hostId, sessionId);
      }
    }
  }

  destroy(): void {
    clearInterval(this.viewerCleanupInterval);
    for (const hostId of this.pollingConfigs.keys()) {
      this.stopPollingForHost(hostId);
    }
  }
}
