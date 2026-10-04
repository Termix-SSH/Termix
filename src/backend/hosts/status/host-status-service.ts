/**
 * The host list's status dot.
 *
 * Every host with status checks on gets a TCP connection to its port on a
 * timer. A port that answers is "online", one that does not (twice in a row)
 * is "offline". An open session or a working login also counts as online.
 * Probing never logs in to the host itself: on RADIUS or Duo backed devices a
 * login fires a real 2FA push, every interval. A host behind jump hosts is
 * probed through a chain, which does log in to the hops, so hosts that share
 * a hop list share one chain (jump-probe-pool.ts).
 *
 * Polling is demand driven. A user asking for statuses starts polling their
 * own hosts; nothing is probed for a user who never opened the app. The first
 * request waits briefly for those first checks so it is not empty.
 */

import { pluginEvents, TOPICS } from "../../plugins/events.js";
import { hostSessionStatus } from "../host-session-status.js";
import { sshLogger } from "../../utils/logger.js";
import {
  createCurrentHostResolutionRepository,
  getCurrentSettingValue,
} from "../../database/repositories/factory.js";
import type { HostStatusTargetRow } from "../../database/repositories/host-resolution-repository.js";
import type { HostStatus } from "./host-status.js";
import { ConcurrentLimiter } from "./limiter.js";
import { tcpPing } from "./tcp-ping.js";
import { JumpProbePool } from "./jump-probe-pool.js";

export const GLOBAL_STATUS_INTERVAL_KEY = "global_status_check_interval";
export const DEFAULT_STATUS_INTERVAL = 30;
/** How long the first request for a user waits for the first checks. */
const FIRST_CHECK_WAIT_MS = 6_000;
/** A status younger than this is fresh enough for check(). */
const FRESH_MS = 30_000;

export interface HostStatusEntry {
  status: HostStatus;
  lastChecked: string;
}

export interface HostStatusPayload {
  hostId: number;
  ownerUserId: string;
  status: HostStatus;
  previous: HostStatus | null;
  /** Anything but offline, the shape automations' trigger already reads. */
  online: boolean;
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
  /** Hosts other users shared with this one, directly or through a role. */
  loadSharedHostIds?: (userId: string) => Promise<number[]>;
  ping: (host: string, port: number) => Promise<boolean>;
  pingThroughJumpHosts: (
    target: StatusTarget,
    port: number,
  ) => Promise<boolean>;
  hasActiveSession?: (hostId: number) => boolean;
  globalInterval: () => number;
  emit: (payload: HostStatusPayload) => void;
  /** Pause before a failed ping is tried again. */
  retryDelayMs?: number;
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

const jumpProbes = new JumpProbePool(async (jumpHosts, userId) => {
  const { createJumpHostChain } = await import("../jump-host-chain.js");
  return createJumpHostChain(jumpHosts, userId);
});

const defaultDeps: HostStatusDeps = {
  loadTargets: async (filter) =>
    (
      await createCurrentHostResolutionRepository().listStatusTargets(filter)
    ).map(toStatusTarget),
  loadSharedHostIds: async (userId) => {
    const { createCurrentRbacAccessRepository, createCurrentRoleRepository } =
      await import("../../database/repositories/factory.js");
    const roleIds = await createCurrentRoleRepository().listUserRoleIds(userId);
    const entries =
      await createCurrentRbacAccessRepository().listVisibleHostAccessEntries(
        userId,
        roleIds,
      );
    return [...new Set(entries.map((entry) => entry.hostId))];
  },
  hasActiveSession: (hostId) => hostSessionStatus.hasActiveSession(hostId),
  ping: (host, port) => tcpPing(host, port, 5000),
  pingThroughJumpHosts: (target, port) =>
    jumpProbes.ping(target.jumpHosts, target.userId, target.ip, port, 5000),
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
  private readonly startedUsers = new Set<string>();
  private readonly portResolvers = new Map<string, Set<PortResolver>>();
  private readonly limiter = new ConcurrentLimiter(20);
  private unsubscribers: Array<() => void> = [];

  constructor(private readonly deps: HostStatusDeps = defaultDeps) {}

  /** Subscribes to the core events the status depends on. */
  start(): void {
    if (this.unsubscribers.length > 0) return;
    this.unsubscribers = [
      hostSessionStatus.subscribe((hostId, online) => {
        if (online) this.reportLogin(hostId, { ok: true });
      }),
      pluginEvents.on(TOPICS.hostUpdated, (payload) => {
        const { hostId } = payload as { hostId?: number };
        if (hostId) void this.reload(hostId);
      }),
      pluginEvents.on(TOPICS.hostDeleted, (payload) => {
        const { hostId } = payload as { hostId?: number };
        if (hostId) this.forget(hostId);
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
    const started: Promise<void>[] = [];
    if (requestedHostIds !== null) {
      await this.reconcile(userId, requestedHostIds, started);
    } else if (!this.startedUsers.has(userId)) {
      await this.startUser(userId, started);
    }
    if (started.length > 0) await this.waitFor(started);
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

  /**
   * A working login proves the host is up. A failed one says nothing about
   * reachability (a wrong password, another user's login), so it is ignored.
   */
  reportLogin(hostId: number, outcome: { ok: boolean }): void {
    if (outcome.ok) this.set(hostId, { status: "online" });
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

  private async waitFor(started: Promise<void>[]): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.allSettled(started),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, FIRST_CHECK_WAIT_MS);
        timer.unref?.();
      }),
    ]);
    if (timer) clearTimeout(timer);
  }

