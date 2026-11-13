/**
 * SSH auth providers in a plugin process: what crosses each way, and what a
 * provider can't change on the real connect config.
 */
import { describe, expect, it, vi } from "vitest";
import {
  pickSettableConfig,
  readBannerDecision,
  readDetection,
  readSandboxCertificate,
  remoteSshAuthProvider,
} from "../../../plugins/sandbox/ssh-auth-bridge.js";

type AnyFn = (...args: unknown[]) => unknown;

function deps(over: Partial<Parameters<typeof remoteSshAuthProvider>[1]> = {}) {
  return {
    visibleHost: vi.fn(async (host: unknown) => ({
      ...(host as object),
      password: undefined,
    })),
    applyCertificate: vi.fn(async () => {}),
    ...over,
  };
}

const env = () => ({
  client: { live: true },
  userId: "u1",
  hostId: 7,
  purpose: "terminal",
  interactive: true,
  log: vi.fn(),
});

describe("settable config", () => {
  it("keeps only listed fields of the right type", () => {
    const hostVerifier = () => true;
    expect(
      pickSettableConfig({
        username: "root",
        password: 5,
        tryKeyboard: true,
        hostVerifier,
        sock: {},
        agent: "/run/agent.sock",
        host: "evil.example",
        privateKey: Buffer.from("k"),
      }),
    ).toEqual({
      username: "root",
      tryKeyboard: true,
      privateKey: Buffer.from("k"),
    });
    expect(pickSettableConfig(null)).toEqual({});
  });

  it("reads a certificate only when both parts are strings", () => {
    expect(
      readSandboxCertificate({
        termixCertificate: { privateKey: "k", certificate: "c" },
      }),
    ).toEqual({ privateKey: "k", certificate: "c" });
    expect(
      readSandboxCertificate({
        termixCertificate: { privateKey: Buffer.from("k"), certificate: "c" },
      }),
    ).toBeNull();
    expect(readSandboxCertificate({})).toBeNull();
  });
});

