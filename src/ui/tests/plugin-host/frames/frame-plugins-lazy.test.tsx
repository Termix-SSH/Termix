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
  FRAME_IDLE_MS,
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
  port.emit("value", { key: "rail:gizmo:badge", value: 7 });
  port.emit("live", { reasons: options.live ?? [] });
  port.emit("ready");
  return port;
}

const host = { id: 1, name: "h", ip: "1.2.3.4", pluginSettings: {} };

beforeEach(() => {
  resetPluginStore();
  resetPanels();
  setPluginSummaries([summary]);
});

afterEach(() => {
  vi.useRealTimers();
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
});

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
