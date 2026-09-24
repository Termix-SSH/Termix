/**
 * The host list's status dot.
 *
 * Every host with status checks on gets a TCP connection to its port on a
 * timer. That alone says "reachable". A host becomes "online" when a login
 * worked: an open terminal session, or a plugin reporting one through
 * ctx.hosts.status.reportLogin. Probing never logs in: on RADIUS or Duo backed
 * devices a login fires a real 2FA push, every interval.
 *
 * Polling is demand driven. A user asking for statuses starts polling their
 * own hosts; nothing is probed for a user who never opened the app.
 */

import { pluginEvents, TOPICS } from "../../plugins/events.js";
import { hostSessionStatus } from "../host-session-status.js";
import { sshLogger } from "../../utils/logger.js";
import {
  createCurrentHostResolutionRepository,
  getCurrentSettingValue,
} from "../../database/repositories/factory.js";
import type { HostStatusTargetRow } from "../../database/repositories/host-resolution-repository.js";
import {
  statusAfterAuthentication,
  statusAfterReachabilityCheck,
  type HostStatus,
} from "./host-status.js";
import { ConcurrentLimiter } from "./limiter.js";
import { tcpPing, tcpPingThroughJumpHost } from "./tcp-ping.js";

export const GLOBAL_STATUS_INTERVAL_KEY = "global_status_check_interval";
export const DEFAULT_STATUS_INTERVAL = 60;
/** A status younger than this is fresh enough for check(). */
const FRESH_MS = 30_000;

export interface HostStatusEntry {
  status: HostStatus;
  lastChecked: string;
  reason?: "host_key_changed";
}

export interface HostStatusPayload {
  hostId: number;
  ownerUserId: string;
  status: HostStatus;
  previous: HostStatus | null;
  /** Anything but offline, the shape automations' trigger already reads. */
  online: boolean;
  reason?: "host_key_changed";
}

export interface StatusTarget {
  id: number;
  userId: string;
  ip: string;
  port: number;
  connectionType: string;
  jumpHosts: Array<{ hostId: number }>;
  statusCheckEnabled: boolean;
  statusCheckInterval: number | null;
}

type PortResolver = (
  hostId: number,
) => number | undefined | Promise<number | undefined>;

export interface HostStatusDeps {
  loadTargets: (filter: {
    userId?: string;
    hostIds?: number[];
  }) => Promise<StatusTarget[]>;
  ping: (host: string, port: number) => Promise<boolean>;
  pingThroughJumpHosts: (
    target: StatusTarget,
    port: number,
  ) => Promise<boolean>;
  globalInterval: () => number;
  emit: (payload: HostStatusPayload) => void;
}

function parseJumpHosts(raw: string | null): Array<{ hostId: number }> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(
          (hop): hop is { hostId: number } =>
            !!hop && Number.isInteger((hop as { hostId?: unknown }).hostId),
        )
      : [];
  } catch {
    return [];
  }
}

export function toStatusTarget(row: HostStatusTargetRow): StatusTarget {
  return {
    id: row.id,
    userId: row.userId,
    ip: row.ip,
    port: row.port,
    connectionType: row.connectionType || "ssh",
    jumpHosts: parseJumpHosts(row.jumpHosts),
    statusCheckEnabled: row.statusCheckEnabled !== false,
    statusCheckInterval: row.statusCheckInterval ?? null,
  };
}

const defaultDeps: HostStatusDeps = {
  loadTargets: async (filter) =>
    (
      await createCurrentHostResolutionRepository().listStatusTargets(filter)
    ).map(toStatusTarget),
  ping: (host, port) => tcpPing(host, port, 5000),
  pingThroughJumpHosts: async (target, port) => {
    const { createJumpHostChain } = await import("../jump-host-chain.js");
    const client = await createJumpHostChain(
      target.jumpHosts,
      target.userId,
    ).catch(() => null);
    return client
      ? tcpPingThroughJumpHost(client, target.ip, port, 5000)
      : false;
  },
  globalInterval: () => {
    const value = Number(getCurrentSettingValue(GLOBAL_STATUS_INTERVAL_KEY));
    return Number.isInteger(value) && value >= 5
      ? value
      : DEFAULT_STATUS_INTERVAL;
  },
  emit: (payload) => pluginEvents.emit(TOPICS.hostStatus, payload),
};

interface Polled {
  target: StatusTarget;
  timer?: NodeJS.Timeout;
}

export class HostStatusService {
  private readonly polled = new Map<number, Polled>();
  private readonly store = new Map<number, HostStatusEntry>();
  private readonly owners = new Map<number, string>();
  private readonly inFlight = new Map<number, Promise<void>>();
  private readonly sessionOnline = new Set<number>();
  private readonly loggedIn = new Set<number>();
  private readonly startedUsers = new Set<string>();
  private readonly portResolvers = new Map<string, Set<PortResolver>>();
  private readonly limiter = new ConcurrentLimiter(20);
  private unsubscribers: Array<() => void> = [];

