/**
 * Reads for All hosts tables and status tiles.
 *
 * Asking every host over SSH on each page load cannot hold up, so a request
 * answers right away from memory and refreshes stale hosts behind it. The page
 * polls and the table fills in as hosts answer. Results stay in memory, never
 * SQLite, since a save rewrites the whole database.
 *
 * Keys include the user: someone a host is shared with can have their own
 * login there and see different rows.
 */

import type {
  ResourceListResult,
  SignalResult,
  SignalStatus,
} from "@termix-ssh/plugin-sdk/operations";
import { RESOURCE_FRESH_MS } from "./constants.js";
import { coalesce } from "./limits.js";
import { getAction } from "./registry.js";
import { matchesWhen } from "@termix-ssh/plugin-sdk/operations";
import { loadOperationHost } from "./hosts.js";
import type { ActorOrigin } from "../plugins/actor.js";
import { hostStatus } from "../plugins/host-status-provider.js";
import { PermissionManager } from "../utils/permission-manager.js";
import { loadProbeTargets } from "../plugins/ctx-probe.js";

export type HostReadState =
  "ok" | "loading" | "offline" | "error" | "no-access" | "not-applicable";

interface CacheEntry {
  value: unknown;
  error?: string;
  fetchedAt: number;
}

export interface HostRead<T> {
  hostId: number;
  state: HostReadState;
  value?: T;
  error?: string;
  fetchedAt?: string;
}

const cache = new Map<string, CacheEntry>();
const MAX_ENTRIES = 20_000;

function cacheKey(userId: string, actionId: string, hostId: number): string {
  return `${userId}|${actionId}|${hostId}`;
}

/** After a change, the next read of this host goes back to the host. */
export function dropResourceCache(hostId: number): void {
  const suffix = `|${hostId}`;
  for (const key of cache.keys()) {
    if (key.endsWith(suffix)) cache.delete(key);
  }
}

function remember(key: string, entry: CacheEntry): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.delete(key);
  cache.set(key, entry);
}

function isOffline(hostId: number): boolean {
  const status = hostStatus.get(hostId) as
    string | { status?: string } | null | undefined;
  const value = typeof status === "string" ? status : status?.status;
  return value === "offline";
}

interface ReadOptions {
  userId: string;
  actionId: string;
  hostIds?: number[];
  refresh?: boolean;
  /** How long a cached answer stays fresh. Defaults to RESOURCE_FRESH_MS. */
  freshMs?: number;
  input?: Record<string, unknown>;
  origin: ActorOrigin;
  /** Lookups shared by every read in one request. */
  scope?: ReadScope;
}

type HostAccess = Awaited<ReturnType<PermissionManager["canAccessHost"]>>;

/**
 * Host lookups for one request. A page reading many signals asks the same
 * questions about the same hosts for each one, so they are made once.
 */
export interface ReadScope {
  targets: Map<string, ReturnType<typeof loadProbeTargets>>;
  access: Map<string, Promise<HostAccess>>;
  hosts: Map<string, ReturnType<typeof loadOperationHost>>;
}

export function createReadScope(): ReadScope {
  return { targets: new Map(), access: new Map(), hosts: new Map() };
}

/** Host lookups in flight at once, so a big fleet doesn't drain the pool. */
const HOST_LOOKUPS_AT_ONCE = 16;