  private track(started: Promise<void>[], target: StatusTarget): void {
    const probe = this.startPolling(target);
    if (probe) started.push(probe);
  }

  private async startUser(
    userId: string,
    started: Promise<void>[],
  ): Promise<void> {
    this.startedUsers.add(userId);
    const targets = await this.deps.loadTargets({ userId });
    for (const target of targets) {
      if (!this.polled.has(target.id)) this.track(started, target);
    }
    await this.startShared(userId, null, started);
  }

  /**
   * Hosts shared with the user are checked as their owners, even when no
   * owner has asked for statuses since the server started.
   */
  private async startShared(
    userId: string,
    allowed: Set<number> | null,
    started: Promise<void>[],
  ): Promise<void> {
    if (!this.deps.loadSharedHostIds) return;
    try {
      const shared = (await this.deps.loadSharedHostIds(userId)).filter(
        (hostId) =>
          !this.polled.has(hostId) && (allowed === null || allowed.has(hostId)),
      );
      if (shared.length === 0) return;
      const targets = await this.deps.loadTargets({ hostIds: shared });
      for (const target of targets) {
        if (!this.polled.has(target.id)) this.track(started, target);
      }
    } catch (error) {
      sshLogger.warn("Could not start status checks for shared hosts", {
        operation: "host_status_shared",
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async reconcile(
    userId: string,
    allowed: Set<number>,
    started: Promise<void>[],
  ): Promise<void> {
    const targets = await this.deps.loadTargets({ userId });
    for (const target of targets) {
      if (!allowed.has(target.id)) {
        this.stopPolling(target.id);
        this.store.delete(target.id);
        continue;
      }
      if (!this.polled.has(target.id)) this.track(started, target);
    }
    await this.startShared(userId, allowed, started);
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

  /** Returns the first probe when one was started. */
  private startPolling(
    target: StatusTarget,
    probeNow = true,
  ): Promise<void> | undefined {
    this.stopPolling(target.id);
    this.owners.set(target.id, target.userId);
    if (!target.statusCheckEnabled) {
      this.store.delete(target.id);
      return undefined;
    }
    const polled: Polled = { target };
    this.polled.set(target.id, polled);
    const first = probeNow ? this.probe(target) : undefined;
    polled.timer = setInterval(() => {
      const latest = this.polled.get(target.id);
      if (latest) void this.probe(latest.target);
    }, this.intervalMs(target));
    polled.timer.unref?.();
    return first;
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

  private async pingOnce(target: StatusTarget): Promise<boolean> {
    try {
      if (this.deps.hasActiveSession?.(target.id)) return true;
      const port = await this.portFor(target);
      return target.jumpHosts.length > 0
        ? await this.deps.pingThroughJumpHosts(target, port)
        : await this.deps.ping(target.ip, port);
    } catch {
      return false;
    }
  }

  private async probeNow(target: StatusTarget): Promise<void> {
    this.owners.set(target.id, target.userId);
    let reachable = await this.pingOnce(target);
    if (!reachable) {
      // One lost packet should not flip the dot.
      const delay = this.deps.retryDelayMs ?? 1000;
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      reachable = await this.pingOnce(target);
    }
    this.set(target.id, { status: reachable ? "online" : "offline" });
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
      online: entry.status === "online",
    });
  }
}

export const hostStatusService = new HostStatusService();