  constructor(private readonly deps: HostStatusDeps = defaultDeps) {}

  /** Subscribes to the core events the status depends on. */
  start(): void {
    if (this.unsubscribers.length > 0) return;
    this.unsubscribers = [
      hostSessionStatus.subscribe((hostId, online) =>
        this.setSessionOnline(hostId, online),
      ),
      pluginEvents.on(TOPICS.hostUpdated, (payload) => {
        const { hostId } = payload as { hostId?: number };
        if (hostId) void this.reload(hostId);
      }),
      pluginEvents.on(TOPICS.hostDeleted, (payload) => {
        const { hostId } = payload as { hostId?: number };
        if (hostId) this.forget(hostId);
      }),
      pluginEvents.on(TOPICS.hostKeyUpdated, (payload) => {
        const { hostId } = payload as { hostId?: number };
        if (hostId) this.clearHostKeyReason(hostId);
      }),
    ];
  }

  stop(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    for (const hostId of [...this.polled.keys()]) this.stopPolling(hostId);
    this.startedUsers.clear();
  }

  get(hostId: number): HostStatusEntry | null {
    return this.store.get(hostId) ?? null;
  }

  /**
   * Statuses for a user's request. With hostIds, polling is brought in line
   * with exactly those of their own hosts (the desktop app sends only the
   * hosts that live on this backend). Without, their own hosts are started
   * once.
   */
  async statusesFor(
    userId: string,
    requestedHostIds: Set<number> | null,
  ): Promise<Map<number, HostStatusEntry>> {
    if (requestedHostIds !== null) {
      await this.reconcile(userId, requestedHostIds);
    } else if (!this.startedUsers.has(userId)) {
      await this.startUser(userId);
    }
    return this.store;
  }

  /** Drops every timer for a user's hosts and starts them again. */
  async refresh(userId: string): Promise<void> {
    const targets = await this.deps.loadTargets({ userId });
    for (const target of targets) this.stopPolling(target.id);
    for (const target of targets) this.startPolling(target);
    this.startedUsers.add(userId);
  }

  /** Re-times every polled host, after the global interval changed. */
  retimeAll(): void {
    for (const { target } of [...this.polled.values()]) {
      this.startPolling(target, false);
    }
  }

  /** Checks now unless the last result is fresh. */
  async check(hostId: number): Promise<HostStatusEntry | null> {
    const current = this.store.get(hostId);
    if (current && Date.now() - Date.parse(current.lastChecked) < FRESH_MS) {
      return current;
    }
    const target =
      this.polled.get(hostId)?.target ??
      (await this.deps.loadTargets({ hostIds: [hostId] }))[0];
    if (!target || !target.statusCheckEnabled) return current ?? null;
    await this.probe(target);
    return this.store.get(hostId) ?? null;
  }

  reportLogin(
    hostId: number,
    outcome: { ok: boolean; hostKeyChanged?: boolean },
  ): void {
    if (outcome.ok) {
      this.loggedIn.add(hostId);
      this.set(hostId, { status: statusAfterAuthentication(true) });
      return;
    }
    this.loggedIn.delete(hostId);
    this.set(hostId, {
      status: this.sessionOnline.has(hostId)
        ? "online"
        : statusAfterAuthentication(false, this.store.get(hostId)?.status),
      ...(outcome.hostKeyChanged ? { reason: "host_key_changed" } : {}),
    });
  }

  registerPort(connectionType: string, resolve: PortResolver): () => void {
    let set = this.portResolvers.get(connectionType);
    if (!set) {
      set = new Set();
      this.portResolvers.set(connectionType, set);
    }
    set.add(resolve);
    return () => {
      set!.delete(resolve);
      if (set!.size === 0) this.portResolvers.delete(connectionType);
    };
  }

  private async startUser(userId: string): Promise<void> {
    this.startedUsers.add(userId);
    const targets = await this.deps.loadTargets({ userId });
    for (const target of targets) {
      if (!this.polled.has(target.id)) this.startPolling(target);
    }
  }

  private async reconcile(userId: string, allowed: Set<number>): Promise<void> {
    const targets = await this.deps.loadTargets({ userId });
    for (const target of targets) {
      if (!allowed.has(target.id)) {
        this.stopPolling(target.id);
        this.store.delete(target.id);
        continue;
      }
      if (!this.polled.has(target.id)) this.startPolling(target);
    }
  }

