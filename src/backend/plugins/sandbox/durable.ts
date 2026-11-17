/**
 * Registrations that outlive a plugin process.
 *
 * A plugin that may stop when idle still has things core calls on its own:
 * operations, services, registry values, event listeners, settings hooks,
 * repeating jobs. Core registers each of them once, through a context that
 * lives as long as the plugin is on, with every function swapped for a
 * stand-in. A call to a stand-in starts the process if it is stopped and
 * then runs what the fresh process registered under the same key.
 *
 * A new process registering the same thing again only swaps in its new
 * functions, so a job's timer keeps its rhythm and nothing is listed twice.
 * What a fresh process no longer registers is removed once it has started.
 */

/** Registration calls core may invoke without a request to the plugin. */
export const DURABLE_PATHS = new Set([
  "operations.register",
  "operations.onEvent",
  "services.provide",
  "registry.provide",
  "events.on",
  "settings.onChange",
  "settings.onValidate",
  "schedule.every",
  "sync.registerEntity", // plugin-id-ok: ctx.sync is a core namespace
  "hosts.trackSession",
  "hosts.status.registerPort",
  "hosts.activity.provide",
  "hosts.import.registerImportNormalizer",
  "audit.subscribe",
  "credentials.registerSecretResolver",
]);

type AnyFn = (...args: unknown[]) => unknown;

interface Entry {
  path: string;
  key: string;
  shape: string;
  /** The args the latest process passed, with its own functions. */
  current: unknown[];
  /** Which process run registered it last. */
  run: number;
  /** Undoes the core side registration. */
  release: (() => unknown) | null;
}

export interface DurableHost {
  /** The long-lived context the registrations go through. */
  ctx: () => Record<string, unknown>;
  /** Starts the process; resolves once activate finished. */
  wake: () => Promise<boolean>;
  /** The process is starting or ready. */
  running: () => boolean;
  /** Repeating jobs at least this far apart wake the process. */
  idleMs: number;
  touch: (reason: string) => void;
  log: (line: string) => void;
}

function lookup(
  root: Record<string, unknown>,
  dotted: string,
): { fn: AnyFn; self: unknown } {
  const parts = dotted.split(".");
  let self: unknown = root;
  for (const part of parts.slice(0, -1)) {
    self = (self as Record<string, unknown> | undefined)?.[part];
  }
  const fn = (self as Record<string, unknown> | undefined)?.[parts.at(-1)!];
  if (typeof fn !== "function")
    throw new Error(`ctx.${dotted} is not available`);
  return { fn: fn as AnyFn, self };
}

function shapeOf(args: unknown[]): string {
  try {
    return JSON.stringify(args, (_key, value) =>
      typeof value === "function" ? "\u0000fn" : value,
    );
  } catch {
    return String(Math.random());
  }
}

/** What identifies a registration within its kind: its leading names. */
function identity(path: string, args: unknown[]): string {
  if (path === "schedule.every") {
    const options = (args[2] ?? {}) as { id?: unknown };
    return String(options.id ?? "");
  }
  const names: string[] = [];
  for (const arg of args) {
    if (typeof arg === "string") names.push(arg);
    else break;
  }
  if (path === "services.provide") {
    const name = (args[2] as { name?: unknown } | undefined)?.name;
    if (typeof name === "string") names.push(name);
  }
  return names.join("\u0000");
}

function atPath(value: unknown, path: (string | number)[]): unknown {
  let current = value;
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}