describe("remote provider", () => {
  it("needs prepare", () => {
    expect(() => remoteSshAuthProvider({ type: "x" }, deps())).toThrow(
      /needs prepare/,
    );
  });

  it("asks banner and keyboard hooks with no secrets and rebuilds the answers", async () => {
    const onBanner = vi.fn(async (_b: string, host: unknown) => {
      expect((host as { password?: string }).password).toBeUndefined();
      return {
        action: "hold",
        timeoutMs: 10 ** 12,
        message: "wait",
        details: { url: "https://x", nested: { no: 1 } },
        extra: "dropped",
      };
    });
    const onKeyboardInteractive = vi.fn(async () => ({
      kind: "browser",
      url: "https://login",
      code: "abcd",
      instructions: "go",
      evil: true,
    }));
    const provider = remoteSshAuthProvider(
      {
        type: "x",
        prepare: async () => ({}),
        onBanner,
        onKeyboardInteractive,
      },
      deps(),
    ) as unknown as {
      remote: boolean;
      onBanner: (b: string, h: unknown, e: unknown) => Promise<unknown>;
      onKeyboardInteractive: (r: unknown, h: unknown) => Promise<unknown>;
    };
    expect(provider.remote).toBe(true);
    expect(
      await provider.onBanner("hi", { password: "hunter2" }, { log: vi.fn() }),
    ).toEqual({
      action: "hold",
      timeoutMs: 30 * 60 * 1000,
      message: "wait",
      details: { url: "https://x" },
    });
    expect(
      await provider.onKeyboardInteractive(
        { name: "n", instructions: "i", prompts: [{ prompt: "p" }], x: 1 },
        { password: "hunter2" },
      ),
    ).toEqual({
      kind: "browser",
      url: "https://login",
      code: "abcd",
      instructions: "go",
    });
    expect(onKeyboardInteractive.mock.calls[0][0]).toEqual({
      name: "n",
      instructions: "i",
      prompts: [{ prompt: "p", echo: false }],
    });
  });

  it("drops banner and keyboard answers it does not know", () => {
    expect(readBannerDecision({ action: "eat" })).toBeUndefined();
    expect(readDetection({ kind: "totp", promptIndex: -1 })).toBeNull();
    expect(readDetection({ kind: "other" })).toBeNull();
    expect(readDetection({ kind: "auto", responses: ["a", 5] })).toEqual({
      kind: "auto",
      responses: ["a", ""],
    });
  });

  it("sends no secrets and applies only allowed fields back", async () => {
    const prepare = vi.fn(
      async (cfg: Record<string, unknown>, host: unknown, e: unknown) => {
        expect(cfg).toEqual({ host: "10.0.0.1", port: 22, username: "me" });
        expect((host as { password?: string }).password).toBeUndefined();
        expect(e).not.toHaveProperty("client");
        return {
          outcome: { status: "ready" },
          config: {
            username: "signed",
            hostVerifier: () => true,
            readyTimeout: 5000,
          },
        };
      },
    );
    const d = deps();
    const provider = remoteSshAuthProvider(
      { type: "vault", labelKey: "k", prepare, extra: "dropped" },
      d,
    );
    expect(provider).not.toHaveProperty("extra");
    const config: Record<string, unknown> = {
      host: "10.0.0.1",
      port: 22,
      username: "me",
      password: "hunter2",
      hostVerifier: "core",
    };
    const outcome = await (provider.prepare as AnyFn)(
      config,
      { id: 7, password: "hunter2" },
      env(),
    );
    expect(outcome).toEqual({ status: "ready" });
    expect(config).toEqual({
      host: "10.0.0.1",
      port: 22,
      username: "signed",
      password: "hunter2",
      hostVerifier: "core",
      readyTimeout: 5000,
    });
    expect(d.applyCertificate).not.toHaveBeenCalled();
  });

  it("applies a returned certificate to core's own client", async () => {
    const d = deps();
    const e = env();
    const provider = remoteSshAuthProvider(
      {
        type: "vault",
        prepare: async () => ({
          outcome: { status: "ready" },
          config: {
            username: "deploy",
            termixCertificate: { privateKey: "KEY", certificate: "CERT" },
          },
        }),
      },
      d,
    );
    const config: Record<string, unknown> = { username: "me" };
    await (provider.prepare as AnyFn)(config, { id: 7 }, e);
    expect(d.applyCertificate).toHaveBeenCalledWith(
      config,
      e.client,
      { privateKey: "KEY", certificate: "CERT" },
      "deploy",
    );
  });

  it("turns a failed certificate into an error outcome", async () => {
    const provider = remoteSshAuthProvider(
      {
        type: "vault",
        prepare: async () => ({
          outcome: { status: "ready" },
          config: { termixCertificate: { privateKey: "K", certificate: "C" } },
        }),
      },
      deps({
        applyCertificate: vi.fn(async () => {
          throw new Error("bad key");
        }),
      }),
    );
    expect(await (provider.prepare as AnyFn)({}, { id: 1 }, env())).toEqual({
      status: "error",
      code: "failed",
      message: "Certificate authentication failed: bad key",
    });
  });

  it("answers an error when prepare gives nothing back", async () => {
    const provider = remoteSshAuthProvider(
      { type: "x", prepare: async () => undefined },
      deps(),
    );
    expect(await (provider.prepare as AnyFn)({}, {}, env())).toMatchObject({
      status: "error",
    });
  });

  it("passes auth failures and connect options through as promises", async () => {
    const provider = remoteSshAuthProvider(
      {
        type: "x",
        prepare: async () => ({ outcome: { status: "ready" } }),
        onAuthFailed: async (
          _h: unknown,
          _e: unknown,
          ctx: { error: Error },
        ) => ({ status: "interaction-required", message: ctx.error.message }),
        connectOptions: async () => ({ readyTimeout: 1, timeout: 2, sock: {} }),
      },
      deps(),
    );
    await expect(
      (provider.onAuthFailed as AnyFn)({ id: 1 }, env(), {
        error: new Error("All configured authentication methods failed"),
        retries: 0,
        canRetry: false,
        methodNotAvailable: false,
      }),
    ).resolves.toEqual({
      status: "interaction-required",
      message: "All configured authentication methods failed",
    });
    await expect(
      (provider.connectOptions as AnyFn)({ id: 1 }, "terminal"),
    ).resolves.toEqual({ readyTimeout: 1, timeout: 2 });
  });

  it("filters a retry patch like any other config change", async () => {
    const provider = remoteSshAuthProvider(
      {
        type: "x",
        prepare: async () => ({ outcome: { status: "ready" } }),
        onAuthFailed: async () => ({
          status: "retry",
          message: "again",
          patch: { tryKeyboard: true, hostVerifier: () => true, sock: {} },
        }),
      },
      deps(),
    );
    await expect(
      (provider.onAuthFailed as AnyFn)({ id: 1 }, env(), {
        error: new Error("x"),
        retries: 0,
        canRetry: true,
        methodNotAvailable: false,
      }),
    ).resolves.toEqual({
      status: "retry",
      message: "again",
      patch: { tryKeyboard: true },
    });
  });

  it("gives a sign-in only send and close on the socket", async () => {
    let seen: Record<string, unknown> = {};
    const provider = remoteSshAuthProvider(
      {
        type: "x",
        prepare: async () => ({ outcome: { status: "ready" } }),
        startInteraction: async (request: Record<string, unknown>) => {
          seen = request;
        },
      },
      deps(),
    );
    const listeners: AnyFn[] = [];
    const socket = {
      readyState: 1,
      send: vi.fn(),
      on: (_e: string, l: AnyFn) => listeners.push(l),
      terminate: vi.fn(),
    };
    await (provider.startInteraction as AnyFn)({
      userId: "u1",
      hostId: 7,
      host: { name: "box", ip: "10.0.0.1", username: "me", password: "x" },
      socket,
      requestOrigin: "https://termix",
      payload: {},
    });
    expect(seen.host).toEqual({ name: "box", ip: "10.0.0.1", username: "me" });
    const remote = seen.socket as Record<string, AnyFn>;
    expect(Object.keys(remote).sort()).toEqual(["onClose", "send"]);
    remote.send("hello");
    remote.send({ not: "a string" });
    remote.send("x".repeat(70_000));
    expect(socket.send).toHaveBeenCalledTimes(1);
    const closed = vi.fn();
    remote.onClose(closed);
    listeners.forEach((l) => l());
    expect(closed).toHaveBeenCalled();
    socket.readyState = 3;
    remote.send("late");
    expect(socket.send).toHaveBeenCalledTimes(1);
  });
});
