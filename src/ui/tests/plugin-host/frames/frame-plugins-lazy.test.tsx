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
