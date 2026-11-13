/**
 * Runs every API 2 plugin backend in its own process.
 *
 * One process per plugin, never shared, so two plugins' secrets never sit in
 * one heap. A plugin that registers nothing core has to call on its own
 * (schedules, event listeners, registry keys, services, provider hooks) starts
 * on its first request or socket and stops after it has been idle. Everything
 * else starts when the plugin is turned on and stays up.
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
import { PluginBridge } from "./bridge.js";
import { getSpawner, type SpawnedChild } from "./spawn.js";
import { SandboxTokenStore } from "./tokens.js";
import { isPassableEnv } from "./launcher/policy.js";
import type { SqlDialect } from "./sql-guard.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export const ACTIVATE_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 1500;
const HEALTH_INTERVAL_MS = 10_000;
const HEALTH_TIMEOUT_MS = 30_000;
const CPU_WINDOW_MS = 60_000;
const BACKOFF_START_MS = 1000;
const BACKOFF_MAX_MS = 5 * 60_000;
const CRASH_WINDOW_MS = 10 * 60_000;
const CRASH_LIMIT = 5;
const LOG_LINES_PER_MINUTE = 200;

/** Capabilities that put a provider into core's own request paths. */
const ALWAYS_ON_CAPABILITIES = new Set([
  "auth:provide",
  "auth:policy",
  "sync:provide",
  "ssh:transport",
  "hosts:status-provide",
  "hosts:activity-provide",
  "hosts:lock",
  "hosts:connect-policy",
  "notify:hub",
  "operations:provide",
  "operations:approve",
  "system:tls",
  "ui:layout",
  "ui:theme",
  "network:sockets",
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

/**
 * Whether the plugin has to be up for core to work right: it registered
 * something core calls without a request to that plugin.
 */
export function needsAlwaysOn(
  manifest: PluginManifest,
  idleMs: number,
): boolean {
  const sandbox = manifest.sandbox ?? {};
  if (sandbox.alwaysOn) return true;
  if (sandbox.events?.length || sandbox.registry?.length) return true;
  if ((sandbox.schedules ?? []).length > 0) {
    // A job that runs less often than the idle time could wake the process
    // instead; until core can do that, any schedule keeps it on.
    void idleMs;
    return true;
  }
  if (manifest.provides?.length || manifest.providesSecret?.length) return true;
  if (
    manifest.contributes?.layouts?.length ||
    manifest.contributes?.themes?.length
  ) {
    return true;
  }
  return manifest.capabilities.some((c) => ALWAYS_ON_CAPABILITIES.has(c));
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
  startedAt = 0;
  readyMs = 0;
  private starting: Promise<boolean> | null = null;
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
  readonly alwaysOn: boolean;

  constructor(
    readonly spec: SandboxedPluginSpec,
    private readonly config: SandboxConfig,
    private readonly dialect: SqlDialect,
  ) {
    this.alwaysOn =
      config.alwaysOn.has(spec.manifest.id) ||
      needsAlwaysOn(spec.manifest, config.idleMs);
  }

  get id(): string {
    return this.spec.manifest.id;
  }

  touch(): void {
    this.lastActivity = Date.now();
  }

  /** Starts the process if it is not running. True when it is ready. */
  ensureRunning(): Promise<boolean> {
    if (this.state === "ready") return Promise.resolve(true);
    if (this.state === "failed") return Promise.resolve(false);
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const wait = this.notBefore - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try {
        await this.start();
        return true;
      } catch (error) {
        this.log("error", `did not start: ${(error as Error).message}`);
        await this.onExit(null, null, (error as Error).message);
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
      nodeMajor: Number(process.versions.node.split(".")[0]),
    });
    // Electron's utility process ignores Node flags, so on the desktop the
    // process, its empty env and the checked ctx are the fence.
    if (getSpawner().mode === "electron") {
      flags.unenforced.push("files", "child processes", "memory");
    }
    if (flags.unenforced.length > 0) {
      this.log(
        "info",
        `can't fence ${flags.unenforced.join(", ")} here; the plugin has them`,
      );
    }
    const child = await getSpawner().spawn({
      pluginId: this.id,
      runtimePath: paths?.runtime ?? childRuntimePath(),
      execArgv: flags.execArgv,
      env: pluginEnv(manifest),
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
      touch: () => this.touch(),
      log: (line) => this.log("warn", line),
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
    if (Date.now() - this.lastPong > timeout) {
      this.log("warn", "stopped answering, restarting it");
      this.kill();
      return;
    }
    try {
      const pong = (await withTimeout(
        bridge.endpoint.call("ping", []),
        timeout,
        "ping timed out",
      )) as { cpu?: { user: number; system: number } };
      this.lastPong = Date.now();
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

  private checkIdle(): void {
    if (this.alwaysOn || this.state !== "ready") return;
    if (Date.now() - this.lastActivity < this.config.idleMs) return;
    if (this.bridge && this.bridge.endpoint.pendingCount > 0) return;
    if (this.tokens.countFor(this.id, "socket") > 0) return;
    this.log("info", "idle, stopping it until it is needed");
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
    if (this.state === "stopped" || this.state === "failed") return;
    this.stopping = true;
    this.state = "stopping";
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
    this.state = "stopped";
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

  /** Turns a plugin on. Starts it now when it has to be always up. */
  async register(spec: SandboxedPluginSpec): Promise<void> {
    await this.unregister(spec.manifest.id);
    const proc = new PluginProcess(spec, this.config, this.dialect());
    this.processes.set(spec.manifest.id, proc);
    this.startSweep();
    if (proc.alwaysOn) {
      const ok = await proc.ensureRunning();
      if (!ok) throw new Error(`Plugin ${spec.manifest.id} did not start`);
    } else {
      proc.log("info", "starts on its first request");
    }
  }

  async unregister(pluginId: string): Promise<void> {
    const proc = this.processes.get(pluginId);
    if (!proc) return;
    this.processes.delete(pluginId);
    await proc.stop();
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
    await Promise.all(all.map((proc) => proc.stop()));
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
