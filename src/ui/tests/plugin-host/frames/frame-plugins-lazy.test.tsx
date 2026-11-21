import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginSummary } from "@/api/plugins-api";

vi.mock("@/main-axios", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/main-axios")>()),
  getUserInfo: vi.fn(async () => ({ userId: "u1", username: "u" })),
  authApi: {
    post: vi.fn(async (_url: string, body?: { ids: string[] }) => ({
      data: {
        tokens: Object.fromEntries(
          (body?.ids ?? []).map((id) => [id, { token: "t", expiresIn: 300 }]),
        ),
      },
    })),
    request: vi.fn(),
  },
}));

vi.mock("@/hooks/use-permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-permissions")>()),
  loadMyPermissions: vi.fn(async () => ({ permissions: [], isAdmin: false })),
}));

import {
  COLD_LINGER_MS,
  FRAME_BUSY_MS,
  FRAME_IDLE_MS,
  MAX_IDLE_FRAMES,
  MAX_STARTING_FRAMES,
  resetFrameSlots,
  startFramedPlugin,
} from "@/plugin-host/frames/frame-plugins";
import { resetFrameConnections } from "@/plugin-host/frames/frame-connection";
import {
  readCachedPlugin,
  resetRegistrationCache,
} from "@/plugin-host/frames/registration-cache";
import { acquireFramedPlugin } from "@/plugin-host/frames/frame-demand";
import { getFrameValue } from "@/plugin-host/frames/frame-values";
import {
  resetPluginStore,
  setPluginSummaries,
} from "@/plugin-host/plugin-store";
import { getPanel, resetPanels } from "@/shell/panel-registry";
import { invokeAction } from "@/shell/action-registry";
import { listHostActions } from "@/sidebar/host-contributions";
import { getCompanionDef, resetCompanions } from "@/shell/companions";
import { FramePort } from "@/plugin-frame/rpc";
import { FRAME_CHANNEL, type FrameMessage } from "@/plugin-frame/protocol";

const summary = {
  id: "gizmo",
  name: "Gizmo",
  version: "1.0.0",
  enabled: true,
  state: "active",
  frontend: true,
  frontendIsolation: "frame",
  assetVersion: "v1",
  contributes: { panels: [{ id: "gizmo" }], tabs: [] },
} as unknown as PluginSummary;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function frames(): HTMLIFrameElement[] {
  return [
    ...document.querySelectorAll<HTMLIFrameElement>(
      'iframe[data-plugin-frame="gizmo"]',
    ),
  ];
}

async function frameElement(): Promise<HTMLIFrameElement> {
  for (let i = 0; i < 100; i++) {
    const found = frames()[0];
    if (found) return found;
    await sleep(0);
  }
  throw new Error("no background frame");
}

/** A fake background frame that registers what a real activate would. */
async function bootFrame(options: {
  live?: string[];
  calls?: string[];
  when?: () => boolean;
  extra?: { rid: string; kind: string; data: Record<string, unknown> }[];
}) {
  const iframe = await frameElement();
  const win = iframe.contentWindow!;
  const toShell = (message: FrameMessage) =>
    window.dispatchEvent(
      new MessageEvent("message", {
        data: structuredClone(message),
        source: win,
      }),
    );
  const port = new FramePort({
    post: (message) => queueMicrotask(() => toShell(message)),
    onCall: () => undefined,
    fnPrefix: "p",
  });
  vi.spyOn(win, "postMessage").mockImplementation((message: unknown) => {
    queueMicrotask(() => port.receive(structuredClone(message)));
  });
  toShell({ ch: FRAME_CHANNEL, t: "hello", role: "background" });
  port.emit("register", {
    rid: "panel#1",
    kind: "panel",
    data: { id: "gizmo", component: { $component: "panel:gizmo" } },
  });
  port.emit("register", {
    rid: "action#2",
    kind: "action",
    data: {
      id: "gizmo.ping",
      handler: (value: number) => {
        options.calls?.push("ping");
        return value * 2;
      },
    },
  });
  port.emit("register", {
    rid: "hostAction#3",
    kind: "hostAction",
    data: {
      id: "gizmo.open",
      titleKey: "open",
      kind: "open",
      when: () => {
        options.calls?.push("when");
        return options.when?.() ?? true;
      },
    },
  });
  for (const entry of options.extra ?? []) port.emit("register", entry);
  port.emit("value", { key: "rail:gizmo:badge", value: 7 });
  port.emit("live", { reasons: options.live ?? [] });
  port.emit("ready");
  return port;
}