function isPlain(value: object): boolean {
  if (Array.isArray(value)) return true;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export class DurableRegistrations {
  private readonly entries = new Map<string, Entry>();
  private readonly counts = new Map<string, number>();
  private run = 0;
  private inflight = 0;
  private jobs = 0;
  /** While the process shuts down, its own disposals keep what core holds. */
  holding = false;

  constructor(private readonly host: DurableHost) {}

  static handles(path: string): boolean {
    return DURABLE_PATHS.has(path);
  }

  /** Calls waiting for a stand-in to finish. */
  get busy(): number {
    return this.inflight;
  }

  /** Only scheduled jobs are running: what they do is not use. */
  get onlyJobs(): boolean {
    return this.jobs > 0 && this.inflight === this.jobs;
  }

  get size(): number {
    return this.entries.size;
  }

  /** A new process is about to activate. */
  beginRun(): void {
    this.run++;
    this.counts.clear();
  }

  /** The process finished activate: drop what it did not register again. */
  endActivate(): void {
    for (const entry of [...this.entries.values()]) {
      if (entry.run !== this.run) this.drop(entry);
    }
  }

  /** A registration call from the process. Returns what the child gets back. */
  async register(path: string, args: unknown[]): Promise<unknown> {
    const ident = identity(path, args);
    const countKey = `${path}\u0001${ident}`;
    const index = this.counts.get(countKey) ?? 0;
    this.counts.set(countKey, index + 1);
    const key = `${countKey}\u0001${index}`;
    const shape = shapeOf(args);

    const existing = this.entries.get(key);
    if (existing && existing.shape === shape) {
      existing.current = args;
      existing.run = this.run;
      if (path === "schedule.every") this.runNowIfAsked(key, args);
      return this.childRelease(key);
    }
    if (existing) this.drop(existing);

    const entry: Entry = {
      path,
      key,
      shape,
      current: args,
      run: this.run,
      release: null,
    };
    this.entries.set(key, entry);
    const wrapped = this.wrap(args, key, path);
    const { fn, self } = lookup(this.host.ctx(), path);
    let result: unknown;
    try {
      result = await fn.apply(self, wrapped);
    } catch (error) {
      this.entries.delete(key);
      throw error;
    }
    if (typeof result === "function") {
      entry.release = result as () => unknown;
    } else if (path === "registry.provide") {
      const registry = this.host.ctx().registry as {
        revoke: (key: string, value?: unknown) => unknown;
      };
      entry.release = () => registry.revoke(String(args[0]), wrapped[1]);
    }
    return this.childRelease(key);
  }

  /** registry.revoke from the process: hand core the stand-in it holds. */
  async revoke(key: string): Promise<boolean> {
    for (const entry of this.entries.values()) {
      if (entry.path === "registry.provide" && entry.current[0] === key) {
        this.drop(entry);
        return true;
      }
    }
    return false;
  }

  /** The plugin was turned off: undo everything. */
  dispose(): void {
    for (const entry of [...this.entries.values()]) this.drop(entry);
    this.entries.clear();
  }

  private drop(entry: Entry): void {
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
    try {
      void Promise.resolve(entry.release?.()).catch(() => {});
    } catch {
      // already gone
    }
  }

  /** The child's handle to undo it; ignored while the process shuts down. */
  private childRelease(key: string): () => void {
    return () => {
      if (this.holding) return;
      const entry = this.entries.get(key);
      if (entry) this.drop(entry);
    };
  }

  /** A job re-registered with runNow still runs once on this start. */
  private runNowIfAsked(key: string, args: unknown[]): void {
    const options = (args[2] ?? {}) as { runNow?: unknown };
    if (options.runNow !== true) return;
    const fn = args[1];
    if (typeof fn !== "function") return;
    void Promise.resolve()
      .then(() => (fn as AnyFn)())
      .catch((error: unknown) =>
        this.host.log(
          `job ${key.split("\u0001")[1]} failed: ${(error as Error).message}`,
        ),
      );
  }

  private wrap(value: unknown, key: string, path: string): unknown[] {
    const walk = (input: unknown, at: (string | number)[]): unknown => {
      if (typeof input === "function") {
        return (...callArgs: unknown[]) => this.call(key, path, at, callArgs);
      }
      if (input === null || typeof input !== "object" || !isPlain(input)) {
        return input;
      }
      if (Array.isArray(input)) {
        return input.map((item, index) => walk(item, [...at, index]));
      }
      const out: Record<string, unknown> = {};
      for (const [name, item] of Object.entries(input)) {
        out[name] = walk(item, [...at, name]);
      }
      return out;
    };
    return walk(value, []) as unknown[];
  }

  private async call(
    key: string,
    path: string,
    at: (string | number)[],
    callArgs: unknown[],
  ): Promise<unknown> {
    const entry = this.entries.get(key);
    if (!entry) throw new Error("The plugin no longer provides this");
    // A job's own work is not use: a plugin whose jobs find nothing to do
    // must still be able to go idle.
    const job = path === "schedule.every";
    this.inflight++;
    if (job) this.jobs++;
    else this.host.touch(path);
    try {
      const fresh = entry.run === this.run && this.host.running();
      if (!fresh) {
        // A short job only matters while the process runs anyway.
        if (
          path === "schedule.every" &&
          this.intervalOf(entry) < this.host.idleMs
        ) {
          return undefined;
        }
        if (!(await this.host.wake())) {
          throw new Error("The plugin did not start");
        }
      }
      const latest = this.entries.get(key);
      const fn =
        latest && latest.run === this.run
          ? atPath(latest.current, at)
          : undefined;
      if (typeof fn !== "function") {
        throw new Error("The plugin no longer provides this");
      }
      return await (fn as AnyFn)(...callArgs);
    } finally {
      this.inflight--;
      if (job) this.jobs--;
      else this.host.touch(path);
    }
  }

  private intervalOf(entry: Entry): number {
    const ms = Number(entry.current[0]);
    return Number.isFinite(ms) ? ms : 0;
  }
}
