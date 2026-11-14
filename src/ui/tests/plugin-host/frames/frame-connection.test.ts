import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginSummary } from "@/api/plugins-api";

const mocks = vi.hoisted(() => ({
  request: vi.fn(async () => ({
    status: 200,
    data: new TextEncoder().encode("{}").buffer,
    headers: { "content-type": "application/json" },
  })),
  post: vi.fn(async () => ({ data: { token: "frame-token", expiresIn: 300 } })),
}));

vi.mock("@/main-axios", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/main-axios")>()),
  authApi: { request: mocks.request, post: mocks.post },
}));

import {
  connectFrame,
  mayCallHandle,
  mayInvokeAction,
  resetFrameConnections,
} from "@/plugin-host/frames/frame-connection";
import { dropFrameToken } from "@/plugin-host/frames/frame-token";
import {
  resetPluginStore,
  setPluginSummaries,
} from "@/plugin-host/plugin-store";
import { registerAction } from "@/shell/action-registry";
import { FRAME_CHANNEL } from "@/plugin-frame/protocol";

const summary = (id: string, uses: string[] = []): PluginSummary =>
  ({
    id,
    name: id,
    version: "1.0.0",
    enabled: true,
    state: "active",
    frontend: true,
    frontendIsolation: "frame",
    contributes: { uses },
  }) as unknown as PluginSummary;

let iframe: HTMLIFrameElement;
let replies: Array<Record<string, unknown>>;

function send(data: unknown, source: unknown = iframe.contentWindow) {
  window.dispatchEvent(
    new MessageEvent("message", { data, source: source as Window }),
  );
}

async function call(method: string, args: unknown[] = []) {
  const id = Math.floor(Math.random() * 1e9);
  send({ ch: FRAME_CHANNEL, t: "call", id, method, args });
  for (let i = 0; i < 50; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const reply = replies.find((entry) => entry.id === id);
    if (reply) return reply;
  }
  throw new Error(`no reply to ${method}`);
}

beforeEach(() => {
  resetPluginStore();
  setPluginSummaries([
    summary("docker", ["terminal.resolveTheme"]),
    summary("snippets", ["terminal.sendToActive"]),
  ]);
  iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  replies = [];
  vi.spyOn(iframe.contentWindow!, "postMessage").mockImplementation(
    (message: unknown) => {
      const entry = message as Record<string, unknown>;
      if (entry.t === "reply") replies.push(entry);
    },
  );
  mocks.request.mockClear();
});

afterEach(() => {
  resetFrameConnections();
  dropFrameToken();
  iframe.remove();
  vi.restoreAllMocks();
});

describe("frame connection", () => {
  it("only answers the frame window it belongs to, after hello", async () => {
    connectFrame(iframe, "docker", "view", "tab:docker", {});
    const other = document.createElement("iframe");
    document.body.appendChild(other);
    send(
      { ch: FRAME_CHANNEL, t: "hello", role: "view", key: "tab:docker" },
      other.contentWindow,
    );
    send({ ch: FRAME_CHANNEL, t: "call", id: 1, method: "token", args: [] });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(replies).toEqual([]);
    other.remove();
  });

  it("ignores a hello for another role or view", async () => {
    connectFrame(iframe, "docker", "view", "tab:docker", {});
    send({ ch: FRAME_CHANNEL, t: "hello", role: "background" });
    send({ ch: FRAME_CHANNEL, t: "hello", role: "view", key: "tab:other" });
    send({ ch: FRAME_CHANNEL, t: "call", id: 2, method: "token", args: [] });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(replies).toEqual([]);
  });

  it("hands out a token and refuses core requests off the list", async () => {
    connectFrame(iframe, "docker", "view", "tab:docker", {});
    send({ ch: FRAME_CHANNEL, t: "hello", role: "view", key: "tab:docker" });

    const token = await call("token");
    expect(token).toMatchObject({ ok: true, value: { value: "frame-token" } });
    expect(mocks.post).toHaveBeenCalledWith("/plugins/docker/frame-token");

    const refused = await call("http", [
      { method: "POST", path: "/users/api-keys", headers: {}, body: null },
    ]);
    expect(refused).toMatchObject({ ok: true, value: { status: 403 } });
    expect(mocks.request).not.toHaveBeenCalled();

    const allowed = await call("http", [
      {
        method: "GET",
        path: "/users/me",
        headers: { Authorization: "Bearer forged", Accept: "application/json" },
        body: null,
      },
    ]);
    expect(allowed).toMatchObject({ ok: true, value: { status: 200 } });
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        url: "/users/me",
        headers: { Accept: "application/json" },
      }),
    );
  });

  it("runs only the plugin's own actions and the ones it says it uses", async () => {
    const own = vi.fn(() => "own");
    const used = vi.fn(() => "used");
    const other = vi.fn(() => "other");
    const disposers = [
      registerAction("docker.refresh", own),
      registerAction("terminal.resolveTheme", used),
      registerAction("snippets.list", other),
    ];
    connectFrame(iframe, "docker", "background", undefined, {});
    send({ ch: FRAME_CHANNEL, t: "hello", role: "background" });

    expect(await call("invokeAction", ["docker.refresh"])).toMatchObject({
      ok: true,
      value: "own",
    });
    expect(await call("invokeAction", ["terminal.resolveTheme"])).toMatchObject(
      { ok: true, value: "used" },
    );
    expect(await call("invokeAction", ["snippets.list"])).toMatchObject({
      ok: false,
    });
    expect(other).not.toHaveBeenCalled();
    disposers.forEach((dispose) => dispose());
  });

  it("treats closing a tab that is not open as done", async () => {
    connectFrame(iframe, "docker", "background", undefined, {});
    send({ ch: FRAME_CHANNEL, t: "hello", role: "background" });
    expect(await call("tabs.closeTab", ["docker"])).toMatchObject({ ok: true });
    expect(await call("tabs.closeTab", [42])).toMatchObject({ ok: false });
  });

  it("refuses saved passwords, foreign links and clipboard reads out of the blue", async () => {
    connectFrame(iframe, "docker", "view", "tab:docker", {});
    send({ ch: FRAME_CHANNEL, t: "hello", role: "view", key: "tab:docker" });
    expect(await call("hostPassword", [1, "password"])).toMatchObject({
      ok: false,
    });
    expect(await call("openUrl", ["javascript:alert(1)"])).toMatchObject({
      ok: false,
    });
    expect(await call("clipboard.read")).toMatchObject({ ok: false });
    expect(await call("noSuchThing")).toMatchObject({ ok: false });
  });
});

describe("frame permissions", () => {
  beforeEach(() => {
    resetPluginStore();
    setPluginSummaries([
      summary("docker", ["terminal.resolveTheme"]),
      summary("snippets", ["terminal.sendToActive"]),
    ]);
  });

  it("matches action ids exactly, never by a shared prefix", () => {
    expect(mayInvokeAction("docker", "docker.x")).toBe(true);
    expect(mayInvokeAction("docker", "docker-evil.x")).toBe(false);
    expect(mayInvokeAction("docker", "terminal.resolveTheme")).toBe(true);
    expect(mayInvokeAction("docker", "terminal.sendToActive")).toBe(false);
  });

  it("lets a companion type into a terminal only when it says so", () => {
    expect(mayCallHandle("docker", "focus")).toBe(true);
    expect(mayCallHandle("docker", "sendInput")).toBe(false);
    expect(mayCallHandle("snippets", "sendInput")).toBe(true);
    expect(mayCallHandle("snippets", "confirmClose")).toBe(false);
    expect(mayCallHandle("snippets", "__proto__")).toBe(false);
  });
});
