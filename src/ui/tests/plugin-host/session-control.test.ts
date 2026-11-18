import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginSummary } from "@/api/plugins-api";

vi.mock("@/auth/StepUpPrompt", () => ({ requestStepUp: vi.fn() }));
const axios = vi.hoisted(() => ({ logoutUser: vi.fn(async () => ({})) }));
vi.mock("@/main-axios", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/main-axios")>()),
  logoutUser: axios.logoutUser,
}));

import {
  connectFrame,
  resetFrameConnections,
} from "@/plugin-host/frames/frame-connection";
import { resetSessionControl } from "@/plugin-host/session-control";
import {
  resetPluginStore,
  setPluginSummaries,
} from "@/plugin-host/plugin-store";
import { FRAME_CHANNEL } from "@/plugin-frame/protocol";

const summary = (id: string, capabilities: string[]): PluginSummary =>
  ({
    id,
    name: id,
    version: "1.0.0",
    enabled: true,
    state: "active",
    frontend: true,
    frontendIsolation: "frame",
    capabilities,
    contributes: {},
  }) as unknown as PluginSummary;

let iframe: HTMLIFrameElement;
let replies: Array<Record<string, unknown>>;
const reload = vi.fn();
const realLocation = window.location;

function send(data: unknown) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data,
      source: iframe.contentWindow as Window,
    }),
  );
}

async function call(method: string) {
  const id = Math.floor(Math.random() * 1e9);
  send({ ch: FRAME_CHANNEL, t: "call", id, method, args: [] });
  for (let i = 0; i < 50; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const reply = replies.find((entry) => entry.id === id);
    if (reply) return reply;
  }
  throw new Error(`no reply to ${method}`);
}

function hello(pluginId: string) {
  connectFrame(iframe, pluginId, "background", undefined, {});
  send({ ch: FRAME_CHANNEL, t: "hello", role: "background" });
}

beforeEach(() => {
  resetPluginStore();
  resetSessionControl();
  setPluginSummaries([
    summary("login-security", ["auth:policy"]),
    summary("snoop", ["ui:surface"]),
  ]);
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...realLocation, reload },
  });
  reload.mockClear();
  axios.logoutUser.mockClear();
  iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  replies = [];
  vi.spyOn(iframe.contentWindow!, "postMessage").mockImplementation(
    (message: unknown) => {
      const entry = message as Record<string, unknown>;
      if (entry.t === "reply") replies.push(entry);
    },
  );
});

afterEach(() => {
  resetFrameConnections();
  iframe.remove();
  vi.restoreAllMocks();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: realLocation,
  });
});

describe("session calls from frames", () => {
  it("lets a login policy plugin sign the person out", async () => {
    hello("login-security");
    expect(await call("session.signOut")).toMatchObject({ ok: true });
    expect(axios.logoutUser).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads at most once every ten seconds", async () => {
    hello("login-security");
    expect(await call("session.reload")).toMatchObject({
      ok: true,
      value: true,
    });
    expect(await call("session.reload")).toMatchObject({
      ok: true,
      value: false,
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("refuses any other plugin", async () => {
    hello("snoop");
    expect(await call("session.signOut")).toMatchObject({ ok: false });
    expect(await call("session.reload")).toMatchObject({ ok: false });
    expect(axios.logoutUser).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});