  private async reload(hostId: number): Promise<void> {
    try {
      const [target] = await this.deps.loadTargets({ hostIds: [hostId] });
      if (!target) {
        this.forget(hostId);
        return;
      }
      if (this.polled.has(hostId) || this.startedUsers.has(target.userId)) {
        this.startPolling(target);
      }
    } catch (error) {
      sshLogger.warn("Could not reload host for status checks", {
        operation: "host_status_reload",
        hostId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private forget(hostId: number): void {
    this.stopPolling(hostId);
    this.store.delete(hostId);
    this.owners.delete(hostId);
    this.loggedIn.delete(hostId);
  }

  private clearHostKeyReason(hostId: number): void {
    const current = this.store.get(hostId);
    if (current?.reason !== "host_key_changed") return;
    this.store.set(hostId, {
      status: current.status,
      lastChecked: current.lastChecked,
    });
  }

  private setSessionOnline(hostId: number, online: boolean): void {
    if (online) {
      this.sessionOnline.add(hostId);
      if (this.polled.has(hostId)) this.set(hostId, { status: "online" });
      return;
    }
    this.sessionOnline.delete(hostId);
    if (
      !this.loggedIn.has(hostId) &&
      this.store.get(hostId)?.status === "online"
    ) {
      this.set(hostId, { status: "reachable" });
    }
  }

  private intervalMs(target: StatusTarget): number {
    const seconds = target.statusCheckInterval ?? this.deps.globalInterval();
    const intervalMs = Math.max(5, seconds) * 1000;
    // Spread hosts so a fleet does not fire on the same second.
    const spread = Math.min(intervalMs * 0.2, 15_000);
    return (
      intervalMs + ((target.id * 1103515245) % Math.max(1, Math.floor(spread)))
    );
  }

  private startPolling(target: StatusTarget, probeNow = true): void {
    this.stopPolling(target.id);
    this.owners.set(target.id, target.userId);
    if (!target.statusCheckEnabled) {
      this.store.delete(target.id);
      return;
    }
    const polled: Polled = { target };
    this.polled.set(target.id, polled);
    if (probeNow) void this.probe(target);
    polled.timer = setInterval(() => {
      const latest = this.polled.get(target.id);
      if (latest) void this.probe(latest.target);
    }, this.intervalMs(target));
    polled.timer.unref?.();
  }

  private stopPolling(hostId: number): void {
    const polled = this.polled.get(hostId);
    if (polled?.timer) clearInterval(polled.timer);
    this.polled.delete(hostId);
  }

  private probe(target: StatusTarget): Promise<void> {
    const running = this.inFlight.get(target.id);
    if (running) return running;
    const job = this.limiter
      .run(() => this.probeNow(target))
      .catch((error) => {
        sshLogger.error("Status check failed", error, {
          operation: "host_status_probe",
          hostId: target.id,
        });
      })
      .finally(() => this.inFlight.delete(target.id));
    this.inFlight.set(target.id, job);
    return job;
  }

  private async portFor(target: StatusTarget): Promise<number> {
    if (target.connectionType !== "ssh") {
      for (const resolve of this.portResolvers.get(target.connectionType) ??
        []) {
        try {
          const port = await resolve(target.id);
          if (Number.isInteger(port) && port! > 0) return port!;
        } catch {
          // fall through to the next resolver
        }
      }
    }
    return target.port;
  }

  private async probeNow(target: StatusTarget): Promise<void> {
    this.owners.set(target.id, target.userId);
    let reachable = false;
    try {
      const port = await this.portFor(target);
      reachable =
        target.jumpHosts.length > 0
          ? await this.deps.pingThroughJumpHosts(target, port)
          : await this.deps.ping(target.ip, port);
    } catch {
      reachable = false;
    }

    const current = this.store.get(target.id);
    this.set(target.id, {
      status:
        reachable && this.sessionOnline.has(target.id)
          ? "online"
          : statusAfterReachabilityCheck(reachable, current?.status),
      ...(reachable && current?.reason === "host_key_changed"
        ? { reason: "host_key_changed" as const }
        : {}),
    });
  }

  private set(hostId: number, entry: Omit<HostStatusEntry, "lastChecked">) {
    const previous = this.store.get(hostId)?.status ?? null;
    const next: HostStatusEntry = {
      ...entry,
      lastChecked: new Date().toISOString(),
    };
    this.store.set(hostId, next);
    if (previous === next.status) return;
    void this.emitChange(hostId, next, previous);
  }

  private async emitChange(
    hostId: number,
    entry: HostStatusEntry,
    previous: HostStatus | null,
  ): Promise<void> {
    let ownerUserId = this.owners.get(hostId);
    if (!ownerUserId) {
      const [target] = await this.deps
        .loadTargets({ hostIds: [hostId] })
        .catch(() => []);
      if (!target) return;
      ownerUserId = target.userId;
      this.owners.set(hostId, ownerUserId);
    }
    this.deps.emit({
      hostId,
      ownerUserId,
      status: entry.status,
      previous,
      online: entry.status !== "offline",
      ...(entry.reason ? { reason: entry.reason } : {}),
    });
  }
}

export const hostStatusService = new HostStatusService();
