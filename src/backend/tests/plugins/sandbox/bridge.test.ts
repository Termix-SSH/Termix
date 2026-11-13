/**
 * The core side of a plugin process. The old worker broker believed a
 * callerUserId the worker put on its own messages; a sandboxed plugin only
 * ever holds tokens core minted, and core decides the actor from the token.
 * Also: what may cross, what is stripped, and what is refused.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const granted = vi.hoisted(() => ({ credentials: false }));
vi.mock("../../../plugins/permissions.js", () => ({
  hasCapability: async (_id: string, capability: string) =>
    capability === "credentials:read" ? granted.credentials : true,
}));

import { getActor, runAsActor } from "../../../plugins/actor.js";
import {
  isRefusedPath,
  ownCookieHeader,
  ownSetCookies,
  PluginBridge,
  pluginCookiePrefix,
  scrubSecrets,
  safeHeaders,
  validCloseCode,
} from "../../../plugins/sandbox/bridge.js";
import type { Transport, Wire } from "../../../plugins/sandbox/rpc.js";
import { SandboxTokenStore } from "../../../plugins/sandbox/tokens.js";

class FakeSshClient {
  config = { privateKey: "-----BEGIN KEY-----", password: "hunter2" };
  exec() {}
}

function harness(
  options: {
    pluginId?: string;
    tokens?: SandboxTokenStore;
    sandbox?: Record<string, unknown>;
  } = {},
) {
  const pluginId = options.pluginId ?? "docker";
  const tokens = options.tokens ?? new SandboxTokenStore();
  const toHost: Array<(m: Wire) => void> = [];
  const replies: Wire[] = [];
  const transport: Transport = {
    send: (m) => replies.push(structuredClone(m)),
    onMessage: (h) => toHost.push(h),
  };
  const calls: unknown[][] = [];
  const ctx = {
    pluginId,
    whoami: () => getActor() ?? null,
    asUser: <T>(userId: string, fn: () => T) =>
      runAsActor(userId, "asUser", fn),
    leak: () => new FakeSshClient(),
    db: {
      client: async () => ({ fake: "db" }),
      define: async () => ({}),
      refs: async () => ({}),
    },
    hosts: {
      get: async () => ({
        id: 1,
        ip: "10.0.0.1",
        password: "hunter2",
        privateKey: "KEY",
        terminalConfig: { sudoPassword: "s" },
      }),
      locks: { provide: () => () => {} },
    },
    schedule: {
      every: (...args: unknown[]) => {
        calls.push(["every", ...args]);
        return () => {};
      },
    },
    events: {
      on: (...args: unknown[]) => {
        calls.push(["on", ...args]);
        return () => {};
      },
    },
    registry: {
      provide: (...args: unknown[]) => calls.push(["provide", ...args]),
      revoke: (...args: unknown[]) => {
        calls.push(["revoke", ...args]);
        return true;
      },
    },
  };
  const bridge = new PluginBridge(transport, {
    manifest: {
      id: pluginId,
      capabilities: [],
      sandbox: options.sandbox ?? {},
    } as never,
    ctx: ctx as never,
    tokens,
    dialect: "sqlite",
  });
  let id = 0;
  const send = async (m: Partial<Wire> & { t: "call" | "fn" }) => {
    const message = { id: ++id, a: [], ...m } as Wire;
    toHost.forEach((h) => h(message));
    await new Promise((r) => setTimeout(r, 10));
    return replies.find(
      (r) => "id" in r && r.id === (message as { id: number }).id,
    );
  };
  const userToken = (userId = "alice") =>
    tokens.mint({ pluginId, userId, kind: "request" });
  return { bridge, tokens, send, replies, calls, userToken };
}

beforeEach(() => {
  granted.credentials = false;
});

describe("sandboxed plugin actor", () => {
  it("acts as the token's user, whatever the message claims", async () => {
    const { send, userToken } = harness();
    const reply = await send({
      t: "call",
      m: "ctx.whoami",
      k: userToken(),
      u: "admin",
      a: [{ callerUserId: "admin", userId: "admin" }],
    } as never);
    expect(reply).toMatchObject({ t: "ok", v: "alice" });
  });

  it("refuses a made up token instead of running with no actor", async () => {
    const { send } = harness();
    const reply = await send({
      t: "call",
      m: "ctx.whoami",
      k: "admin",
      u: "admin",
    } as never);
    expect(reply).toMatchObject({
      t: "err",
      e: { code: "SANDBOX_TOKEN", status: 403 },
    });
  });

  it("refuses another plugin's token", async () => {
    const shared = new SandboxTokenStore();
    const { send } = harness({ tokens: shared });
    const foreign = shared.mint({
      pluginId: "snippets",
      userId: "admin",
      kind: "request",
    });
    const reply = await send({
      t: "call",
      m: "ctx.whoami",
      k: foreign,
    } as never);
    expect(reply).toMatchObject({ t: "err", e: { code: "SANDBOX_TOKEN" } });
  });

  it("refuses a token replayed after it was revoked", async () => {
    const { tokens, send, userToken } = harness();
    const token = userToken();
    tokens.revoke(token);
    const reply = await send({ t: "call", m: "ctx.whoami", k: token } as never);
    expect(reply).toMatchObject({ t: "err", e: { code: "SANDBOX_TOKEN" } });
  });

  it("runs with no actor when no token is sent, the same as background work", async () => {
    const { send } = harness();
    const reply = await send({
      t: "call",
      m: "ctx.whoami",
      u: "admin",
    } as never);
    expect(reply).toMatchObject({ t: "ok", v: null });
  });

  it("only exposes methods that are on the real ctx", async () => {
    const { send, userToken } = harness();
    for (const m of [
      "ctx.constructor",
      "ctx.__proto__",
      "ctx.whoami.call",
      "ctx.toString",
    ]) {
      const reply = await send({ t: "call", m, k: userToken() } as never);
      expect(reply).toMatchObject({ t: "err", e: { code: "SANDBOX_UNKNOWN" } });
    }
  });

  it("mints a token for the user core is acting as when it calls the plugin", () => {
    const { bridge, tokens } = harness();
    const token = runAsActor("bob", "request", () =>
      bridge.mintForCurrentActor(),
    );
    expect(tokens.resolve(token, "docker")?.userId).toBe("bob");
  });

  it("keeps an API key's scopes on the token", () => {
    const { bridge, tokens } = harness();
    const token = runAsActor(
      "bob",
      "request",
      () => bridge.mintForCurrentActor(),
      undefined,
      { origin: { kind: "api" }, apiKeyId: "k1", apiKeyScopes: ["hosts:read"] },
    );
    expect(tokens.resolve(token, "docker")?.trail).toMatchObject({
      apiKeyId: "k1",
      apiKeyScopes: ["hosts:read"],
    });
  });
});

describe("what may cross", () => {
  it("refuses to send a class instance such as an ssh2 client", async () => {
    const { send, replies, userToken } = harness();
    const reply = await send({
      t: "call",
      m: "ctx.leak",
      k: userToken(),
    } as never);
    expect(reply).toMatchObject({ t: "err", e: { code: "SANDBOX_VALUE" } });
    expect(JSON.stringify(replies)).not.toContain("hunter2");
    expect(JSON.stringify(replies)).not.toContain("BEGIN KEY");
  });

  it("never serves the raw database client", async () => {
    const { send, userToken } = harness();
    const generic = await send({
      t: "call",
      m: "ctx.db.client",
      k: userToken(),
    } as never);
    expect(generic).toMatchObject({ t: "err", e: { code: "SANDBOX_UNKNOWN" } });
    const special = await send({
      t: "call",
      m: "db.client",
      k: userToken(),
    } as never);
    expect(special).toMatchObject({ t: "ok", v: true });
  });

  it("strips host secrets unless the plugin holds credentials:read", async () => {
    const { send, userToken } = harness();
    const reply = (await send({
      t: "call",
      m: "ctx.hosts.get",
      k: userToken(),
    } as never)) as { v: Record<string, unknown> };
    expect(reply.v).toMatchObject({ id: 1, ip: "10.0.0.1" });
    expect(reply.v).not.toHaveProperty("password");
    expect(reply.v).not.toHaveProperty("privateKey");

    granted.credentials = true;
    const allowed = (await send({
      t: "call",
      m: "ctx.hosts.get",
      k: userToken(),
    } as never)) as { v: Record<string, unknown> };
    expect(allowed.v).toHaveProperty("password", "hunter2");
  });

  it("refuses providers core reads synchronously", async () => {
    const { send, userToken } = harness();
    const reply = await send({
      t: "call",
      m: "ctx.hosts.locks.provide",
      k: userToken(),
    } as never);
    expect(reply).toMatchObject({
      t: "err",
      e: { code: "SANDBOX_UNSUPPORTED", status: 501 },
    });
  });

  it("refuses login methods and keyboard-interactive handlers", () => {
    expect(isRefusedPath("auth.registerLoginMethod")).toMatch(/live request/);
    expect(isRefusedPath("auth.registerKeyboardInteractiveHandler")).toMatch(
      /synchronously/,
    );
    expect(isRefusedPath("auth.registerSecondFactor")).toBeNull();
  });

  it("drops the headers that would let a plugin act as the user", () => {
    expect(
      safeHeaders({
        Cookie: "jwt=x",
        authorization: "Bearer y",
        "x-api-key": "z",
        "proxy-authorization": "w",
        "content-type": "application/json",
      }),
    ).toEqual({ "content-type": "application/json" });
  });

  it("lets a plugin read and set only its own cookies", () => {
    const prefix = pluginCookiePrefix("my-plugin");
    expect(prefix).toBe("tmxp_my_plugin_");
    expect(
      ownCookieHeader(
        "jwt=x; tmxp_my_plugin_state=abc; __Host-jwt=y; tmxp_other_a=1",
        prefix,
      ),
    ).toBe("tmxp_my_plugin_state=abc");
    expect(ownCookieHeader("jwt=x", prefix)).toBeUndefined();
    expect(ownCookieHeader(undefined, prefix)).toBeUndefined();
    expect(
      ownSetCookies(
        [
          "tmxp_my_plugin_state=abc; Path=/; HttpOnly",
          "jwt=forged; Path=/",
          "tmxp_my_plugin_wide=1; Domain=example.com",
          "tmxp_other_x=1",
          "tmxp_my_plugin_=",
        ],
        prefix,
      ),
    ).toEqual([
      "tmxp_my_plugin_state=abc; Path=/; HttpOnly",
      "tmxp_my_plugin_=",
    ]);
    expect(ownSetCookies("jwt=x", prefix)).toEqual([]);
  });

  it("scrubs nested secrets but keeps functions and plain data", () => {
    const fn = () => 1;
    const out = scrubSecrets({
      list: [{ password: "p", name: "a" }],
      call: fn,
      nested: { sudoPassword: "s", keep: 1 },
    }) as Record<string, unknown>;
    expect(out).toEqual({
      list: [{ name: "a" }],
      call: fn,
      nested: { keep: 1 },
    });
  });
});

describe("socket close codes", () => {
  it("keeps the codes a plugin may send, like 1008 for a refused login", () => {
    for (const code of [1000, 1001, 1008, 1011, 3000, 4401]) {
      expect(validCloseCode(code)).toBe(code);
    }
    for (const code of [1004, 1005, 1006, 1015, 2000, 5000, "x", undefined]) {
      expect(validCloseCode(code)).toBe(1000);
    }
  });
});

describe("declared registrations", () => {
  it("refuses a schedule whose id is not in the manifest", async () => {
    const { send, calls, userToken } = harness({
      sandbox: { schedules: [{ id: "poll", every: 60000 }] },
    });
    const bad = await send({
      t: "call",
      m: "ctx.schedule.every",
      k: userToken(),
      a: [1000, { $f: "cf1" }, { id: "other" }],
    } as never);
    expect(bad).toMatchObject({ t: "err", e: { code: "SANDBOX_UNDECLARED" } });
    const good = await send({
      t: "call",
      m: "ctx.schedule.every",
      k: userToken(),
      a: [1000, { $f: "cf1" }, { id: "poll" }],
    } as never);
    expect(good).toMatchObject({ t: "ok" });
    expect(calls).toHaveLength(1);
  });

  it("refuses event topics and registry keys that are not declared", async () => {
    const { send, userToken } = harness({
      sandbox: { events: ["host.deleted"], registry: ["docker.x"] },
    });
    const topic = await send({
      t: "call",
      m: "ctx.events.on",
      k: userToken(),
      a: ["user.deleted", { $f: "cf1" }],
    } as never);
    expect(topic).toMatchObject({
      t: "err",
      e: { code: "SANDBOX_UNDECLARED" },
    });
    const key = await send({
      t: "call",
      m: "ctx.registry.provide",
      k: userToken(),
      a: ["docker.y", 1],
    } as never);
    expect(key).toMatchObject({ t: "err", e: { code: "SANDBOX_UNDECLARED" } });
  });

  it("revokes a registry key with the value it provided", async () => {
    const { send, calls, userToken } = harness({
      sandbox: { registry: ["docker.x"] },
    });
    await send({
      t: "call",
      m: "ctx.registry.provide",
      k: userToken(),
      a: ["docker.x", { value: 1 }],
    } as never);
    await send({
      t: "call",
      m: "ctx.registry.revoke",
      k: userToken(),
      a: ["docker.x", { value: 2 }],
    } as never);
    expect(calls[1]).toEqual(["revoke", "docker.x", { value: 1 }]);
  });
});
