import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginSummary } from "@/api/plugins-api";

vi.mock("@/auth/StepUpPrompt", () => ({ requestStepUp: vi.fn() }));

const api = vi.hoisted(() => ({
  startPluginCeremony: vi.fn(async () => ({
    ticket: "t1",
    type: "create" as const,
    publicKey: { challenge: "abc" },
  })),
  finishPluginCeremony: vi.fn(async () => ({ added: true })),
}));
vi.mock("@/api/auth-methods-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/auth-methods-api")>()),
  ...api,
}));

const browser = vi.hoisted(() => ({
  runWebAuthn: vi.fn(async () => ({
    id: "cred",
    rawId: "cred",
    response: { clientDataJSON: "secret-ish" },
  })),
}));
vi.mock("@/auth/webauthn-browser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/auth/webauthn-browser")>()),
  ...browser,
}));

import {
  connectFrame,
  resetFrameConnections,
} from "@/plugin-host/frames/frame-connection";
import { resetWebAuthnBridge } from "@/plugin-host/frames/webauthn-bridge";
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
let posted: Array<Record<string, unknown>>;
let active = true;

function send(data: unknown) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data,
      source: iframe.contentWindow as Window,
    }),
  );
}

async function call(method: string, args: unknown[] = []) {
  const id = Math.floor(Math.random() * 1e9);
  send({ ch: FRAME_CHANNEL, t: "call", id, method, args });
  for (let i = 0; i < 50; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const reply = posted.find(
      (entry) => entry.t === "reply" && entry.id === id,
    );
    if (reply) return reply;
  }
  throw new Error(`no reply to ${method}`);
}

function hello(pluginId: string) {
  connectFrame(iframe, pluginId, "view", `tab:${pluginId}`, {});
  send({ ch: FRAME_CHANNEL, t: "hello", role: "view", key: `tab:${pluginId}` });
}

const click = () =>
  send({ ch: FRAME_CHANNEL, t: "event", name: "pointer", data: null });

beforeEach(() => {
  resetPluginStore();
  setPluginSummaries([
    summary("webauthn", ["auth:provide"]),
    summary("snoop", ["network:outbound"]),
  ]);
  active = true;
  Object.defineProperty(navigator, "userActivation", {
    configurable: true,
    get: () => ({ isActive: active }),
  });
  api.startPluginCeremony.mockClear();
  api.finishPluginCeremony.mockClear();
  browser.runWebAuthn.mockClear();
  iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  posted = [];
  vi.spyOn(iframe.contentWindow!, "postMessage").mockImplementation(
    (message: unknown) => {
      posted.push(message as Record<string, unknown>);
    },
  );
});

afterEach(() => {
  resetFrameConnections();
  resetWebAuthnBridge();
  iframe.remove();
  vi.restoreAllMocks();
  delete (navigator as unknown as Record<string, unknown>).userActivation;
});

describe("security key steps for frames", () => {
  it("runs the frame's own plugin step and hands back only the check's answer", async () => {
    hello("webauthn");
    click();
    const reply = await call("passkey.run", ["add-key", { name: "Laptop" }]);
    expect(reply).toMatchObject({ ok: true, value: { added: true } });
    expect(api.startPluginCeremony).toHaveBeenCalledWith(
      "webauthn",
      "add-key",
      { name: "Laptop" },
    );
    expect(browser.runWebAuthn).toHaveBeenCalledWith("create", {
      challenge: "abc",
    });
    expect(api.finishPluginCeremony).toHaveBeenCalledWith(
      "webauthn",
      "add-key",
      "t1",
      expect.objectContaining({ id: "cred" }),
    );
    // Neither the options nor the browser's answer reach the frame.
    const sent = JSON.stringify(posted);
    expect(sent).not.toContain("abc");
    expect(sent).not.toContain("secret-ish");
  });

  it("answers a closed browser prompt without finishing the step", async () => {
    browser.runWebAuthn.mockRejectedValueOnce(
      Object.assign(new Error("closed"), { name: "NotAllowedError" }),
    );
    hello("webauthn");
    click();
    expect(await call("passkey.run", ["add-key"])).toMatchObject({
      ok: true,
      value: { ok: false, closed: true },
    });
    expect(api.finishPluginCeremony).not.toHaveBeenCalled();
  });

  it("refuses a plugin without auth:provide", async () => {
    hello("snoop");
    click();
    expect(await call("passkey.run", ["add-key"])).toMatchObject({
      ok: false,
    });
    expect(api.startPluginCeremony).not.toHaveBeenCalled();
  });

  it("refuses without real user activation", async () => {
    hello("webauthn");
    expect(await call("passkey.run", ["add-key"])).toMatchObject({
      ok: false,
    });
    active = false;
    click();
    expect(await call("passkey.run", ["add-key"])).toMatchObject({
      ok: false,
    });
    expect(api.startPluginCeremony).not.toHaveBeenCalled();
  });

  it("uses the frame's plugin id whatever the frame sends, and checks the step id", async () => {
    hello("webauthn");
    click();
    await call("passkey.run", ["add-key", { pluginId: "sso", name: "x" }]);
    expect(api.startPluginCeremony).toHaveBeenLastCalledWith(
      "webauthn",
      "add-key",
      { pluginId: "sso", name: "x" },
    );
    expect(await call("passkey.run", ["../users/login"])).toMatchObject({
      ok: false,
    });
    expect(
      await call("passkey.run", ["add-key", { a: { b: 1 } }]),
    ).toMatchObject({ ok: true });
    expect(api.startPluginCeremony).toHaveBeenLastCalledWith(
      "webauthn",
      "add-key",
      {},
    );
  });

  it("has no way to reach a login or second factor step", async () => {
    hello("webauthn");
    click();
    for (const method of [
      "webauthn.login",
      "webauthn.secondFactor",
      "auth.verify",
      "http",
    ]) {
      const reply = await call(method, [
        { url: "/users/auth/passkey/options", method: "POST" },
      ]);
      expect(reply).not.toMatchObject({ ok: true, value: { publicKey: {} } });
    }
    expect(browser.runWebAuthn).not.toHaveBeenCalled();
  });
});
