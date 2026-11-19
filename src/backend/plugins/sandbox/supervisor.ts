/**
 * Runs every API 2 plugin backend in its own process.
 *
 * One process per plugin, never shared, so two plugins' secrets never sit in
 * one heap. Most plugins start on their first request, socket or anything
 * core calls on its own (a job, an event, an operation, a service, a
 * registry value, a settings hook; see durable.ts) and stop after they have
 * been idle. The few that stay up (keepOnReason) put a provider in core's own
 * request paths or run jobs more often than the idle time.
 *
 * Crash isolation: a process that exits, blows its memory cap, stops
 * answering the health check or burns CPU past its cap is killed, what it
 * registered in core is undone, and it is started again after a backoff. Too
 * many crashes in a row and the plugin is marked failed.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import { pluginLogger } from "../../utils/logger.js";
import { resolveDatabaseDialect } from "../../database/db/dialect.js";
import type { PluginHandle } from "../ctx.js";
import { getPluginDataDir } from "../paths.js";
import { hasCapability } from "../permissions.js";
import { buildChildFlags, DEFAULT_HEAP_MB } from "./capability-flags.js";
import { NO_NETWORK_ENV } from "./child/guards.js";
import { PluginBridge } from "./bridge.js";
import { getSpawner, type SpawnedChild } from "./spawn.js";
import { SandboxTokenStore } from "./tokens.js";
import { isPassableEnv } from "./launcher/policy.js";
import { DurableRegistrations } from "./durable.js";
import { readAwakeState, writeAwakeState } from "./awake-store.js";
import { unregisterPluginHttp } from "../http.js";
import type { SqlDialect } from "./sql-guard.js";
import { explainStartError } from "./unreadable.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export const ACTIVATE_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 1500;
const HEALTH_INTERVAL_MS = 10_000;
const HEALTH_TIMEOUT_MS = 30_000;
/** Below this many running plugins, each is judged on its own. */
const FLEET_MIN = 3;
/** A stall shared by most plugins waits this many timeouts before restarts. */
const FLEET_STALL_LIMIT = 3;

/**
 * Whether a plugin that went quiet for `age` ms should wait rather than be
 * restarted: most of the running ones went quiet with it, and not for long.
 */
export function waitOutFleetStall(
  stale: number,
  ready: number,
  age: number,
  timeout: number,
): boolean {
  return (
    ready >= FLEET_MIN &&
    stale * 2 >= ready &&
    age <= timeout * FLEET_STALL_LIMIT
  );
}

let lastFleetStallLog = 0;
function noteFleetStall(stale: number, ready: number): void {
  const now = Date.now();
  if (now - lastFleetStallLog < 60_000) return;
  lastFleetStallLog = now;
  pluginLogger.warn(
    `${stale} of ${ready} plugins stopped answering at once; waiting instead of restarting them, since core or its channel to them was busy`,
    { operation: "plugin_sandbox" },
  );
}
const CPU_WINDOW_MS = 60_000;
const BACKOFF_START_MS = 1000;
const BACKOFF_MAX_MS = 5 * 60_000;
const CRASH_WINDOW_MS = 10 * 60_000;
const CRASH_LIMIT = 5;
const LOG_LINES_PER_MINUTE = 200;

/**
 * Capabilities that put a provider into core's own request paths (logins,
 * connects, sync, host status and locks, the alert hub, approvals, TLS) or
 * the page's look. Waking a process there would slow every login or connect,
 * so these plugins stay up.
 */
const KEEP_ON_CAPABILITIES = new Set([
  "auth:provide",
  "auth:policy",
  "sync:provide",
  "ssh:transport",
  "hosts:status-provide",
  "hosts:lock",
  "hosts:connect-policy",
  "notify:hub",
  "operations:approve",
  "system:tls",
  "ui:layout",
  "ui:theme",
]);

export type ProcessState =
  "stopped" | "starting" | "ready" | "stopping" | "waiting" | "failed";

export interface SandboxConfig {
  idleMs: number;
  cpuPercent: number;
  memoryMb: number;
  alwaysOn: Set<string>;
  healthIntervalMs?: number;
  healthTimeoutMs?: number;
  cpuWindowMs?: number;
  backoffStartMs?: number;
  /** Where the child runtime lives; tests point this at a fresh build. */
  paths?: { runtime: string; harden: string; reads: string[] };
}