const host = { id: 1, name: "h", ip: "1.2.3.4", pluginSettings: {} };

beforeEach(() => {
  resetPluginStore();
  resetPanels();
  resetCompanions();
  setPluginSummaries([summary]);
});

afterEach(() => {
  vi.useRealTimers();
  resetFrameSlots();
  resetRegistrationCache();
  resetFrameConnections();
  document.getElementById("termix-plugin-frames")?.remove();
  vi.restoreAllMocks();
});

/** First run: starts the frame, answers when, and leaves a cache entry. */
async function firstRun(calls: string[] = [], live: string[] = []) {
  const started = startFramedPlugin(summary);
  await bootFrame({ calls, live });
  const plugin = await started;
  const action = listHostActions().find((entry) => entry.id === "gizmo.open")!;
  action.when(host as never);
  await sleep(1_700);
  plugin.dispose();
  return plugin;
}

describe("lazy background frames", () => {
  it("caches what the frame registered, its answers and values", async () => {
    await firstRun();
    // Another user's key finds nothing.
    expect(await readCachedPlugin("u2:0", "gizmo", "v1")).toBeNull();
    const cached = (await readCachedPlugin(await userKey(), "gizmo", "v1"))!;
    expect(cached.registrations.map((r) => r.rid)).toEqual([
      "panel#1",
      "action#2",
      "hostAction#3",
    ]);
    expect(Object.values(cached.answers)).toEqual([true]);
    expect(cached.values).toEqual({ "rail:gizmo:badge": 7 });
    expect(cached.live).toEqual([]);
    // Another asset version starts clean.
    expect(await readCachedPlugin(await userKey(), "gizmo", "v2")).toBeNull();
  });

  it("replays the cache without a frame and starts one only for live code", async () => {
    const calls: string[] = [];
    await firstRun(calls);
    calls.length = 0;

    const plugin = await startFramedPlugin(summary);
    expect(frames()).toHaveLength(0);
    expect(getPanel("gizmo")?.pluginId).toBe("gizmo");
    expect(getFrameValue("gizmo", "rail:gizmo:badge")).toBe(7);
    // A cached answer needs no frame.
    const action = listHostActions().find((e) => e.id === "gizmo.open")!;
    expect(action.when(host as never)).toBe(true);
    await sleep(20);
    expect(frames()).toHaveLength(0);

    // An action needs the code: the frame starts and the call goes through.
    const result = invokeAction("gizmo.ping", 21);
    await bootFrame({ calls });
    await expect(result).resolves.toBe(42);
    expect(calls).toContain("ping");
    plugin.dispose();
    expect(frames()).toHaveLength(0);
  });

  it("drops cached registrations the new frame no longer makes", async () => {
    await firstRun();
    const plugin = await startFramedPlugin(summary);
    const release = acquireFramedPlugin("gizmo");
    const iframe = await frameElement();
    const win = iframe.contentWindow!;
    const toShell = (message: FrameMessage) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data: structuredClone(message),
          source: win,
        }),
      );
    const port = new FramePort({
      post: (message) => queueMicrotask(() => toShell(message)),
      onCall: () => undefined,
      fnPrefix: "p",
    });
    vi.spyOn(win, "postMessage").mockImplementation((message: unknown) => {
      queueMicrotask(() => port.receive(structuredClone(message)));
    });
    toShell({ ch: FRAME_CHANNEL, t: "hello", role: "background" });
    port.emit("register", {
      rid: "panel#1",
      kind: "panel",
      data: { id: "gizmo", component: { $component: "panel:gizmo" } },
    });
    port.emit("live", { reasons: [] });
    port.emit("ready");
    await sleep(1_700);
    expect(getPanel("gizmo")).toBeDefined();
    expect(listHostActions().some((e) => e.id === "gizmo.open")).toBe(false);
    release();
    plugin.dispose();
  });

  it("always starts a plugin whose frame keeps working on its own", async () => {
    await firstRun([], ["timer"]);
    const started = startFramedPlugin(summary);
    await bootFrame({ live: ["timer"] });
    await started;
    expect(frames()).toHaveLength(1);
  });

  it("stops an idle frame but keeps its registrations", async () => {
    await firstRun();
    const now = Date.now();
    vi.useFakeTimers({ now, toFake: ["setInterval", "clearInterval", "Date"] });
    const plugin = await startFramedPlugin(summary);
    const release = acquireFramedPlugin("gizmo");
    await bootFrame({});
    await sleep(10);
    expect(frames()).toHaveLength(1);
    release();
    vi.setSystemTime(now + FRAME_IDLE_MS + 1);
    vi.advanceTimersByTime(31_000);
    expect(frames()).toHaveLength(0);
    expect(getPanel("gizmo")).toBeDefined();
    plugin.dispose();
  });

  it("keeps a frame up while something holds it", async () => {
    await firstRun();
    const now = Date.now();
    vi.useFakeTimers({ now, toFake: ["setInterval", "clearInterval", "Date"] });
    const plugin = await startFramedPlugin(summary);
    acquireFramedPlugin("gizmo");
    await bootFrame({});
    await sleep(10);
    vi.setSystemTime(now + FRAME_IDLE_MS * 2);
    vi.advanceTimersByTime(31_000);
    expect(frames()).toHaveLength(1);
    plugin.dispose();
  });

  it("reuses a host answer when only the host's live numbers changed", async () => {
    await firstRun();
    const plugin = await startFramedPlugin(summary);
    const action = listHostActions().find((e) => e.id === "gizmo.open")!;
    const live = { ...host, cpu: 91, ram: 40, lastAccess: "now" };
    expect(action.when(live as never)).toBe(true);
    await sleep(20);
    expect(frames()).toHaveLength(0);
    plugin.dispose();
  });

  it("starts no frame when only a host's status or child hosts changed", async () => {
    await firstRun();
    const plugin = await startFramedPlugin(summary);
    const action = listHostActions().find((e) => e.id === "gizmo.open")!;
    const moved = {
      ...host,
      status: "offline",
      online: false,
      sortOrder: 4,
      childHosts: [{ id: 2, ip: "5.6.7.8", status: "online" }],
    };
    expect(action.when(moved as never)).toBe(true);
    await sleep(20);
    expect(frames()).toHaveLength(0);
    plugin.dispose();
  });

  it("shows a host's last answer while its changed fields are asked again", async () => {
    await firstRun();
    const plugin = await startFramedPlugin(summary);
    const action = listHostActions().find((e) => e.id === "gizmo.open")!;
    expect(action.when({ ...host, name: "renamed" } as never)).toBe(true);
    await frameElement();
    expect(frames()).toHaveLength(1);
    // Another host with no answer yet still gets the plain fallback.
    expect(action.when({ ...host, id: 9 } as never)).toBe(false);
    plugin.dispose();
  });

  it("works out a host's answer key once per host object", async () => {
    await firstRun();
    const plugin = await startFramedPlugin(summary);
    const action = listHostActions().find((e) => e.id === "gizmo.open")!;
    let reads = 0;
    const counted = { ...host };
    Object.defineProperty(counted, "ip", {
      enumerable: true,
      get: () => {
        reads++;
        return (host as { ip?: unknown }).ip;
      },
    });
    expect(action.when(counted as never)).toBe(true);
    const once = reads;
    for (let i = 0; i < 50; i++) action.when(counted as never);
    expect(reads).toBe(once);
    plugin.dispose();
  });

  it("reuses a companion answer for a new tab of the same type", async () => {
    const calls: string[] = [];
    const companion = {
      rid: "companion#9",
      kind: "companion",
      data: {
        id: "side",
        titleKey: "side",
        tabTypes: ["terminal"],
        component: { $component: "companion:side" },
        when: () => {
          calls.push("companion");
          return true;
        },
      },
    };
    const started = startFramedPlugin(summary);
    await bootFrame({ extra: [companion] });
    const first = await started;
    const when = () => getCompanionDef("gizmo.side")!.when!;
    when()(
      { id: "tab-1", type: "terminal", label: "a" } as never,
      host as never,
    );
    await sleep(1_700);
    first.dispose();
    expect(calls).toEqual(["companion"]);

    const plugin = await startFramedPlugin(summary);
    expect(frames()).toHaveLength(0);
    const answer = when()(
      { id: "tab-2", type: "terminal", label: "b" } as never,
      host as never,
    );
    expect(answer).toBe(true);
    await sleep(20);
    expect(frames()).toHaveLength(0);
    plugin.dispose();
  });

  it("starts no frame for companion defaults it already knows", async () => {
    const { render } = await import("@testing-library/react");
    const companion = {
      rid: "companion#9",
      kind: "companion",
      data: {
        id: "side",
        titleKey: "side",
        tabTypes: ["terminal"],
        component: { $component: "companion:side" },
        defaultsKey: "companion:side:defaults",
      },
    };
    const started = startFramedPlugin(summary);
    const port = await bootFrame({ extra: [companion] });
    port.emit("value", {
      key: "companion:side:defaults",
      value: { side: "right" },
    });
    const first = await started;
    await sleep(1_700);
    first.dispose();

    const plugin = await startFramedPlugin(summary);
    const Defaults = getCompanionDef("gizmo.side")!.Defaults!;
    const seen: unknown[] = [];
    const { unmount } = render(
      <Defaults onValue={(value) => seen.push(value)} />,
    );
    await sleep(20);
    expect(seen.at(-1)).toMatchObject({ side: "right" });
    await sleep(20);
    expect(frames()).toHaveLength(0);
    unmount();
    plugin.dispose();
  });

  it("keeps an embedded tab's answer apart", async () => {
    const companion = {
      rid: "companion#9",
      kind: "companion",
      data: {
        id: "side",
        titleKey: "side",
        tabTypes: ["terminal"],
        component: { $component: "companion:side" },
        when: () => true,
      },
    };
    const started = startFramedPlugin(summary);
    await bootFrame({ extra: [companion] });
    const first = await started;
    getCompanionDef("gizmo.side")!.when!(
      { id: "tab-1", type: "terminal" } as never,
      host as never,
    );
    await sleep(1_700);
    first.dispose();

    const plugin = await startFramedPlugin(summary);
    const answer = getCompanionDef("gizmo.side")!.when!(
      { id: "embed-1", type: "terminal" } as never,
      host as never,
    );
    expect(answer).toBe(false);
    plugin.dispose();
  });

  it("does not keep a plugin running for an overlay part alone", async () => {
    const overlay = {
      rid: "slot#8",
      kind: "slotContribution",
      data: {
        slotId: "shell.overlay",
        actionId: "gizmo.dialog",
        kind: "component",
        component: { $component: "slot:shell.overlay:gizmo.dialog" },
      },
    };
    const started = startFramedPlugin(summary);
    await bootFrame({ extra: [overlay] });
    const first = await started;
    await sleep(1_700);
    first.dispose();
    const cached = (await readCachedPlugin(await userKey(), "gizmo", "v1"))!;
    expect(cached.live).toEqual([]);

    const plugin = await startFramedPlugin(summary);
    expect(frames()).toHaveLength(0);
    plugin.dispose();
  });

  it("runs a host action item again after the frame that listed it stopped", async () => {
    const opened: unknown[] = [];
    const picker = {
      rid: "hostAction#4",
      kind: "hostAction",
      data: {
        id: "gizmo.pick",
        titleKey: "pick",
        kind: "open",
        when: () => true,
        items: () => [
          {
            id: "one",
            label: "One",
            run: (target: { id: number }) => {
              opened.push(target.id);
              return "opened";
            },
          },
        ],
      },
    };
    const started = startFramedPlugin(summary);
    await bootFrame({ extra: [picker] });
    const plugin = await started;
    const action = listHostActions().find((e) => e.id === "gizmo.pick")!;
    action.items!(host as never);
    await sleep(50);
    const items = action.items!(host as never)!;
    expect(items).toHaveLength(1);

    // The frame stops with nothing holding it; the listed items stay.
    await sleep(1_500 + COLD_LINGER_MS + 200);
    expect(frames()).toHaveLength(0);

    // A click boots a new frame and runs the item there.
    const outcome = Promise.resolve(
      items[0].run(host as never, {} as never),
    ).then(String, (error: Error) => error.message);
    expect(await Promise.race([outcome, sleep(20).then(() => "booting")])).toBe(
      "booting",
    );
    await bootFrame({ extra: [picker] });
    expect(await outcome).toBe("opened");
    expect(opened).toEqual([1]);
    plugin.dispose();
  }, 10_000);

  it("never runs another item when the list changed after the frame stopped", async () => {
    const ran: string[] = [];
    const pickerWith = (ids: string[]) => ({
      rid: "hostAction#5",
      kind: "hostAction",
      data: {
        id: "gizmo.pick2",
        titleKey: "pick",
        kind: "open",
        when: () => true,
        items: () =>
          ids.map((id) => ({
            id,
            label: id,
            run: () => {
              ran.push(id);
              return id;
            },
          })),
      },
    });
    const started = startFramedPlugin(summary);
    await bootFrame({ extra: [pickerWith(["one"])] });
    const plugin = await started;
    const action = listHostActions().find((e) => e.id === "gizmo.pick2")!;
    action.items!(host as never);
    await sleep(50);
    const items = action.items!(host as never)!;
    expect(items).toHaveLength(1);

    await sleep(1_500 + COLD_LINGER_MS + 200);
    expect(frames()).toHaveLength(0);

    // The new frame lists another entry first: the click must not run it.
    const outcome = Promise.resolve(
      items[0].run(host as never, {} as never),
    ).then(String, (error: Error) => error.message);
    await sleep(20);
    await bootFrame({ extra: [pickerWith(["two", "one"])] });
    expect(await outcome).toBe("The plugin no longer has this function");
    expect(ran).toEqual([]);
    plugin.dispose();
  }, 10_000);

  /** A host action whose items' run waits until the test lets it finish. */
  function slowPicker(ids: () => string[]) {
    const runs: { id: string; finish: (value: string) => void }[] = [];
    const picker = {
      rid: "hostAction#6",
      kind: "hostAction",
      data: {
        id: "gizmo.slow",
        titleKey: "slow",
        kind: "open",
        when: () => true,
        items: () =>
          ids().map((id) => ({
            id,
            label: id,
            run: () =>
              new Promise<string>((finish) => runs.push({ id, finish })),
          })),
      },
    };
    return { picker, runs };
  }

  /** Lets the idle check see a frame untouched for longer than its limit. */
  function passIdleTime(now: number) {
    vi.setSystemTime(now + FRAME_IDLE_MS + FRAME_BUSY_MS + 1);
    vi.advanceTimersByTime(31_000);
  }

  it("keeps a woken frame up while a retried item still runs", async () => {
    const { picker, runs } = slowPicker(() => ["one"]);
    const started = startFramedPlugin(summary);
    await bootFrame({ extra: [picker] });
    const plugin = await started;
    const action = listHostActions().find((e) => e.id === "gizmo.slow")!;
    action.items!(host as never);
    await sleep(50);
    const items = action.items!(host as never)!;
    await sleep(1_500 + COLD_LINGER_MS + 200);
    expect(frames()).toHaveLength(0);

    const now = Date.now();
    vi.useFakeTimers({ now, toFake: ["setInterval", "clearInterval", "Date"] });
    const settled: string[] = [];
    void Promise.resolve(items[0].run(host as never, {} as never)).then(
      (value) => settled.push(String(value)),
      (error: Error) => settled.push(error.message),
    );
    await sleep(20);
    await bootFrame({ extra: [picker] });
    for (let i = 0; i < 100 && runs.length === 0; i++) await sleep(5);
    expect(runs).toHaveLength(1);

    passIdleTime(now);
    await sleep(20);
    expect(frames()).toHaveLength(1);
    expect(settled).toEqual([]);
    runs[0].finish("done");
    await sleep(20);
    expect(settled).toEqual(["done"]);
    expect(runs).toHaveLength(1);
    plugin.dispose();
  }, 10_000);

  it("keeps a running frame up while an item it listed still runs", async () => {
    const { picker, runs } = slowPicker(() => ["one"]);
    const first = startFramedPlugin(summary);
    await bootFrame({ extra: [picker] });
    (await first).dispose();
    await sleep(50);

    const now = Date.now();
    vi.useFakeTimers({ now, toFake: ["setInterval", "clearInterval", "Date"] });
    const plugin = await startFramedPlugin(summary);
    const release = acquireFramedPlugin("gizmo");
    await bootFrame({ extra: [picker] });
    await sleep(10);
    const action = listHostActions().find((e) => e.id === "gizmo.slow")!;
    action.items!(host as never);
    await sleep(50);
    const items = action.items!(host as never)!;
    release();
    const settled: string[] = [];
    void Promise.resolve(items[0].run(host as never, {} as never)).then(
      (value) => settled.push(String(value)),
      (error: Error) => settled.push(error.message),
    );
    for (let i = 0; i < 100 && runs.length === 0; i++) await sleep(5);
    expect(runs).toHaveLength(1);

    passIdleTime(now);
    await sleep(20);
    expect(frames()).toHaveLength(1);
    runs[0].finish("done");
    await sleep(20);
    expect(settled).toEqual(["done"]);
    expect(runs).toHaveLength(1);
    plugin.dispose();
  }, 10_000);

  it("shows the list a retry learned when the host changes", async () => {
    let ids = ["one"];
    const { picker, runs } = slowPicker(() => ids);
    const started = startFramedPlugin(summary);
    await bootFrame({ extra: [picker] });
    const plugin = await started;
    const action = listHostActions().find((e) => e.id === "gizmo.slow")!;
    action.items!(host as never);
    await sleep(50);
    const items = action.items!(host as never)!;
    await sleep(1_500 + COLD_LINGER_MS + 200);
    expect(frames()).toHaveLength(0);

    // The click learns the new list from the frame it wakes.
    ids = ["one", "two"];
    const clicked = Promise.resolve(items[0].run(host as never, {} as never));
    await sleep(20);
    await bootFrame({ extra: [picker] });
    for (let i = 0; i < 100 && runs.length === 0; i++) await sleep(5);
    expect(runs).toHaveLength(1);

    // A host whose fields changed shows it while it is asked again.
    const renamed = { ...host, name: "renamed" };
    const shown = action.items!(renamed as never)!;
    expect(shown.map((item) => item.id)).toEqual(["one", "two"]);
    runs[0].finish("done");
    expect(await clicked).toBe("done");
    plugin.dispose();
  }, 10_000);
});

