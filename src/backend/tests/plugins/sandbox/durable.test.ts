import { describe, expect, it, vi } from "vitest";
import { DurableRegistrations } from "../../../plugins/sandbox/durable.js";

type AnyFn = (...args: unknown[]) => unknown;

/** A core ctx that records what was registered with it. */
function coreCtx() {
  const held = new Map<string, unknown[]>();
  const released: string[] = [];
  const track = (path: string) =>
    vi.fn((...args: unknown[]) => {
      const key = `${path}:${String(args[0])}`;
      held.set(key, args);
      return () => {
        held.delete(key);
        released.push(key);
      };
    });
  const ctx = {
    events: { on: track("events.on") },
    operations: {
      register: vi.fn((...args: unknown[]) => {
        held.set(`operations.register:${String(args[0])}`, args);
      }),
    },
    registry: {
      provide: vi.fn((...args: unknown[]) => {
        held.set(`registry.provide:${String(args[0])}`, args);
      }),
      revoke: vi.fn((key: string) => {
        held.delete(`registry.provide:${key}`);
        released.push(`registry.provide:${key}`);
        return true;
      }),
    },
    schedule: { every: track("schedule.every") },
  };
  return { ctx, held, released };
}

function setup(idleMs = 1000, touch: () => void = () => {}) {
  const core = coreCtx();
  let running = true;
  const durable = new DurableRegistrations({
    ctx: () => core.ctx as unknown as Record<string, unknown>,
    wake: vi.fn(async () => {
      running = true;
      // A real wake starts a process that registers again.
      durable.beginRun();
      await onWake();
      durable.endActivate();
      return true;
    }),
    running: () => running,
    idleMs,
    touch,
    log: () => {},
  });
  let onWake: () => Promise<void> = async () => {};
  return {
    ...core,
    durable,
    stop: () => {
      running = false;
    },
    setWake: (fn: () => Promise<void>) => {
      onWake = fn;
    },
  };
}