export function readSandboxConfig(
  env: NodeJS.ProcessEnv = process.env,
): SandboxConfig {
  const minutes = Number(env.TERMIX_PLUGIN_IDLE_MINUTES);
  const cpu = Number(env.TERMIX_PLUGIN_CPU_LIMIT);
  const memory = Number(env.TERMIX_PLUGIN_MEMORY_MB);
  return {
    idleMs: (Number.isFinite(minutes) && minutes > 0 ? minutes : 10) * 60_000,
    cpuPercent: Number.isFinite(cpu) && cpu > 0 ? cpu : 80,
    memoryMb:
      Number.isFinite(memory) && memory >= 64 ? memory : DEFAULT_HEAP_MB,
    alwaysOn: new Set(
      (env.TERMIX_PLUGIN_ALWAYS_ON ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  };
}

/** Why the plugin can never stop when idle, or null. */
export function staticKeepOnReason(manifest: PluginManifest): string | null {
  if (manifest.sandbox?.alwaysOn) return "sandbox.alwaysOn";
  if (manifest.providesSecret?.length) return "providesSecret";
  if (
    manifest.contributes?.layouts?.length ||
    manifest.contributes?.themes?.length
  ) {
    return "look";
  }
  return manifest.capabilities.find((c) => KEEP_ON_CAPABILITIES.has(c)) ?? null;
}

/** A job that runs more often than the idle time, which would wake it anyway. */
export function shortScheduleReason(
  manifest: PluginManifest,
  idleMs: number,
): string | null {
  const short = (manifest.sandbox?.schedules ?? []).find(
    (schedule) => schedule.every < idleMs,
  );
  return short ? `schedule ${short.id}` : null;
}

/** Why the plugin stays up, or null when it may stop when idle. */
export function keepOnReason(
  manifest: PluginManifest,
  idleMs: number,
): string | null {
  return staticKeepOnReason(manifest) ?? shortScheduleReason(manifest, idleMs);
}

/** It registers something core calls without a request to the plugin. */
export function hasCoreCalls(manifest: PluginManifest): boolean {
  const sandbox = manifest.sandbox ?? {};
  return Boolean(
    sandbox.schedules?.length ||
    sandbox.events?.length ||
    sandbox.registry?.length ||
    manifest.provides?.length ||
    manifest.capabilities.some((c) =>
      ["operations:provide", "hosts:activity-provide"].includes(c),
    ),
  );
}

/** Whether the plugin has to be up for core to work right. */
export function needsAlwaysOn(
  manifest: PluginManifest,
  idleMs: number,
): boolean {
  return keepOnReason(manifest, idleMs) !== null;
}

export interface SandboxedPluginSpec {
  manifest: PluginManifest;
  dir: string;
  entryPath: string;
  /** A fresh ctx for each start. Its handle is disposed when the process ends. */
  makeContext: () => { ctx: Record<string, unknown>; handle: PluginHandle };
  disposeHandle: (handle: PluginHandle) => Promise<void>;
  /** Too many crashes: core marks the plugin failed. */
  onFailed: (message: string) => void;
}

/** Where the runtime and its dependencies live, for the read grants. */
function runtimeReadPaths(pluginDir: string): string[] {
  const appRoot = path.resolve(here, "../../../../..");
  return [
    pluginDir,
    here,
    // Core's table definitions, for db.refs(). Plain Drizzle objects, no data.
    path.resolve(here, "../../database/db/schema.js"),
    path.join(appRoot, "node_modules"),
    // Workspace packages (the SDK in a source checkout) are links to folders
    // outside node_modules, so name them too.
    path.join(appRoot, "node_modules", "@termix-ssh", "plugin-sdk"),
    path.join(appRoot, "packages", "plugin-sdk", "dist"),
    path.join(appRoot, "package.json"),
  ];
}

/**
 * Major version of the Node that runs plugin processes. On the desktop that
 * is the pinned Node the app ships, not Electron's, and Electron main says
 * which in TERMIX_PLUGIN_NODE_MAJOR.
 */
export function childNodeMajor(
  source: NodeJS.ProcessEnv = process.env,
): number {
  const pinned = Number(source.TERMIX_PLUGIN_NODE_MAJOR);
  if (source.ELECTRON_EMBEDDED === "true" && Number.isInteger(pinned)) {
    return pinned;
  }
  return Number(process.versions.node.split(".")[0]);
}

type Deployment = "desktop" | "docker" | "server"; // plugin-id-ok: not the plugin

/** Where core runs. A plugin process can't look for itself. */
export function deploymentKind(
  source: NodeJS.ProcessEnv = process.env,
  exists: (file: string) => boolean = existsSync,
): Deployment {
  if (source.ELECTRON_EMBEDDED === "true") return "desktop";
  if (exists("/.dockerenv")) return "docker"; // plugin-id-ok: not the plugin
  return "server";
}

/**
 * The plugin process's environment: nothing of core's, only the variables
 * the plugin's manifest lists in env (never a core secret or a variable that
 * changes how Node starts), plus core's version and where it runs.
 */
export function pluginEnv(
  manifest: PluginManifest,
  source: NodeJS.ProcessEnv = process.env,
  exists: (file: string) => boolean = existsSync,
): Record<string, string> {
  const env: Record<string, string> = {
    NODE_ENV: source.NODE_ENV ?? "production",
    TERMIX_SANDBOX_PLUGIN: manifest.id,
    TERMIX_DEPLOYMENT: deploymentKind(source, exists),
  };
  if (typeof source.VERSION === "string" && source.VERSION.length <= 64) {
    env.VERSION = source.VERSION;
  }
  for (const entry of manifest.env ?? []) {
    const name = entry?.name;
    if (typeof name !== "string" || !isPassableEnv(name)) continue;
    const value = source[name];
    if (typeof value === "string" && value.length <= 4096) env[name] = value;
  }
  return env;
}

export function childRuntimePath(): string {
  return path.join(here, "child", "runtime.js");
}

export function childHardenPath(): string {
  return path.join(here, "child", "harden.js");
}

class PluginProcess {
  state: ProcessState = "stopped";
  child: SpawnedChild | null = null;
  bridge: PluginBridge | null = null;
  handle: PluginHandle | null = null;
  lastActivity = Date.now();
  /** What last counted as use, for the processes list. */
  lastUse = "start";
  startedAt = 0;
  readyMs = 0;
  /** Why the last start failed, for the plugin page. */
  startError: string | null = null;
  private starting: Promise<boolean> | null = null;
  private stopDone: Promise<void> | null = null;
  private crashes: number[] = [];
  private backoffMs = 0;
  private notBefore = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  private healthTimer: NodeJS.Timeout | null = null;
  private lastCpu: { at: number; micros: number } | null = null;
  private overCpuSince = 0;
  private lastPong = 0;
  private stopping = false;
  private logCount = 0;
  private logWindow = 0;
  private dropped = 0;
  readonly tokens = new SandboxTokenStore();
  /** Why it can never stop when idle, or null. */
  private readonly staticReason: string | null;
  /** A job shorter than the idle time, until the plugin manages that itself. */
  private readonly scheduleReason: string | null;
  /** The plugin calls ctx.schedule.keepAwake, so short jobs don't keep it up. */
  private managed = false;
  /** Reasons the plugin gave for staying up right now. */
  private readonly awakeReasons = new Set<string>();
  /** It had work when core last stopped, so it starts at boot. */
  private savedAwake = false;
  /** Registrations that outlive the process; only for plugins that may stop. */
  readonly durable: DurableRegistrations | null;
  private durableContext: {
    ctx: Record<string, unknown>;
    handle: PluginHandle;
  } | null = null;
  private lastRssMb: number | null = null;
  private openSockets = 0;

  constructor(
    readonly spec: SandboxedPluginSpec,
    private readonly config: SandboxConfig,
    private readonly dialect: SqlDialect,
    /** How many running plugins stopped answering, out of how many. */
    private readonly fleet: (timeout: number) => {
      stale: number;
      ready: number;
    } = () => ({ stale: 0, ready: 0 }),
  ) {
    this.staticReason = config.alwaysOn.has(spec.manifest.id)
      ? "TERMIX_PLUGIN_ALWAYS_ON"
      : staticKeepOnReason(spec.manifest);
    this.scheduleReason = shortScheduleReason(spec.manifest, config.idleMs);
    const saved = readAwakeState(spec.manifest.id);
    this.managed = saved?.managed === true;
    this.savedAwake = saved?.awake === true;
    this.durable = this.staticReason
      ? null
      : new DurableRegistrations({
          ctx: () => this.longLivedContext(),
          wake: () => this.ensureRunning(),
          running: () => this.state === "ready" || this.state === "starting",
          idleMs: config.idleMs,
          touch: (reason) => this.touch(reason),
          log: (line) => this.log("warn", line),
        });
  }

  /** Why the process stays up right now, or null when it may stop. */
  keepOnReason(): string | null {
    if (this.staticReason) return this.staticReason;
    if (this.scheduleReason && !this.managed) return this.scheduleReason;
    if (this.awakeReasons.size > 0) {
      return `keepAwake: ${[...this.awakeReasons].sort().join(", ")}`;
    }
    return null;
  }

  get alwaysOn(): boolean {
    return this.keepOnReason() !== null;
  }

  /**
   * Started when the plugin is turned on, not on its first use. A plugin
   * with things core calls on its own starts once so they are registered,
   * then stops when idle.
   */
  startsAtBoot(): boolean {
    return this.alwaysOn || this.savedAwake || hasCoreCalls(this.spec.manifest);
  }

  /** The context durable registrations live in: one while the plugin is on. */
  private longLivedContext(): Record<string, unknown> {
    if (!this.durableContext) {
      const made = this.spec.makeContext();
      this.durableContext = { ctx: made.ctx, handle: made.handle };
    }
    return this.durableContext.ctx;
  }

  /** ctx.schedule.keepAwake from the plugin. */
  setAwake(reason: string, awake: boolean): void {
    this.managed = true;
    if (reason) {
      if (awake) this.awakeReasons.add(reason);
      else this.awakeReasons.delete(reason);
    }
    this.savedAwake = this.awakeReasons.size > 0;
    writeAwakeState(this.id, { managed: true, awake: this.savedAwake });
  }

  /** Turned off: stops it and undoes what outlived the process. */
  async shutdown(): Promise<void> {
    await this.stop();
    this.durable?.dispose();
    const kept = this.durableContext;
    this.durableContext = null;
    if (kept) await this.spec.disposeHandle(kept.handle);
  }

  get id(): string {
    return this.spec.manifest.id;
  }

  touch(reason = "start"): void {
    // Calls a scheduled job makes are not use of the plugin.
    if (this.durable?.onlyJobs) return;
    this.lastActivity = Date.now();
    this.lastUse = reason;
  }

  /** Running, but has not answered a ping for longer than `timeout`. */
  isStale(now: number, timeout: number): boolean {
    return this.state === "ready" && now - this.lastPong > timeout;
  }

  get isReady(): boolean {
    return this.state === "ready";
  }

  /** Starts the process if it is not running. True when it is ready. */
  ensureRunning(): Promise<boolean> {
    if (this.state === "ready") return Promise.resolve(true);
    if (this.state === "failed") return Promise.resolve(false);
    if (this.starting) return this.starting;
    this.starting = (async () => {
      // A request that came in while it stopped starts it once it is down.
      if (this.stopDone) await this.stopDone;
      const wait = this.notBefore - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try {
        await this.start();
        this.startError = null;
        return true;
      } catch (error) {
        const why = explainStartError(this.id, (error as Error).message);
        this.startError = why;
        this.log("error", `did not start: ${why}`);
        await this.onExit(null, null, why);
        return false;
      } finally {
        this.starting = null;
      }
    })();
    return this.starting;
  }

  private async grantedCapabilities(): Promise<string[]> {
    const out: string[] = [];
    for (const capability of this.spec.manifest.capabilities) {
      if (
        await hasCapability(
          this.id,
          capability,
          this.spec.manifest.capabilities,
        )
      ) {
        out.push(capability);
      }
    }
    return out;
  }

  private async start(): Promise<void> {
    this.state = "starting";
    // Before any await: a job firing mid start must not call the old process.
    this.durable?.beginRun();
    this.stopping = false;
    this.startedAt = Date.now();
    const manifest = this.spec.manifest;
    const paths = this.config.paths;
    const flags = buildChildFlags({
      granted: await this.grantedCapabilities(),
      readPaths: paths
        ? [this.spec.dir, path.dirname(paths.runtime), ...paths.reads]
        : runtimeReadPaths(this.spec.dir),
      dataDir: getPluginDataDir(this.id),
      hardenPath: paths?.harden ?? childHardenPath(),
      heapMb: manifest.sandbox?.memoryMb ?? this.config.memoryMb,
      workers: manifest.sandbox?.workers === true,
      nodeMajor: childNodeMajor(),
    });
    const child = await getSpawner().spawn({
      pluginId: this.id,
      runtimePath: paths?.runtime ?? childRuntimePath(),
      execArgv: flags.execArgv,
      env: {
        ...pluginEnv(manifest),
        ...(flags.jsNetworkFence ? { [NO_NETWORK_ENV]: "1" } : {}),
      },
      dataDir: getPluginDataDir(this.id),
      firewall: flags.firewall,
    });
    this.child = child;
    child.onOutput((stream, line) => this.output(stream, line));
    child.onExit((code, signal) => void this.onExit(code, signal));

    const { ctx, handle } = this.spec.makeContext();
    this.handle = handle;
    const bridge = new PluginBridge(child.transport, {
      manifest,
      ctx,
      tokens: this.tokens,
      dialect: this.dialect,
      touch: (reason) => this.touch(reason),
      log: (line) => this.log("warn", line),
      durable: this.durable,
      keepAwake: (reason, awake) => this.setAwake(reason, awake),
    });
    this.bridge = bridge;

    const entryUrl = pathToFileURL(this.spec.entryPath).href;
    await withTimeout(
      (async () => {
        await bridge.endpoint.call("init", [bridge.initConfig(entryUrl)]);
        // Activation runs with no actor, the same as in process.
        await bridge.endpoint.call("activate", []);
      })(),
      ACTIVATE_TIMEOUT_MS,
      `Plugin ${this.id} did not activate within ${ACTIVATE_TIMEOUT_MS} ms`,
    );
    this.durable?.endActivate();
    this.state = "ready";
    this.readyMs = Date.now() - this.startedAt;
    this.lastPong = Date.now();
    this.touch();
    this.backoffMs = 0;
    this.startHealth();
    this.log("info", `ready in ${this.readyMs} ms`);
  }

  private startHealth(): void {
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.lastCpu = null;
    this.overCpuSince = 0;
    this.healthTimer = setInterval(
      () => void this.health(),
      this.config.healthIntervalMs ?? HEALTH_INTERVAL_MS,
    );
    this.healthTimer.unref?.();
  }

  private async health(): Promise<void> {
    const bridge = this.bridge;
    if (!bridge || this.state !== "ready") return;
    const timeout = this.config.healthTimeoutMs ?? HEALTH_TIMEOUT_MS;
    const now = Date.now();
    if (now - this.lastPong > timeout) {
      // Most plugins going quiet together means core or the channel to
      // them was busy, not that they all hung: killing them all would only
      // pile restarts onto whatever is slow. A long stall still restarts.
      const { stale, ready } = this.fleet(timeout);
      if (waitOutFleetStall(stale, ready, now - this.lastPong, timeout)) {
        noteFleetStall(stale, ready);
        return;
      }
      this.log("warn", "stopped answering, restarting it");
      this.kill();
      return;
    }
    try {
      const pong = (await withTimeout(
        bridge.endpoint.call("ping", []),
        timeout,
        "ping timed out",
      )) as {
        cpu?: { user: number; system: number };
        rss?: number;
        sockets?: number;
      };
      this.lastPong = Date.now();
      if (typeof pong?.rss === "number") {
        this.lastRssMb = Math.round(pong.rss / 1024 / 1024);
      }
      this.openSockets = Number(pong?.sockets) || 0;
      this.checkCpu(pong?.cpu);
    } catch {
      // the timeout check above catches a process that never answers
    }
    this.checkIdle();
  }

  private checkCpu(cpu: { user: number; system: number } | undefined): void {
    if (!cpu) return;
    const micros = Number(cpu.user) + Number(cpu.system);
    const now = Date.now();
    const last = this.lastCpu;
    this.lastCpu = { at: now, micros };
    if (!last || now <= last.at) return;
    const percent = ((micros - last.micros) / 1000 / (now - last.at)) * 100;
    if (percent <= this.config.cpuPercent) {
      this.overCpuSince = 0;
      return;
    }
    if (!this.overCpuSince) this.overCpuSince = now;
    if (now - this.overCpuSince >= (this.config.cpuWindowMs ?? CPU_WINDOW_MS)) {
      this.log(
        "warn",
        `used more than ${this.config.cpuPercent}% CPU for a minute, restarting it`,
      );
      this.kill();
    }
  }

  /** What keeps a plugin that may stop up right now, or null when idle. */
  busyReason(): string | null {
    if (this.alwaysOn || this.state !== "ready") return null;
    const since = Date.now() - this.lastActivity;
    if (since < this.config.idleMs) {
      return `used ${Math.round(since / 1000)}s ago (${this.lastUse})`;
    }
    if (this.bridge && this.bridge.endpoint.pendingCount > 0) return "calls";
    if (this.tokens.countFor(this.id, "socket") > 0) return "client sockets";
    // Its own sockets and listeners, a one-off job still waiting, or a call
    // from core still running.
    if (this.openSockets > 0) return "own sockets";
    if (this.bridge && this.bridge.pendingTimers > 0) return "timers";
    if (this.durable && this.durable.busy > 0) return "core calls";
    return null;
  }

  private checkIdle(): void {
    if (this.alwaysOn || this.state !== "ready") return;
    if (this.busyReason() !== null) return;
    this.log("info", "idle, stopping it until it is needed");
    if (this.managed) {
      this.savedAwake = false;
      writeAwakeState(this.id, { managed: true, awake: false });
    }
    void this.stop();
  }

  private kill(): void {
    this.child?.kill();
  }

  /** Deactivates, then ends the process. Never throws. */
  async stop(): Promise<void> {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.stopDone) return this.stopDone;
    if (this.state === "stopped" || this.state === "failed") return;
    this.stopDone = this.stopNow().finally(() => {
      this.stopDone = null;
    });
    return this.stopDone;
  }

  private async stopNow(): Promise<void> {
    this.stopping = true;
    this.state = "stopping";
    // New requests go through the wake path, which waits for this stop.
    unregisterPluginHttp(this.id);
    if (this.durable) this.durable.holding = true;
    const bridge = this.bridge;
    const child = this.child;
    try {
      if (bridge) {
        await withTimeout(
          bridge.endpoint.call("deactivate", []),
          STOP_TIMEOUT_MS,
          "deactivate timed out",
        );
      }
    } catch {
      // the process may already be gone
    }
    if (child) {
      const exited = new Promise<void>((resolve) =>
        child.onExit(() => resolve()),
      );
      child.kill();
      await Promise.race([
        exited,
        new Promise((r) => setTimeout(r, STOP_TIMEOUT_MS)),
      ]);
    }
    await this.cleanup("stopped");
    if (this.durable) this.durable.holding = false;
    this.state = "stopped";
    this.openSockets = 0;
  }

  private async cleanup(reason: string): Promise<void> {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    this.bridge?.close(`plugin process ${reason}`);
    this.bridge = null;
    this.child = null;
    const handle = this.handle;
    this.handle = null;
    if (handle) await this.spec.disposeHandle(handle);
  }

  private async onExit(
    code: number | null,
    signal: string | null,
    reason?: string,
  ): Promise<void> {
    if (this.stopping) return;
    if (this.state === "stopped" || this.state === "failed") return;
    const why = reason ?? `exited (${code ?? signal ?? "unknown"})`;
    this.log("warn", why);
    await this.cleanup("exited");
    const now = Date.now();
    this.crashes = [
      ...this.crashes.filter((at) => now - at < CRASH_WINDOW_MS),
      now,
    ];
    if (this.crashes.length >= CRASH_LIMIT) {
      this.state = "failed";
      this.spec.onFailed(
        `The plugin process stopped ${this.crashes.length} times in 10 minutes: ${why}`,
      );
      return;
    }
    this.backoffMs = Math.min(
      this.backoffMs
        ? this.backoffMs * 2
        : (this.config.backoffStartMs ?? BACKOFF_START_MS),
      BACKOFF_MAX_MS,
    );
    this.notBefore = now + this.backoffMs;
    this.state = "waiting";
    if (this.alwaysOn) {
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        if (this.state === "waiting") {
          this.state = "stopped";
          void this.ensureRunning();
        }
      }, this.backoffMs);
      this.restartTimer.unref?.();
    } else {
      this.state = "stopped";
    }
  }

  private output(stream: "out" | "err", line: string): void {
    const now = Date.now();
    if (now - this.logWindow > 60_000) {
      if (this.dropped > 0) {
        this.log("warn", `dropped ${this.dropped} log lines`);
      }
      this.logWindow = now;
      this.logCount = 0;
      this.dropped = 0;
    }
    if (++this.logCount > LOG_LINES_PER_MINUTE) {
      this.dropped++;
      return;
    }
    this.log(stream === "err" ? "warn" : "info", line.slice(0, 2000));
  }

  log(level: "info" | "warn" | "error", line: string): void {
    const meta = { operation: "plugin_sandbox", pluginId: this.id };
    const text = `Plugin ${this.id}: ${line}`;
    if (level === "error") pluginLogger.error(text, undefined, meta);
    else if (level === "warn") pluginLogger.warn(text, meta);
    else pluginLogger.info(text, meta);
  }

  status(): SandboxStatus {
    return {
      pluginId: this.id,
      state: this.state,
      alwaysOn: this.alwaysOn,
      keepOnReason: this.keepOnReason(),
      busy: this.busyReason(),
      rssMb: this.state === "ready" ? this.lastRssMb : null,
      pid: this.child?.pid,
      readyMs: this.readyMs || undefined,
      crashes: this.crashes.length,
    };
  }
}