describe("booting many plugins at once", () => {
  const named = (id: string) =>
    ({ ...summary, id, name: id }) as unknown as PluginSummary;
  const booting = () =>
    document.querySelectorAll("iframe[data-frame-role=background]").length;

  it("boots only a few background frames at a time", async () => {
    const ids = ["b1", "b2", "b3", "b4", "b5"];
    setPluginSummaries(ids.map(named));
    const started = ids.map((id) => startFramedPlugin(named(id)));
    await sleep(50);
    expect(booting()).toBe(MAX_STARTING_FRAMES);
    // Disposing a plugin mid boot frees its slot for the next one.
    for (const pending of started) {
      pending.then((plugin) => plugin.dispose()).catch(() => {});
    }
    const first = document.querySelector<HTMLIFrameElement>(
      'iframe[data-plugin-frame="b1"]',
    )!;
    first.remove();
    await sleep(10);
    expect(booting()).toBeLessThanOrEqual(MAX_STARTING_FRAMES);
  });

  it("stops the least recently used idle frames past the cap", async () => {
    const ids = Array.from({ length: MAX_IDLE_FRAMES + 2 }, (_, i) => `c${i}`);
    setPluginSummaries(ids.map(named));
    const running = (id: string) =>
      !!document.querySelector(`iframe[data-plugin-frame="${id}"]`);
    const plugins = [];
    const releases: (() => void)[] = [];
    for (const id of ids.slice(0, -1)) {
      const started = startFramedPlugin(named(id));
      await bootNamed(id);
      plugins.push(await started);
      releases.push(acquireFramedPlugin(id));
    }
    // Past the first linger, so only the cap can stop them.
    await sleep(COLD_LINGER_MS + 300);
    for (const release of releases) {
      release();
      await sleep(5);
    }
    expect(ids.slice(0, -1).every(running)).toBe(true);

    const last = ids[ids.length - 1];
    plugins.push(await startFramedPlugin(named(last)));
    const hold = acquireFramedPlugin(last);
    await bootNamed(last);
    await sleep(10);
    expect(ids.filter(running)).toEqual(ids.slice(1));
    hold();
    for (const plugin of plugins) plugin.dispose();
  }, 15_000);

  it("stops a frame booted only for registrations soon after", async () => {
    const started = startFramedPlugin(summary);
    await bootFrame({});
    const plugin = await started;
    expect(frames()).toHaveLength(1);
    await sleep(1_500 + COLD_LINGER_MS + 200);
    expect(frames()).toHaveLength(0);
    expect(getPanel("gizmo")).toBeDefined();
    plugin.dispose();
  }, 10_000);

  it("asks again for an answer that failed instead of keeping a no", async () => {
    let fail = true;
    const started = startFramedPlugin(summary);
    await bootFrame({
      when: () => {
        if (fail) throw new Error("frame went away");
        return true;
      },
    });
    const plugin = await started;
    const action = listHostActions().find((e) => e.id === "gizmo.open")!;
    expect(action.when(host as never)).toBe(false);
    await sleep(50);
    expect(action.when(host as never)).toBe(false);
    fail = false;
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 6_000);
    action.when(host as never);
    await sleep(50);
    expect(action.when(host as never)).toBe(true);
    plugin.dispose();
  }, 10_000);

  it("keeps a new frame up while it still calls the shell", async () => {
    const started = startFramedPlugin(summary);
    const port = await bootFrame({});
    const plugin = await started;
    const busy = setInterval(
      () => void port.call("toast", ["info", "still working"]).catch(() => {}),
      300,
    );
    await sleep(1_500 + COLD_LINGER_MS + 200);
    expect(frames()).toHaveLength(1);
    clearInterval(busy);
    plugin.dispose();
  }, 10_000);
});