describe("durable registrations", () => {
  it("registers with core once, with stand-ins for every function", async () => {
    const t = setup();
    t.durable.beginRun();
    const listener = vi.fn(async (x: unknown) => `got ${String(x)}`);
    await t.durable.register("events.on", ["host.deleted", listener]);
    t.durable.endActivate();
    const [, standIn] = t.held.get("events.on:host.deleted")!;
    expect(standIn).not.toBe(listener);
    await expect((standIn as AnyFn)(7)).resolves.toBe("got 7");
    expect(listener).toHaveBeenCalledWith(7);
  });

  it("wakes a stopped process and calls what it registered again", async () => {
    const t = setup();
    t.durable.beginRun();
    const first = vi.fn(async () => "old");
    await t.durable.register("operations.register", [
      "p.restart",
      { run: first },
    ]);
    t.durable.endActivate();
    const [, def] = t.held.get("operations.register:p.restart")! as [
      string,
      { run: AnyFn },
    ];
    t.stop();
    const second = vi.fn(async () => "new");
    t.setWake(async () => {
      await t.durable.register("operations.register", [
        "p.restart",
        { run: second },
      ]);
    });
    await expect(def.run()).resolves.toBe("new");
    expect(first).not.toHaveBeenCalled();
    expect(core(t).operations.register).toHaveBeenCalledTimes(1);
  });

  it("keeps a job's core timer when a new process registers it again", async () => {
    const t = setup(1000);
    t.durable.beginRun();
    await t.durable.register("schedule.every", [
      5000,
      vi.fn(),
      { id: "daily" },
    ]);
    t.durable.endActivate();
    t.durable.beginRun();
    await t.durable.register("schedule.every", [
      5000,
      vi.fn(),
      { id: "daily" },
    ]);
    t.durable.endActivate();
    expect(core(t).schedule.every).toHaveBeenCalledTimes(1);
    expect(t.released).toEqual([]);
  });

  it("skips a short job while the process is stopped, but wakes for a long one", async () => {
    const t = setup(1000);
    t.durable.beginRun();
    const short = vi.fn();
    const long = vi.fn();
    await t.durable.register("schedule.every", [100, short, { id: "tick" }]);
    await t.durable.register("schedule.every", [60_000, long, { id: "daily" }]);
    t.durable.endActivate();
    t.stop();
    t.setWake(async () => {
      await t.durable.register("schedule.every", [100, short, { id: "tick" }]);
      await t.durable.register("schedule.every", [
        60_000,
        long,
        { id: "daily" },
      ]);
    });
    const tick = t.held.get("schedule.every:100")![1] as AnyFn;
    await tick();
    expect(short).not.toHaveBeenCalled();
    const daily = t.held.get("schedule.every:60000")![1] as AnyFn;
    await daily();
    expect(long).toHaveBeenCalledTimes(1);
  });

  it("drops what a fresh process no longer registers", async () => {
    const t = setup();
    t.durable.beginRun();
    await t.durable.register("events.on", ["host.deleted", vi.fn()]);
    await t.durable.register("events.on", ["host.updated", vi.fn()]);
    t.durable.endActivate();
    t.durable.beginRun();
    await t.durable.register("events.on", ["host.deleted", vi.fn()]);
    t.durable.endActivate();
    expect(t.released).toEqual(["events.on:host.updated"]);
    expect(t.durable.size).toBe(1);
  });

  it("registers again when the data changed", async () => {
    const t = setup();
    t.durable.beginRun();
    await t.durable.register("registry.provide", ["p.value", { mode: "a" }]);
    t.durable.endActivate();
    t.durable.beginRun();
    await t.durable.register("registry.provide", ["p.value", { mode: "b" }]);
    t.durable.endActivate();
    expect(t.released).toEqual(["registry.provide:p.value"]);
    expect(t.held.get("registry.provide:p.value")?.[1]).toEqual({ mode: "b" });
  });

  it("ignores the process's own disposals while it shuts down", async () => {
    const t = setup();
    t.durable.beginRun();
    const release = (await t.durable.register("events.on", [
      "host.deleted",
      vi.fn(),
    ])) as () => void;
    t.durable.endActivate();
    t.durable.holding = true;
    release();
    expect(t.durable.size).toBe(1);
    t.durable.holding = false;
    release();
    expect(t.durable.size).toBe(0);
  });

  it("calls the running process's new function during its own activate", async () => {
    const t = setup();
    t.durable.beginRun();
    const fn = vi.fn(async () => "ok");
    await t.durable.register("events.on", ["host.deleted", fn]);
    // Still activating: no wake, the fresh function answers.
    const standIn = t.held.get("events.on:host.deleted")![1] as AnyFn;
    await expect(standIn()).resolves.toBe("ok");
  });

  it("revokes a registry value through the stand-in core holds", async () => {
    const t = setup();
    t.durable.beginRun();
    await t.durable.register("registry.provide", ["p.value", { a: 1 }]);
    t.durable.endActivate();
    await expect(t.durable.revoke("p.value")).resolves.toBe(true);
    expect(t.held.has("registry.provide:p.value")).toBe(false);
  });

  it("does not count a job's own work as use", async () => {
    const touch = vi.fn();
    const t = setup(1000, touch);
    t.durable.beginRun();
    let release!: () => void;
    const job = vi.fn(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    await t.durable.register("schedule.every", [5000, job, { id: "watch" }]);
    await t.durable.register("events.on", ["host.deleted", vi.fn()]);
    t.durable.endActivate();
    const tick = t.held.get("schedule.every:5000")![1] as AnyFn;
    const running = tick();
    await Promise.resolve();
    expect(t.durable.onlyJobs).toBe(true);
    release();
    await running;
    expect(touch).not.toHaveBeenCalled();
    expect(t.durable.onlyJobs).toBe(false);

    const onDeleted = t.held.get("events.on:host.deleted")![1] as AnyFn;
    await onDeleted();
    expect(touch).toHaveBeenCalled();
  });

  it("undoes everything when the plugin is turned off", async () => {
    const t = setup();
    t.durable.beginRun();
    await t.durable.register("events.on", ["host.deleted", vi.fn()]);
    await t.durable.register("schedule.every", [5000, vi.fn(), { id: "d" }]);
    t.durable.endActivate();
    t.durable.dispose();
    expect(t.held.size).toBe(0);
  });
});

function core(t: ReturnType<typeof setup>) {
  return t.ctx;
}