export interface SandboxStatus {
  pluginId: string;
  state: ProcessState;
  alwaysOn: boolean;
  /** Why it stays up, or null when it stops when idle. */
  keepOnReason: string | null;
  /** What keeps it up for now when it may stop, or null. */
  busy?: string | null;
  /** Resident memory at the last health check, while it runs. */
  rssMb: number | null;
  pid?: number;
  readyMs?: number;
  crashes: number;
}

export class SandboxSupervisor {
  private readonly processes = new Map<string, PluginProcess>();
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: SandboxConfig = readSandboxConfig(),
    private readonly dialect: () => SqlDialect = () => "sqlite",
  ) {}

  private staleCount(timeout: number): { stale: number; ready: number } {
    const now = Date.now();
    let stale = 0;
    let ready = 0;
    for (const proc of this.processes.values()) {
      if (!proc.isReady) continue;
      ready++;
      if (proc.isStale(now, timeout)) stale++;
    }
    return { stale, ready };
  }

  /** Turns a plugin on. Starts it now when it has to be always up. */
  async register(spec: SandboxedPluginSpec): Promise<void> {
    await this.unregister(spec.manifest.id);
    const proc = new PluginProcess(
      spec,
      this.config,
      this.dialect(),
      (timeout) => this.staleCount(timeout),
    );
    this.processes.set(spec.manifest.id, proc);
    this.startSweep();
    if (proc.startsAtBoot()) {
      const ok = await proc.ensureRunning();
      if (!ok) {
        throw new Error(
          proc.startError
            ? `Plugin ${spec.manifest.id} did not start: ${proc.startError}`
            : `Plugin ${spec.manifest.id} did not start`,
        );
      }
    } else {
      proc.log("info", "starts on its first request");
    }
  }

  async unregister(pluginId: string): Promise<void> {
    const proc = this.processes.get(pluginId);
    if (!proc) return;
    this.processes.delete(pluginId);
    await proc.shutdown();
  }

  has(pluginId: string): boolean {
    return this.processes.has(pluginId);
  }

  /** For the HTTP and socket dispatchers: start a stopped plugin. */
  async wake(pluginId: string): Promise<boolean> {
    const proc = this.processes.get(pluginId);
    if (!proc) return false;
    return proc.ensureRunning();
  }

  status(): SandboxStatus[] {
    return [...this.processes.values()].map((proc) => proc.status());
  }

  async shutdown(): Promise<void> {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    const all = [...this.processes.values()];
    this.processes.clear();
    await Promise.all(all.map((proc) => proc.shutdown()));
  }

  private startSweep(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => {
      for (const proc of this.processes.values()) proc.tokens.sweep();
    }, 60_000);
    this.sweepTimer.unref?.();
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

let supervisor: SandboxSupervisor | null = null;

export function getSandboxSupervisor(): SandboxSupervisor {
  if (!supervisor) {
    supervisor = new SandboxSupervisor(readSandboxConfig(), () =>
      resolveDatabaseDialect(),
    );
  }
  return supervisor;
}

/** Test seam. */
export function setSandboxSupervisor(next: SandboxSupervisor | null): void {
  supervisor = next;
}