/** A bare background frame for plugin `id` that registers nothing. */
async function bootNamed(id: string): Promise<FramePort> {
  let iframe: HTMLIFrameElement | null = null;
  for (let i = 0; i < 200 && !iframe; i++) {
    iframe = document.querySelector<HTMLIFrameElement>(
      `iframe[data-plugin-frame="${id}"]`,
    );
    if (!iframe) await sleep(5);
  }
  if (!iframe) throw new Error(`no frame for ${id}`);
  const win = iframe.contentWindow!;
  const toShell = (message: FrameMessage) =>
    window.dispatchEvent(
      new MessageEvent("message", {
        data: structuredClone(message),
        source: win,
      }),
    );
  const port = new FramePort({
    post: (message) => queueMicrotask(() => toShell(message)),
    onCall: () => undefined,
    fnPrefix: "p",
  });
  vi.spyOn(win, "postMessage").mockImplementation((message: unknown) => {
    queueMicrotask(() => port.receive(structuredClone(message)));
  });
  toShell({ ch: FRAME_CHANNEL, t: "hello", role: "background" });
  port.emit("live", { reasons: [] });
  port.emit("ready");
  return port;
}

async function userKey(): Promise<string> {
  // u1 with no grants, hashed the same way the shell does.
  const text = JSON.stringify([false, []]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `u1:${(hash >>> 0).toString(16)}`;
}
