import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginSummary } from "@/api/plugins-api";

const mocks = vi.hoisted(() => ({
  request: vi.fn(async () => ({
    status: 200,
    data: new TextEncoder().encode("{}").buffer,
    headers: { "content-type": "application/json" },
  })),
  post: vi.fn(async (_url: string, body?: { ids: string[] }) => ({
    data: {
      tokens: Object.fromEntries(
        (body?.ids ?? []).map((id) => [
          id,
          { token: "frame-token", expiresIn: 300 },
        ]),
      ),
    },
  })),
}));

const stepUp = vi.hoisted(() => ({
  requestStepUp: vi.fn(async () => true),
}));
vi.mock("@/auth/StepUpPrompt", () => stepUp);

vi.mock("@/main-axios", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/main-axios")>()),
  authApi: { request: mocks.request, post: mocks.post },
}));

import {
  connectFrame,
  handleForFrame,
  mayCallHandle,
  mayInvokeAction,
  resetFrameConnections,
} from "@/plugin-host/frames/frame-connection";
import { dropFrameToken } from "@/plugin-host/frames/frame-token";
import { setTabHandleOwner } from "@/plugin-host/frames/tab-handle-owners";
import { setGuestRuntime } from "@/plugin-host/guest-runtime";
import {
  resetPluginStore,
  setPluginSummaries,
} from "@/plugin-host/plugin-store";
import {
  declareActionSlot,
  registerAction,
  registerSlotContribution,
  resetActionRegistry,
} from "@/shell/action-registry";
import {
  foreignStateFor,
  resetForeignViews,
} from "@/plugin-host/frames/foreign-views";
import {
  resetSharedState,
  setSharedState,
  setTabActivator,
} from "@/plugin-host/frames/frame-state";
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

  it("gives a guest page's frames no token and says they are a guest", async () => {
    setGuestRuntime(true);
    try {
      connectFrame(iframe, "docker", "view", "tab:docker", {});
      send({ ch: FRAME_CHANNEL, t: "hello", role: "view", key: "tab:docker" });
      const init = await call("init");
      expect(init).toMatchObject({
        ok: true,
        value: { token: null, guest: true },
      });
      expect(await call("token")).toMatchObject({ ok: true, value: null });
      expect(mocks.post).not.toHaveBeenCalledWith(
        "/plugins/frame-tokens",
        expect.anything(),
      );
    } finally {
      setGuestRuntime(false);
    }
  });

  it("hands out a token and refuses core requests off the list", async () => {
    connectFrame(iframe, "docker", "view", "tab:docker", {});
    send({ ch: FRAME_CHANNEL, t: "hello", role: "view", key: "tab:docker" });

    const token = await call("token");
    expect(token).toMatchObject({ ok: true, value: { value: "frame-token" } });
    expect(mocks.post).toHaveBeenCalledWith("/plugins/frame-tokens", {
      ids: ["docker"],
    });

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

describe("other plugins' views", () => {
  afterEach(() => {
    resetForeignViews();
    resetActionRegistry();
  });

  it("lists only what the frame may place, and drops it on reload", async () => {
    declareActionSlot({
      id: "docker.cards",
      accepts: ["component", "button"],
      pluginId: "docker",
    });
    connectFrame(iframe, "docker", "view", "tab:docker", {});
    send({ ch: FRAME_CHANNEL, t: "hello", role: "view", key: "tab:docker" });
    expect(
      await call("foreign.list", ["l1", "slot", "docker.cards", {}]),
    ).toMatchObject({ ok: true, value: true });
    expect(
      await call("foreign.list", ["l2", "slot", "snippets.cards", {}]),
    ).toMatchObject({ ok: true, value: false });
    expect(
      await call("foreign.mount", [{ id: "v1", listId: "l2", itemKey: "x" }]),
    ).toMatchObject({ ok: true, value: false });
    const owners = Array.from({ length: 200 }, (_, i) => `docker:${i + 1}`);
    const owner = owners.find((entry) => foreignStateFor(entry));
    expect(foreignStateFor(owner!)?.lists.map((list) => list.id)).toEqual([
      "docker.cards",
    ]);
    // The page reloaded: its lists and placeholders went with it.
    send({ ch: FRAME_CHANNEL, t: "hello", role: "view", key: "tab:docker" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(foreignStateFor(owner!)).toBeUndefined();
  });

  it("refuses another plugin's button the frame never listed", async () => {
    const run = vi.fn(() => "ran");
    const drop = registerAction("snippets.paste", run);
    declareActionSlot({
      id: "docker.cards",
      accepts: ["button"],
      pluginId: "docker",
    });
    registerSlotContribution("docker.cards", {
      actionId: "snippets.paste",
      titleKey: "x",
      kind: "button",
      pluginId: "snippets",
    });
    connectFrame(iframe, "docker", "view", "tab:docker", {});
    send({ ch: FRAME_CHANNEL, t: "hello", role: "view", key: "tab:docker" });
    expect(await call("invokeAction", ["snippets.paste"])).toMatchObject({
      ok: false,
    });
    expect(run).not.toHaveBeenCalled();
    drop();
  });

  it("shows a listed tab only right after the person used the frame", async () => {
    const activate = vi.fn();
    setTabActivator(activate);
    setSharedState({
      tabs: [{ id: "t1", instanceId: "i1", type: "terminal" }],
    });
    connectFrame(iframe, "docker", "view", "tab:docker", {});
    send({ ch: FRAME_CHANNEL, t: "hello", role: "view", key: "tab:docker" });
    expect(await call("tabs.show", ["t1"])).toMatchObject({ ok: false });
    send({ ch: FRAME_CHANNEL, t: "event", name: "pointer", data: null });
    expect(await call("tabs.show", ["nope"])).toMatchObject({ ok: false });
    expect(await call("tabs.show", ["t1"])).toMatchObject({ ok: true });
    expect(activate).toHaveBeenCalledWith("t1");
    setTabActivator(null);
    setSharedState({ tabs: [] });
    resetSharedState();
  });
});

describe("things that need the person's click", () => {
  const open = vi.fn();
  beforeEach(() => {
    open.mockReset();
    vi.spyOn(window, "open").mockImplementation(open);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    // Node's own URL.createObjectURL only takes Node's Blob.
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  it("opens no window, starts no download and revokes no key out of the blue", async () => {
    connectFrame(iframe, "docker", "view", "tab:docker", {});
    send({ ch: FRAME_CHANNEL, t: "hello", role: "view", key: "tab:docker" });
    expect(await call("openUrl", ["https://example.com/"])).toMatchObject({
      ok: false,
    });
    expect(open).not.toHaveBeenCalled();
    expect(
      await call("download", [new Blob(["x"]), "update.exe"]),
    ).toMatchObject({ ok: false });
    expect(await call("clipboard.write", ["curl x | sh"])).toMatchObject({
      ok: false,
    });
    const revoke = await call("http", [
      { method: "POST", path: "/users/api-keys/mine/revoke-all" },
    ]);
    expect(revoke).toMatchObject({ ok: true, value: { status: 403 } });
    const removeOne = await call("http", [
      { method: "DELETE", path: "/users/api-keys/mine/abc" },
    ]);
    expect(removeOne).toMatchObject({ ok: true, value: { status: 403 } });
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("does them right after the person used the frame", async () => {
    connectFrame(iframe, "docker", "view", "tab:docker", {});
    send({ ch: FRAME_CHANNEL, t: "hello", role: "view", key: "tab:docker" });
    send({ ch: FRAME_CHANNEL, t: "event", name: "pointer", data: null });
    expect(await call("openUrl", ["https://example.com/"])).toMatchObject({
      ok: true,
    });
    expect(open).toHaveBeenCalledTimes(1);
    const download = await call("download", [new Blob(["x"]), "export.json"]);
    expect(download.error).toBeUndefined();
    expect(download).toMatchObject({ ok: true });
    const revoke = await call("http", [
      { method: "POST", path: "/users/api-keys/mine/revoke-all" },
    ]);
    expect(revoke).toMatchObject({ ok: true, value: { status: 200 } });
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
});

describe("step up", () => {
  it("asks the shell only right after the person used the frame", async () => {
    connectFrame(iframe, "docker", "view", "tab:docker", {});
    send({ ch: FRAME_CHANNEL, t: "hello", role: "view", key: "tab:docker" });
    stepUp.requestStepUp.mockClear();
    expect(await call("stepUp")).toMatchObject({ ok: false });
    expect(stepUp.requestStepUp).not.toHaveBeenCalled();

    send({ ch: FRAME_CHANNEL, t: "event", name: "pointer", data: null });
    expect(await call("stepUp")).toMatchObject({ ok: true, value: true });
    expect(stepUp.requestStepUp).toHaveBeenCalledTimes(1);
  });

  it("does not trust a click the frame only claims", async () => {
    Object.defineProperty(navigator, "userActivation", {
      configurable: true,
      get: () => ({ isActive: false }),
    });
    try {
      connectFrame(iframe, "docker", "view", "tab:docker", {});
      send({ ch: FRAME_CHANNEL, t: "hello", role: "view", key: "tab:docker" });
      stepUp.requestStepUp.mockClear();
      send({ ch: FRAME_CHANNEL, t: "event", name: "pointer", data: null });
      expect(await call("stepUp")).toMatchObject({ ok: false });
      expect(await call("clipboard.read")).toMatchObject({ ok: false });
      expect(stepUp.requestStepUp).not.toHaveBeenCalled();
    } finally {
      delete (navigator as unknown as Record<string, unknown>).userActivation;
    }
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

  it("keeps a private action to the plugin that registered it", () => {
    setPluginSummaries([
      summary("docker", ["terminal.resolveTheme"]),
      summary("snippets", ["ssh-terminal.sessions.publish"]),
    ]);
    const drop = registerAction("ssh-terminal.sessions.publish", () => true, {
      pluginId: "ssh-terminal",
      private: true,
    });
    expect(
      mayInvokeAction("ssh-terminal", "ssh-terminal.sessions.publish"),
    ).toBe(true);
    expect(mayInvokeAction("snippets", "ssh-terminal.sessions.publish")).toBe(
      false,
    );
    drop();
    expect(mayInvokeAction("snippets", "ssh-terminal.sessions.publish")).toBe(
      true,
    );
  });

  it("lets a companion type into a terminal only when it says so", () => {
    expect(mayCallHandle("docker", "focus")).toBe(true);
    expect(mayCallHandle("docker", "sendInput")).toBe(false);
    expect(mayCallHandle("snippets", "sendInput")).toBe(true);
    expect(mayCallHandle("snippets", "confirmClose")).toBe(false);
    expect(mayCallHandle("snippets", "__proto__")).toBe(false);
  });

  it("gives another plugin only the allowed calls of a framed tab's handle", () => {
    const handle = {
      focus: vi.fn(),
      reconnect: vi.fn(),
      disconnect: vi.fn(),
      sendInput: vi.fn(),
      confirmClose: vi.fn(),
      getShareTarget: vi.fn(),
      openSidePanel: vi.fn(),
      label: "not a call",
    };
    expect(handleForFrame(handle, "docker")).toBeUndefined();
    setTabHandleOwner(handle, "ssh-terminal");
    expect(handleForFrame(handle, "ssh-terminal")).toBeUndefined();
    expect(Object.keys(handleForFrame(handle, "docker")!).sort()).toEqual([
      "focus",
      "getShareTarget",
      "openSidePanel",
      "reconnect",
    ]);
    expect(Object.keys(handleForFrame(handle, "snippets")!).sort()).toEqual([
      "focus",
      "getShareTarget",
      "openSidePanel",
      "reconnect",
      "sendInput",
    ]);
  });
});

describe("host actions for a frame", () => {
  it("says which apply to a host and runs one only after a click", async () => {
    const { registerHostAction, resetHostContributions } =
      await import("@/sidebar/host-contributions");
    const { setShellCallbacks, setShellHosts, resetShellBridge } =
      await import("@/plugin-host/shell-bridge");
    const openTab = vi.fn();
    setShellCallbacks({ openTab } as never);
    setShellHosts([{ id: 7, name: "box" } as never]);
    registerHostAction({
      id: "files.open",
      pluginId: "files",
      titleKey: "f",
      icon: (() => null) as never,
      kind: "open",
      tabType: "files",
      when: () => true,
    });
    registerHostAction({
      id: "box.open",
      pluginId: "box",
      titleKey: "b",
      icon: (() => null) as never,
      kind: "open",
      tabType: "box",
      when: () => false,
    });
    connectFrame(iframe, "docker", "view", "tab:docker", {});
    send({ ch: FRAME_CHANNEL, t: "hello", role: "view", key: "tab:docker" });

    expect(await call("hostActions.when", ["7"])).toMatchObject({
      ok: true,
      value: { pairs: [["files", "files.open"]], pending: false },
    });
    expect(await call("hostActions.when", ["99"])).toMatchObject({
      ok: true,
      value: { pairs: [], pending: false },
    });

    const run = ["files", "files.open", "7"];
    expect(await call("hostActions.run", run)).toMatchObject({ ok: false });
    send({ ch: FRAME_CHANNEL, t: "event", name: "pointer", data: null });
    expect(
      await call("hostActions.run", ["box", "box.open", "7"]),
    ).toMatchObject({ ok: false });
    expect(await call("hostActions.run", run)).toMatchObject({ ok: true });
    expect(openTab).toHaveBeenCalledTimes(1);
    expect(openTab.mock.calls[0][1]).toBe("files");

    resetHostContributions();
    resetShellBridge();
  });
});