/** Like Promise.all over items, with at most limit running at a time. */
export async function mapLimited<I, O>(
  items: readonly I[],
  limit: number,
  run: (item: I) => Promise<O>,
): Promise<O[]> {
  const out = new Array<O>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await run(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}

function memo<T>(map: Map<string, T>, key: string, load: () => T): T {
  let value = map.get(key);
  if (value === undefined) {
    value = load();
    map.set(key, value);
  }
  return value;
}

function refreshHost(
  options: ReadOptions,
  hostId: number,
  key: string,
): Promise<unknown> {
  return coalesce(key, async () => {
    const { runOperation, OperationError } = await import("./gate.js");
    try {
      const outcome = await runOperation({
        actionId: options.actionId,
        hostId,
        input: options.input,
        internal: true,
        userId: options.userId,
        origin: options.origin,
      });
      if (outcome.status !== "success") {
        remember(key, {
          value: undefined,
          error: outcome.error ?? outcome.status,
          fetchedAt: Date.now(),
        });
        return;
      }
      remember(key, { value: outcome.data, fetchedAt: Date.now() });
    } catch (error) {
      remember(key, {
        value: undefined,
        error:
          error instanceof OperationError || error instanceof Error
            ? error.message
            : String(error),
        fetchedAt: Date.now(),
      });
    }
  });
}

/** One entry per host the user can reach. Never waits on a host. */
export async function readAcrossHosts<T>(
  options: ReadOptions,
): Promise<HostRead<T>[]> {
  const registration = getAction(options.actionId);
  if (!registration) return [];
  const { action } = registration;
  const { getPluginRuntime } = await import("../plugins/index.js");
  const manifest = getPluginRuntime().loader.get(
    registration.pluginId,
  )?.manifest;
  if (!manifest) return [];

  const permissions = PermissionManager.getInstance();
  const scope = options.scope ?? createReadScope();
  const targets = await memo(
    scope.targets,
    options.hostIds?.join(",") ?? "*",
    () => loadProbeTargets(options.userId, options.hostIds),
  );
  const level = action.hostAccess ?? "connect";

  const readOne = async (hostId: number): Promise<HostRead<T> | null> => {
    const access = await memo(scope.access, `${hostId}|${level}`, () =>
      permissions.canAccessHost(options.userId, hostId, level),
    );
    if (!access.hasAccess) return { hostId, state: "no-access" };
    if (action.when) {
      const host = await memo(
        scope.hosts,
        `${hostId}|${registration.pluginId}`,
        () => loadOperationHost(hostId, manifest),
      );
      if (!host || !matchesWhen(action.when, host)) return null;
    }

    const key = cacheKey(options.userId, options.actionId, hostId);
    const cached = cache.get(key);
    const fresh =
      cached &&
      Date.now() - cached.fetchedAt < (options.freshMs ?? RESOURCE_FRESH_MS);

    if (isOffline(hostId)) {
      return {
        hostId,
        state: "offline",
        value: cached?.value as T | undefined,
        fetchedAt: cached
          ? new Date(cached.fetchedAt).toISOString()
          : undefined,
      };
    }
    if (!fresh || options.refresh) void refreshHost(options, hostId, key);
    if (!cached) return { hostId, state: "loading" };
    if (cached.error) {
      return {
        hostId,
        state: "error",
        error: cached.error,
        fetchedAt: new Date(cached.fetchedAt).toISOString(),
      };
    }
    return {
      hostId,
      state: "ok",
      value: cached.value as T,
      fetchedAt: new Date(cached.fetchedAt).toISOString(),
    };
  };

  const reads = await mapLimited(targets, HOST_LOOKUPS_AT_ONCE, (target) =>
    readOne(target.id),
  );
  return reads.filter((read): read is HostRead<T> => read !== null);
}

const SERVER = "server";

/** After a change to a server wide resource, its signals read again. */
export function dropServerSignals(): void {
  for (const key of cache.keys()) {
    if (key.endsWith(`|${SERVER}`)) cache.delete(key);
  }
}

/**
 * A server wide signal, cached like host reads so a polling page does not
 * run the plugin's read on every request. Waits only on the first read.
 */
export async function readServerSignal(options: {
  userId: string;
  actionId: string;
  freshMs?: number;
  origin: ActorOrigin;
}): Promise<unknown> {
  const key = `${options.userId}|${options.actionId}|${SERVER}`;
  const run = () =>
    coalesce(key, async () => {
      const { runOperation } = await import("./gate.js");
      const outcome = await runOperation({
        actionId: options.actionId,
        internal: true,
        userId: options.userId,
        origin: options.origin,
      }).catch(() => null);
      remember(key, { value: outcome?.data, fetchedAt: Date.now() });
    });
  const cached = cache.get(key);
  if (!cached) {
    await run();
    return cache.get(key)?.value;
  }
  if (Date.now() - cached.fetchedAt >= (options.freshMs ?? RESOURCE_FRESH_MS)) {
    void run();
  }
  return cached.value;
}

export interface ResourceRow {
  hostId: number;
  key: string;
  row: Record<string, unknown>;
}

/** Flattens per host reads into table rows, keeping each host's state. */
export function flattenResourceRows(
  reads: HostRead<ResourceListResult>[],
  keyField: string,
): { rows: ResourceRow[]; hosts: Omit<HostRead<unknown>, "value">[] } {
  const rows: ResourceRow[] = [];
  const hosts: Omit<HostRead<unknown>, "value">[] = [];
  for (const read of reads) {
    const { value, ...state } = read;
    hosts.push(state);
    for (const row of value?.rows ?? []) {
      rows.push({ hostId: read.hostId, key: String(row[keyField]), row });
    }
  }
  return { rows, hosts };
}

const WORST: SignalStatus[] = ["fail", "warn", "unknown", "ok"];

/** The worst status across hosts, for a server level tile. */
export function worstStatus(
  results: (SignalResult | undefined)[],
): SignalStatus {
  for (const status of WORST) {
    if (results.some((result) => result?.status === status)) return status;
  }
  return "unknown";
}

/** Test seam. */
export function clearResourceCache(): void {
  cache.clear();
}
